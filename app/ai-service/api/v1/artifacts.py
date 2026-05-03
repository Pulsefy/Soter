"""
Verification artifact access endpoints with signed URL support.
"""

import logging
import os
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from config import settings
from services.artifact_access import ArtifactAccessError, ArtifactAccessService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["verification-artifacts"])

artifact_access_service = ArtifactAccessService(
    artifacts_dir=settings.verification_artifacts_dir,
    signing_secret=settings.artifact_signing_secret,
    ttl_seconds=settings.verification_artifact_url_ttl_seconds,
)


class AccessModeRequest(BaseModel):
    mode: Literal["signed_url", "proxy"] = "signed_url"


@router.post("/ai/verification-artifacts/{artifact_id}/access")
async def request_artifact_access(
    artifact_id: str,
    request: AccessModeRequest,
    x_user_role: str = Header(default="", alias="X-User-Role"),
    x_org_id: str = Header(default="", alias="X-Org-Id"),
    x_user_id: str = Header(default="unknown", alias="X-User-Id"),
):
    if not artifact_access_service.validate_role(x_user_role):
        raise HTTPException(status_code=403, detail="forbidden_role")

    try:
        artifact_path, metadata = artifact_access_service.resolve_artifact(artifact_id)
        artifact_access_service.enforce_org_ownership(metadata, x_org_id)
    except ArtifactAccessError as exc:
        detail = str(exc)
        status_code = 404 if detail == "artifact_not_found" else 403
        raise HTTPException(status_code=status_code, detail=detail) from exc

    logger.info(
        "artifact_access_granted",
        extra={
            "event": "artifact_access_granted",
            "artifact_id": artifact_id,
            "org_id": x_org_id,
            "user_id": x_user_id,
            "role": x_user_role,
            "mode": request.mode,
        },
    )

    if request.mode == "proxy":
        return FileResponse(
            path=artifact_path,
            filename=metadata.get("filename", os.path.basename(artifact_path)),
            media_type=metadata.get("mime_type", "application/octet-stream"),
        )

    token = artifact_access_service.create_signed_token(artifact_id, x_org_id, x_user_id)
    return {
        "artifact_id": artifact_id,
        "download_url": f"/v1/ai/verification-artifacts/download?token={token}",
        "expires_in_seconds": settings.verification_artifact_url_ttl_seconds,
    }


@router.get("/ai/verification-artifacts/download")
async def download_artifact_with_token(token: str = Query(..., min_length=10)):
    try:
        payload = artifact_access_service.verify_signed_token(token)
        artifact_path, metadata = artifact_access_service.resolve_artifact(payload["aid"])
        artifact_access_service.enforce_org_ownership(metadata, payload["org"])
    except ArtifactAccessError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    logger.info(
        "artifact_downloaded_with_signed_url",
        extra={
            "event": "artifact_downloaded_with_signed_url",
            "artifact_id": payload["aid"],
            "org_id": payload["org"],
            "user_id": payload.get("sub", "unknown"),
        },
    )

    return FileResponse(
        path=artifact_path,
        filename=metadata.get("filename", os.path.basename(artifact_path)),
        media_type=metadata.get("mime_type", "application/octet-stream"),
    )
