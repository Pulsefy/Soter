"""Documentation for Evidence Ownership and Access Control Implementation

This document provides comprehensive guidance for implementing evidence ownership and access control
when processing evidence references in the Soter AI Service.

Overview
========

Evidence references (artifact IDs) received from the backend must be validated to ensure they can
only be processed by their owning organization. This provides critical security and compliance
controls for humanitarian evidence processing.

Current State
=============

The artifact access control system already exists in `services/artifact_access.py` and includes:

1. **Organization Ownership Validation** (`enforce_org_ownership` method):
   - Validates that evidence artifacts belong to the requesting organization
   - Raises `ArtifactAccessError("forbidden_org")` if org mismatch

2. **Existing Integration Points**:
   - Cache invalidation helpers that reference artifact IDs
   - Artifact access endpoints for direct download/use

Missing Implementation
=====================

Evidence artifacts referenced in humanitarian verification requests are NOT validated for
organization ownership, creating a security gap where evidence could be processed outside its
owning organization scope.

Implementation Plan
==================

Phase 1: Evidence Access Control Service
--------------------------------------

File: `services/evidence_access_control.py`

```python
class EvidenceAccessControl:
    """Manages evidence access control with organization ownership validation and audit logging."""
    
    def validate_evidence_access(
        self,
        artifact_ids: List[str],
        org_id: str,
        user_id: str,
        user_role: str,
        correlation_id: str = "",
    ) -> None:
        """Validate that all evidence artifacts belong to the requesting organization."""
        
    def _validate_single_artifact_access(self, artifact_id: str, ...) -> None:
        """Validate a single evidence artifact's organization ownership."""
        
    def _log_access_attempt(self, artifact_ids: List[str], ...) -> None:
        """Comprehensive audit logging for all access attempts."""
```

Features:
- Validates all referenced evidence artifacts belong to requesting org
- Logs successful and failed access attempts for audit
- Provides clear error messages for access denial
- Integrates with existing `enforce_org_ownership` method

Phase 2: Endpoint Integration
---------------------------

Update: `api/v1/humanitarian.py`

Add required headers and evidence validation to the humanitarian verification endpoint:

```python
@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    request: HumanitarianVerificationRequest,
    x_org_id: str = Header(default="", alias="X-Org-Id"),
    x_user_id: str = Header(default="", alias="X-User-Id"),
    x_user_role: str = Header(default="", alias="X-User-Role"),
) -> ResultEnvelope[Dict[str, Any]]:
    
    # Validate evidence ownership if artifacts are referenced
    if request.artifact_ids and evidence_access_control:
        try:
            evidence_access_control.validate_evidence_access(
                artifact_ids=request.artifact_ids,
                org_id=x_org_id,
                user_id=x_user_id,
                user_role=x_user_role,
                correlation_id=correlation_id_var.get(),
            )
        except EvidenceAccessControlError as exc:
            logger.warning("Forbid own access", extra={...})
            raise HTTPException(status_code=403, detail=str(exc))
```

Phase 3: Service Initialization
------------------------------

Update: `main.py`

Initialize the evidence access control service alongside the artifact access service:

```python
# Initialize evidence access control service
from services.artifact_access import ArtifactAccessService
from services.evidence_access_control import EvidenceAccessControl

# Create artifact access service and wrap with evidence access control
artifact_access_service_instance = ArtifactAccessService(
    artifacts_dir=settings.verification_artifacts_dir,
    signing_secret=settings.artifact_signing_secret,
    ttl_seconds=settings.verification_artifact_url_ttl_seconds,
)
evidence_access_control = EvidenceAccessControl(artifact_access_service_instance)
```

Integration with Existing Cache System
====================================

The existing cache system already uses `artifact_ids` for cache key generation:

```python
# In api/v1/humanitarian.py
artifact_tag = ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""

# In services/cache.py
@cached_response(key_tags=["model_version", "artifact_tag"])
async def verify(...):
    # ... cache logic
