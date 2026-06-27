"""
Verification artifact access endpoints with signed URL support.

This module provides secure access to verification artifacts with:
- Authorization based on user roles and organization ownership
- Short-lived signed URLs with configurable expiry (TTL)
- Both proxy and signed URL download modes
"""

import logging
import os
from typing import Literal

from fastapi import APIRouter, Header, Query
from fastapi.responses import FileResponse, JSONResponse
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


def _create_error_response(code: str, status_code: int, detail: str) -> tuple:
    """Create standardized error response with logging."""
    logger.warning(
        "artifact_access_denied",
        extra={
            "event": "artifact_access_denied",
            "code": code,
        },
    )
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": detail}},
    ), status_code


@router.post("/ai/verification-artifacts/{artifact_id}/access")
async def request_artifact_access(
    artifact_id: str,
    request: AccessModeRequest,
    x_user_role: str = Header(default="", alias="X-User-Role"),
    x_org_id: str = Header(default="", alias="X-Org-Id"),
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """
    Request access to a verification artifact.

    Validates user authorization and can return either:
    - A short-lived signed URL for secure download
    - Direct file access (proxy mode) for authorized users

    Returns 403 if unauthorized, 404 if artifact not found.
    """
    # Validate required headers for authorization
    if not x_user_role or not x_user_role.strip():
        response, status_code = _create_error_response(
            "missing_user_role",
            400,
            "X-User-Role header is required",
        )
        return response

    if not x_org_id or not x_org_id.strip():
        response, status_code = _create_error_response(
            "missing_org_id",
            400,
            "X-Org-Id header is required",
        )
        return response

    if not x_user_id or not x_user_id.strip():
        response, status_code = _create_error_response(
            "missing_user_id",
            400,
            "X-User-Id header is required",
        )
        return response

    # Validate user role
    if not artifact_access_service.validate_role(x_user_role):
        response, _ = _create_error_response(
            "forbidden_role",
            403,
            f"User role '{x_user_role}' is not authorized",
        )
        return response

    # Resolve artifact and validate organization ownership
    try:
        artifact_path, metadata = (
            artifact_access_service.resolve_artifact(artifact_id)
        )
        artifact_access_service.enforce_org_ownership(metadata, x_org_id)
    except ArtifactAccessError as exc:
        error_code = str(exc)
        if error_code == "artifact_not_found":
            response, _ = _create_error_response(
                error_code,
                404,
                "Artifact not found",
            )
        elif error_code == "forbidden_org":
            msg = (
                "Access denied: artifact belongs to "
                "a different organization"
            )
            response, _ = _create_error_response(
                error_code,
                403,
                msg,
            )
        else:
            response, _ = _create_error_response(
                error_code,
                403,
                "Access denied",
            )
        return response

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
            filename=metadata.get(
                "filename", os.path.basename(artifact_path)
            ),
            media_type=metadata.get(
                "mime_type", "application/octet-stream"
            ),
        )

    # Generate short-lived signed URL token
    token = artifact_access_service.create_signed_token(
        artifact_id, x_org_id, x_user_id
    )
    return {
        "artifact_id": artifact_id,
        "download_url": (
            f"/v1/ai/verification-artifacts/download?token={token}"
        ),
        "expires_in_seconds": (
            settings.verification_artifact_url_ttl_seconds
        ),
        "signed_url_configured_ttl_seconds": (
            settings.verification_artifact_url_ttl_seconds
        ),
    }


@router.get("/ai/verification-artifacts/download")
async def download_artifact_with_token(
    token: str = Query(..., min_length=10)
):
    """
    Download an artifact using a short-lived signed URL token.

    The token is generated by the /access endpoint and contains:
    - Artifact ID
    - Organization ID
    - User ID
    - Expiration timestamp

    The token is HMAC-SHA256 signed for integrity verification.

    Returns 403 if token is invalid, expired, or org mismatch detected.
    Returns 404 if artifact not found.
    """
    try:
        # Verify token signature, expiration, and extract payload
        payload = artifact_access_service.verify_signed_token(token)

        # Resolve artifact from payload
        artifact_path, metadata = (
            artifact_access_service.resolve_artifact(payload["aid"])
        )

        # Ensure organization ownership matches token organization
        artifact_access_service.enforce_org_ownership(
            metadata, payload["org"]
        )
    except ArtifactAccessError as exc:
        error_code = str(exc)

        if error_code == "artifact_not_found":
            response, _ = _create_error_response(
                error_code,
                404,
                "Artifact not found",
            )
        elif error_code == "token_expired":
            response, _ = _create_error_response(
                error_code,
                403,
                "Signed URL has expired. Request a new one.",
            )
        elif error_code == "invalid_token_signature":
            response, _ = _create_error_response(
                error_code,
                403,
                "Token signature verification failed",
            )
        elif error_code == "invalid_token":
            response, _ = _create_error_response(
                error_code,
                403,
                "Token format is invalid",
            )
        elif error_code == "forbidden_org":
            msg = (
                "Token organization does not match "
                "artifact organization"
            )
            response, _ = _create_error_response(
                error_code,
                403,
                msg,
            )
        else:
            response, _ = _create_error_response(
                error_code,
                403,
                "Access denied",
            )
        return response

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
        filename=metadata.get(
            "filename", os.path.basename(artifact_path)
        ),
        media_type=metadata.get(
            "mime_type", "application/octet-stream"
        ),
    )
