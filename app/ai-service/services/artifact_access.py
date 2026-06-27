"""
Secure access helpers for verification evidence artifacts.

This service implements:
- HMAC-SHA256 signed tokens with configurable TTL
- Role-based access control (admin, operator, reviewer)
- Organization ownership validation
- Path traversal prevention
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import logging
from typing import Dict, Tuple

logger = logging.getLogger(__name__)


class ArtifactAccessError(Exception):
    """Raised for invalid or unauthorized artifact access attempts."""


class ArtifactAccessService:
    """Manages secure artifact access with signed URLs and authorization."""

    def __init__(
        self, artifacts_dir: str, signing_secret: str, ttl_seconds: int
    ):
        self.artifacts_dir = os.path.abspath(artifacts_dir)
        self.signing_secret = signing_secret.encode("utf-8")
        self.ttl_seconds = ttl_seconds

        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if not signing_secret or len(signing_secret) < 16:
            msg = "signing_secret must be at least 16 characters"
            raise ValueError(msg)

    def validate_role(self, role: str) -> bool:
        """
        Validate that role is in the set of authorized roles.

        Authorized roles: admin, operator, reviewer
        """
        return role in {"admin", "operator", "reviewer"}

    def resolve_artifact(self, artifact_id: str) -> Tuple[str, Dict]:
        """
        Resolve and validate artifact path and metadata.

        Validates:
        - artifact_id is not empty
        - artifact_id contains no path traversal characters
        - artifact file and metadata file both exist
        - artifact path stays within artifacts_dir (no escapes)

        Raises:
            ArtifactAccessError: If artifact invalid or not found
        """
        if not artifact_id or any(
            ch in artifact_id for ch in ("/", "\\", "..")
        ):
            raise ArtifactAccessError("invalid_artifact_id")

        artifact_path = os.path.abspath(
            os.path.join(self.artifacts_dir, artifact_id)
        )
        metadata_path = artifact_path + ".meta.json"

        # Prevent directory traversal
        if not artifact_path.startswith(self.artifacts_dir + os.sep):
            raise ArtifactAccessError("invalid_artifact_path")

        # Both artifact and metadata file must exist
        if not os.path.isfile(artifact_path) or not os.path.isfile(
            metadata_path
        ):
            raise ArtifactAccessError("artifact_not_found")

        # Parse and validate metadata
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.error(
                "metadata_load_failed",
                extra={
                    "artifact_id": artifact_id,
                    "error": str(e),
                },
            )
            raise ArtifactAccessError("metadata_corrupted") from e

        return artifact_path, metadata

    def enforce_org_ownership(
        self, metadata: Dict, org_id: str
    ) -> None:
        """
        Validate that artifact belongs to the requesting organization.

        Raises:
            ArtifactAccessError: If org_id is empty or doesn't match
        """
        if not org_id or not org_id.strip():
            raise ArtifactAccessError("org_id_empty")

        artifact_org = metadata.get("org_id")
        if not artifact_org or artifact_org != org_id:
            raise ArtifactAccessError("forbidden_org")

    def create_signed_token(
        self, artifact_id: str, org_id: str, user_id: str
    ) -> str:
        """
        Create a short-lived, HMAC-SHA256 signed token.

        Token format: base64url(payload).base64url(signature)

        Payload contains:
        - aid: artifact ID
        - org: organization ID
        - sub: user ID (subject)
        - exp: expiration timestamp (Unix seconds)

        Args:
            artifact_id: The artifact being accessed
            org_id: The organization ID
            user_id: The user requesting access

        Returns:
            Signed token string

        Raises:
            ArtifactAccessError: If parameters are invalid
        """
        if not artifact_id or not org_id or not user_id:
            raise ArtifactAccessError("invalid_token_params")

        payload = {
            "aid": artifact_id,
            "org": org_id,
            "sub": user_id,
            "exp": int(time.time()) + self.ttl_seconds,
        }
        payload_bytes = json.dumps(
            payload, separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        payload_b64 = (
            base64.urlsafe_b64encode(payload_bytes)
            .decode("utf-8")
            .rstrip("=")
        )

        # Create HMAC-SHA256 signature
        sig = hmac.new(
            self.signing_secret,
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        )
        signature_b64 = (
            base64.urlsafe_b64encode(sig.digest())
            .decode("utf-8")
            .rstrip("=")
        )

        token = f"{payload_b64}.{signature_b64}"
        logger.debug(
            "signed_token_created",
            extra={
                "artifact_id": artifact_id,
                "org_id": org_id,
                "ttl_seconds": self.ttl_seconds,
            },
        )
        return token

    def verify_signed_token(self, token: str) -> Dict:
        """
        Verify and decode a signed artifact access token.

        Validation checks:
        - Token format is correct (payload.signature)
        - Signature is valid (HMAC-SHA256)
        - Token has not expired

        Args:
            token: The signed token string

        Returns:
            Payload dictionary with artifact_id, org_id, etc

        Raises:
            ArtifactAccessError: If invalid, tampered, or expired
        """
        try:
            payload_b64, signature_b64 = token.split(".", 1)
        except ValueError as exc:
            raise ArtifactAccessError("invalid_token") from exc

        # Verify HMAC-SHA256 signature
        expected_sig = hmac.new(
            self.signing_secret,
            payload_b64.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        try:
            supplied_sig = base64.urlsafe_b64decode(signature_b64 + "==")
        except Exception as exc:
            raise ArtifactAccessError("invalid_token_signature") from exc

        if not hmac.compare_digest(expected_sig, supplied_sig):
            logger.warning(
                "token_signature_mismatch",
                extra={
                    "event": "token_signature_verification_failed"
                },
            )
            raise ArtifactAccessError("invalid_token_signature")

        # Decode payload
        try:
            payload_raw = base64.urlsafe_b64decode(payload_b64 + "==")
            payload = json.loads(payload_raw.decode("utf-8"))
        except Exception as exc:
            raise ArtifactAccessError("invalid_token") from exc

        # Check expiration
        current_time = int(time.time())
        expiration_time = int(payload.get("exp", 0))

        if expiration_time < current_time:
            logger.debug(
                "token_expired",
                extra={
                    "current_time": current_time,
                    "expiration_time": expiration_time,
                },
            )
            raise ArtifactAccessError("token_expired")

        return payload