```

Enhancement Required:
- Evidence validation should happen BEFORE cache generation to prevent cache pollution
- Invalid artifact IDs should not be cached
- Cross-org access attempts should be logged even if cached entry exists

Access Control Rules
====================

Rule 1: Organization Boundary Enforcement
----------------------------------------
- Evidence artifacts can only be processed by their owning organization
- Organizations cannot process evidence from other organizations
- All verification requests must include X-Org-Id header

Rule 2: Role-Based Access Control
--------------------------------
- Admin, Operator, and Reviewer roles: Can process evidence from their organization
- Reviewer role: Can access evidence for audit purposes, but restricted from triggering AI processing
  - [Implementation requirement: Need to check current implementation]

Rule 3: Evidence Validation Before Processing
--------------------------------------------
- All artifact references in `artifact_ids` must be validated
- Validation checks:
  1. Artifact exists and is accessible
  2. Artifact belongs to requesting organization
  3. Artifact is not expired or invalidated
  4. Requesting user has permission to access the artifact

Rule 4: Comprehensive Audit Logging
-----------------------------------
All evidence access attempts must be logged with:
- Artifact IDs being accessed
- Requesting organization and user IDs
- User role making the request
- Operation type (verify, view, etc.)
- Access status (authorized/denied)
- Reason for denial if applicable
- Correlation ID for request tracing

Rule 5: Error Handling and User Feedback
----------------------------------------
- Unauthorized access: Return 403 with clear error message
- Invalid artifacts: Return 404 for non-existent artifacts
- Invalid roles: Return 403 for unauthorized roles
- Missing headers: Return 400 for missing X-User-Role, X-Org-Id, X-User-Id

Audit Requirements
==================

1. Log all access attempts (both successful and failed)
2. Include sufficient context for audit trail (org_id, user_id, role, artifact_ids, operation)
3. Store logs in a tamper-evident system
4. Provide administrative interface to query audit logs
5. Include correlation IDs to trace complete request flow

Testing Strategy
===============

Unit Tests:
- `services/evidence_access_control.py`: Test validation logic
- Error cases (cross-org access, missing artifacts, invalid roles)
- Success cases (same-org access)
- Audit logging verification

Integration Tests:
- End-to-end: `api/v1/humanitarian.py` endpoint tests
- Cross-org access denial paths
- Audit logging verification at system level

Test Coverage Requirements:
1. Evidence from same org can be processed ✓
2. Evidence from different org is denied (403) ✓
3. All artifact IDs in request are validated
4. Invalid artifact IDs are rejected
5. Valid requests are processed normally
6. Audit logs capture all access attempts
7. Missing/invalid headers are rejected

Performance Considerations
==========================

1. Validation should be efficient (single query per artifact)
2. Audit logging should not significantly impact response time
3. Validation should happen before cache generation
4. Rate limiting should still apply to validation endpoints

Deployment Checklist
===================

[ ] Implement EvidenceAccessControl service
[ ] Update humanitarian verification endpoint
[ ] Add comprehensive audit logging
[ ] Create unit tests for evidence access control
[ ] Create integration tests for cross-org denial
[ ] Update existing documentation
[ ] Add monitoring and alerting for access attempts
[ ] Test in staging environment
[ ] Deploy to production

Rollback Plan
=============

If issues are encountered:
1. Disable evidence ownership validation with configuration flag
2. Remove audit logging temporarily
3. Revert to only role-based access control without org validation
4. Fix issues and redeploy with full validation enabled

Next Steps
==========

1. Develop the EvidenceAccessControl service
2. Implement evidence validation in the humanitarian verification endpoint
3. Add comprehensive audit logging
4. Create test suite for evidence access control
5. Deploy to staging environment for testing
6. Monitor production usage and logs
7. Full production rollout

This implementation will ensure evidence artifacts are only processed by their owning organizations,
providing critical security and compliance for humanitarian aid operations.