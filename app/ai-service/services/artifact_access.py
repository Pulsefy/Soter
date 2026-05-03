"""
Secure access helpers for verification evidence artifacts.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Dict, Tuple


class ArtifactAccessError(Exception):
    """Raised for invalid or unauthorized artifact access attempts."""


class ArtifactAccessService:
    def __init__(self, artifacts_dir: str, signing_secret: str, ttl_seconds: int):
        self.artifacts_dir = os.path.abspath(artifacts_dir)
        self.signing_secret = signing_secret.encode("utf-8")
        self.ttl_seconds = ttl_seconds

    def validate_role(self, role: str) -> bool:
        return role in {"admin", "operator", "reviewer"}

    def resolve_artifact(self, artifact_id: str) -> Tuple[str, Dict]:
        if not artifact_id or any(ch in artifact_id for ch in ("/", "\\", "..")):
            raise ArtifactAccessError("invalid_artifact_id")

        artifact_path = os.path.abspath(os.path.join(self.artifacts_dir, artifact_id))
        metadata_path = artifact_path + ".meta.json"

        if not artifact_path.startswith(self.artifacts_dir + os.sep):
            raise ArtifactAccessError("invalid_artifact_path")

        if not os.path.isfile(artifact_path) or not os.path.isfile(metadata_path):
            raise ArtifactAccessError("artifact_not_found")

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        return artifact_path, metadata

    def enforce_org_ownership(self, metadata: Dict, org_id: str) -> None:
        artifact_org = metadata.get("org_id")
        if not artifact_org or artifact_org != org_id:
            raise ArtifactAccessError("forbidden_org")

    def create_signed_token(self, artifact_id: str, org_id: str, user_id: str) -> str:
        payload = {
            "aid": artifact_id,
            "org": org_id,
            "sub": user_id,
            "exp": int(time.time()) + self.ttl_seconds,
        }
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
        payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("utf-8").rstrip("=")
        sig = hmac.new(self.signing_secret, payload_b64.encode("utf-8"), hashlib.sha256)
        signature_b64 = (
            base64.urlsafe_b64encode(sig.digest()).decode("utf-8").rstrip("=")
        )
        return f"{payload_b64}.{signature_b64}"

    def verify_signed_token(self, token: str) -> Dict:
        try:
            payload_b64, signature_b64 = token.split(".", 1)
        except ValueError as exc:
            raise ArtifactAccessError("invalid_token") from exc

        expected_sig = hmac.new(
            self.signing_secret, payload_b64.encode("utf-8"), hashlib.sha256
        ).digest()
        supplied_sig = base64.urlsafe_b64decode(signature_b64 + "==")
        if not hmac.compare_digest(expected_sig, supplied_sig):
            raise ArtifactAccessError("invalid_token_signature")

        payload_raw = base64.urlsafe_b64decode(payload_b64 + "==")
        payload = json.loads(payload_raw.decode("utf-8"))

        if int(payload.get("exp", 0)) < int(time.time()):
            raise ArtifactAccessError("token_expired")

        return payload
