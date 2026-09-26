"""
Evidence access control service for enforcing organization ownership and audit logging.

This service implements:
- Organization ownership validation for evidence artifacts
- Role-based access control (admin, operator, reviewer)
- Comprehensive audit logging for access attempts
- Cross-org access denial enforcement
"""

from typing import List, Dict, Optional
import logging
import time
from services.artifact_access import ArtifactAccessService, ArtifactAccessError

logger = logging.getLogger(__name__)


class EvidenceAccessControlError(Exception):
    """Raised for invalid evidence access control attempts."""


class EvidenceAccessControl:
    """
    Manages evidence access control with organization ownership validation and audit logging.

    Ensures evidence artifacts can only be processed by their owning organization
    and logs all access attempts for audit purposes.
    """

    def __init__(self, artifact_access_service: ArtifactAccessService):
        self.artifact_access_service = artifact_access_service

    def validate_evidence_access(
        self,
        artifact_ids: List[str],
        org_id: str,
        user_id: str,
        user_role: str,
        correlation_id: str = "",
    ) -> None:
        """
        Validate that all evidence artifacts belong to the requesting organization.

        Args:
            artifact_ids: List of evidence artifact IDs to validate
            org_id: Organization ID requesting access
            user_id: User ID requesting access
            user_role: User role (admin, operator, reviewer)
            correlation_id: Correlation ID for request tracing

        Raises:
            EvidenceAccessControlError: If evidence access is not authorized
        """
        # Role-based access control
        if not self.validate_role(user_role):
            self._log_access_attempt(
                artifact_ids,
                org_id,
                user_id,
                user_role,
                operation="verify",
                status="denied",
                reason="forbidden_role",
                correlation_id=correlation_id,
            )
            raise EvidenceAccessControlError(
                f"User role '{user_role}' is not authorized for evidence access"
            )

        # Validate all evidence artifacts belong to requesting org
        for artifact_id in artifact_ids:
            self._validate_single_artifact_access(
                artifact_id,
                org_id,
                user_id,
                user_role,
                correlation_id,
            )

    def validate_role(self, role: str) -> bool:
        """Validate that role is authorized via the artifact access service.

        Public entry point so endpoint code can apply the same role gate
        irrespective of whether ``artifact_ids`` were supplied (the
        ``validate_evidence_access`` flow only runs when artifacts are
        referenced, so endpoint code MUST call this for every request to
        avoid a regression where a request with an invalid role and no
        artifacts would otherwise be accepted).

        Delegates to ``ArtifactAccessService.validate_role`` so the role
        policy is owned in one place and easy to evolve.
        """
        return self.artifact_access_service.validate_role(role)

    def _validate_single_artifact_access(
        self,
        artifact_id: str,
        org_id: str,
        user_id: str,
        user_role: str,
        correlation_id: str = "",
    ) -> None:
        """
        Validate that a single evidence artifact belongs to the requesting organization.

        Raises:
            EvidenceAccessControlError: If artifact access is not authorized
        """
        try:
            artifact_path, metadata = self.artifact_access_service.resolve_artifact(
                artifact_id
            )
            self.artifact_access_service.enforce_org_ownership(metadata, org_id)

            # Log successful access
            self._log_access_attempt(
                [artifact_id],
                org_id,
                user_id,
                user_role,
                operation="verify",
                status="authorized",
                correlation_id=correlation_id,
            )

        except ArtifactAccessError as exc:
            error_code = str(exc)

            # Log failed access attempt
            self._log_access_attempt(
                [artifact_id],
                org_id,
                user_id,
                user_role,
                operation="verify",
                status="denied",
                reason=error_code,
                correlation_id=correlation_id,
            )

            # Convert to EvidenceAccessControlError
            if error_code == "artifact_not_found":
                raise EvidenceAccessControlError(f"Artifact not found: {artifact_id}")
            elif error_code == "forbidden_org":
                raise EvidenceAccessControlError(
                    f"Access denied: artifact belongs to a different organization"
                )
            elif error_code == "org_id_empty":
                raise EvidenceAccessControlError(f"Organization ID is required")
            else:
                raise EvidenceAccessControlError(f"Access denied: {error_code}")

    def _log_access_attempt(
        self,
        artifact_ids: List[str],
        org_id: str,
        user_id: str,
        user_role: str,
        operation: str,
        status: str,
        reason: Optional[str] = None,
        correlation_id: str = "",
    ) -> None:
        """
        Log evidence access attempt for audit purposes.

        This log includes all relevant context for auditing cross-org access denial
        and security compliance requirements.
        """
        log_data = {
            "event": "evidence_access_check",
            "artifact_ids": artifact_ids,
            "org_id": org_id,
            "user_id": user_id,
            "user_role": user_role,
            "operation": operation,
            "status": status,
            "timestamp": int(time.time()),
            "trace_id": correlation_id,
        }

        if reason:
            log_data["reason"] = reason

        if status == "authorized":
            logger.info("Evidence access authorized", extra=log_data)
        elif status == "denied":
            logger.warning("Evidence access denied", extra=log_data)
        else:
            logger.info("Evidence access check", extra=log_data)
