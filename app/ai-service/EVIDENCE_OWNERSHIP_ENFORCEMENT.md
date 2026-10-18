# Soter AI Service - Evidence Ownership Enforcement

This document outlines the implementation of evidence ownership and access rules for the AI service when processing evidence references.

## Overview

The AI service must enforce organization ownership and audit access controls when backend provides evidence references (artifact IDs) to AI models for processing. This ensures evidence can only be processed by its owning organization, providing security and compliance.

## Implementation Steps

### 1. Design Changes

#### Evidence Model Enhancement

Evidence artifacts now include organization ownership information:

```python
# schemas/uploads.py
class EvidenceArtifact(BaseModel):
    artifact_id: str
    org_id: str  # Organization ownership identifier
    owner_id: str  # User who uploaded the evidence
    filename: str
    content_type: str
    metadata: Dict[str, Any]
    created_at: datetime
    expires_at: Optional[datetime]
```

#### Access Control Middleware

Create a middleware/interceptor to validate evidence ownership:

```python
# services/evidence_access_control.py
class EvidenceAccessControl:
    def __init__(self, artifact_access_service):
        self.artifact_access_service = artifact_access_service
    
    async def validate_evidence_access(
        self, artifact_ids: List[str], org_id: str, user_id: str, user_role: str
    ):
        """Validate that all evidence artifacts belong to the requesting org."""
        # Role-based validation
        if user_role == "reviewer":
            # Reviewers can only access artifacts for audit/verification
            # But cannot trigger processing of unverified evidence
            # This is handled at the endpoint level
            pass
        
        # Check organization ownership for each artifact
        for artifact_id in artifact_ids:
            try:
                # Use existing artifact validation logic
                artifact_path, metadata = self.artifact_access_service.resolve_artifact(artifact_id)
                self.artifact_access_service.enforce_org_ownership(metadata, org_id)
                
                # Audit logging
                self._log_access_attempt(
                    artifact_id, org_id, user_id, user_role, 
                    operation="verify", status="authorized"
                )
                
            except ArtifactAccessError as e:
                # Audit logging for denied access
                self._log_access_attempt(
                    artifact_id, org_id, user_id, user_role,
                    operation="verify", status="denied", reason=str(e)
                )
                raise
    
    def _log_access_attempt(self, artifact_id, org_id, user_id, user_role, operation, status, reason=None):
        """Log access attempts for audit purposes."""
        logger.info(
            "evidence_access_logged",
            extra={
                "event": "evidence_access_check",
                "artifact_id": artifact_id,
                "org_id": org_id,
                "user_id": user_id,
                "role": user_role,
                "operation": operation,
                "status": status,
                "reason": reason,
                "timestamp": int(time.time()),
            }
        )
```

### 2. API Endpoint Enforcement

Modify the humanitarian verification endpoint to validate evidence ownership:

```python
# api/v1/humanitarian.py
@router.post("/ai/humanitarian/verify", response_model=ResultEnvelope[Dict[str, Any]])
async def verify_humanitarian_claim(
    request: HumanitarianVerificationRequest,
    x_org_id: str = Header(..., alias="X-Org-Id"),
    x_user_id: str = Header(..., alias="X-User-Id"),
    x_user_role: str = Header(..., alias="X-User-Role"),
) -> ResultEnvelope[Dict[str, Any]]:
    """
    Verify an aid claim against standardized humanitarian criteria.
    
    Validates that all referenced evidence artifacts belong to the requesting
    organization before processing. Maintains audit logs for access attempts.
    """
    import main as _main
    from main import correlation_id_var
    from services.evidence_access_control import EvidenceAccessControl
    
    logger.info("Processing humanitarian verification request with evidence ownership validation")
    
    try:
        # Initialize evidence access control
        artifact_access_service = artifacts_module.artifact_access_service
        evidence_control = EvidenceAccessControl(artifact_access_service)
        
        # Validate evidence ownership if artifacts are referenced
        if request.artifact_ids:
            evidence_control.validate_evidence_access(
                artifact_ids=request.artifact_ids,
                org_id=x_org_id,
                user_id=x_user_id,
                user_role=x_user_role,
            )
        
        model_version = _main.humanitarian_verification_service.get_model_version(
            request.provider_preference
        )
        artifact_tag = ",".join(sorted(request.artifact_ids)) if request.artifact_ids else ""
        
        # ... rest of the function remains the same
    
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        raise
```

### 3. Model Provider Access Control

Enhance the humanitarian verification service to integrate evidence access validation:

```python
# services/humanitarian_verification.py
class HumanitarianVerificationService:
    def __init__(self, evidence_access_control: EvidenceAccessControl = None):
        self.prompt_engine = HumanitarianPromptEngine()
        self.evidence_control = evidence_access_control
        
        # ... existing initialization
    
    def verify_claim(
        self,
        aid_claim: str,
        supporting_evidence: Optional[List[str]] = None,
        context_factors: Optional[Dict[str, Any]] = None,
        provider_preference: str = "auto",
        timeout: Optional[float] = None,
        org_id: Optional[str] = None,  # New parameter for ownership
        user_id: Optional[str] = None,  # New parameter for audit
        user_role: Optional[str] = None,  # New parameter for authorization
    ) -> Dict[str, Any]:
        """
        Runs humanitarian verification with evidence ownership validation.
        
        Verifies that all evidence artifacts belong to the requesting organization
        before processing with AI models.
        """
        # Validate evidence ownership if requested
        if self.evidence_control and (org_id and artifact_ids):
            self.evidence_control.validate_evidence_access(
                artifact_ids=artifact_ids,
                org_id=org_id,
                user_id=user_id or "unknown",
                user_role=user_role or "reviewer",
            )
        
        # ... rest of existing verification logic
```

### 4. Cache Key Modification

Update cache key generation to include org_id for evidence with ownership:

```python
# services/cache.py
def _generate_key(
    self,
    prefix: str,
    *args: Any,
    tags: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> str:
    # ... existing key generation logic
    
    # Add organization to key tags for ownership-based caching
    if "org_id" in kwargs:
        tags["org_id"] = kwargs["org_id"]
    
    # ... continue with tag processing
```

### 5. Integration Tests

Create comprehensive test coverage for cross-org evidence access:

```python
# tests/test_evidence_access_control.py
import pytest
from fastapi.testclient import TestClient
from services.evidence_access_control import EvidenceAccessControl, EvidenceAccessControlError

class TestEvidenceAccessControl:
    def test_cross_org_access_denied(self, client, artifact_fixture):
        """Test that evidence from different orgs cannot be processed."""
        # Request evidence belonging to org-123 while providing org-999
        payload = {
            "aid_claim": "Test claim",
            "supporting_evidence": ["Some evidence"],
            "artifact_ids": [artifact_fixture],  # Belongs to org-123
            "provider_preference": "test",
            "context_factors": {},
        }
        
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers={
                "X-User-Role": "operator",
                "X-Org-Id": "org-999",  # Different org!
                "X-User-Id": "user-1",
            },
            json=payload,
        )
        
        # Should be denied - evidence belongs to different org
        assert response.status_code == 403
        assert "Access denied" in response.json()["error"]["message"]
    
    def test_same_org_access_allowed(self, client, artifact_fixture):
        """Test that evidence from same org can be processed."""
        payload = {
            "aid_claim": "Test claim",
            "supporting_evidence": ["Some evidence"],
            "artifact_ids": [artifact_fixture],  # Belongs to org-123
            "provider_preference": "test",
            "context_factors": {},
        }
        
        response = client.post(
            "/v1/ai/humanitarian/verify",
            headers={
                "X-User-Role": "operator",
                "X-Org-Id": "org-123",  # Same org
                "X-User-Id": "user-1",
            },
            json=payload,
        )
        
        # Should be allowed
        assert response.status_code == 200
        assert "result" in response.json()

class TestAuditLogging:
    def test_access_denied_is_audited(self, client, artifact_fixture, caplog):
        """Test that access denial attempts are logged for audit."""
        payload = {
            "aid_claim": "Test claim",
            "supporting_evidence": ["Some evidence"],
            "artifact_ids": [artifact_fixture],
            "provider_preference": "test",
            "context_factors": {},
        }
        
        client.post(
            "/v1/ai/humanitarian/verify",
            headers={
                "X-User-Role": "operator",
                "X-Org-Id": "org-999",  # Wrong org
                "X-User-Id": "user-1",
            },
            json=payload,
        )
        
        # Check that audit log contains the access attempt
        log_messages = [record.message for record in caplog.records]
        assert any("evidence_access_check" in msg for msg in log_messages)
        assert any("Access denied" in msg for msg in log_messages)
    
    def test_access_allowed_is_audited(self, client, artifact_fixture, caplog):
        """Test that successful access attempts are logged for audit."""
        payload = {
            "aid_claim": "Test claim",
            "supporting_evidence": ["Some evidence"],
            "artifact_ids": [artifact_fixture],
            "provider_preference": "test",
            "context_factors": {},
        }
        
        client.post(
            "/v1/ai/humanitarian/verify",
            headers={
                "X-User-Role": "operator",
                "X-Org-Id": "org-123",  # Correct org
                "X-User-Id": "user-1",
            },
            json=payload,
        )
        
        # Check that audit log contains the access attempt
        log_messages = [record.message for record in caplog.records]
        assert any("evidence_access_check" in msg for msg in log_messages)
        assert any("authorized" in msg for msg in log_messages)
```

## Audit Requirements Implementation

### 1. Comprehensive Audit Logging

The system logs all evidence access attempts including:

```python
# Log entry structure
{
    "event": "evidence_access_check",
    "artifact_id": "evidence-123",
    "org_id": "org-456",
    "user_id": "user-789",
    "role": "operator",
    "operation": "verify",
    "status": "authorized|denied",
    "reason": "Access denied: artifact belongs to a different organization",
    "timestamp": 1698765432,
    "trace_id": "correlation-id-from-request"
}
```

### 2. Access Check Endpoints

The system provides administrative endpoints to audit evidence access:

```python
# api/v1/evidence_access_audit.py
@router.get("/ai/evidence-access-audit")
async def get_evidence_access_audits(
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    artifact_id: Optional[str] = Query(None),
    org_id: Optional[str] = Query(None),
    user_role: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    x_user_role: str = Header(..., alias="X-User-Role"),
):
    """Retrieve evidence access audit logs with filtering."""
    if x_user_role not in {"admin", "operator"}:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    # Query audit logs based on filters
    audit_logs = audit_logger.query(
        start_time=start_time,
        end_time=end_time,
        artifact_id=artifact_id,
        org_id=org_id,
        user_role=user_role,
        status=status,
    )
    
    return {"audit_logs": audit_logs, "count": len(audit_logs)}
```

## Testing Strategy

### 1. Unit Tests

Test the evidence access control logic:

```bash
pytest tests/test_evidence_access_control.py -v
```

### 2. Integration Tests

Test cross-org access denial:

```bash
pytest tests/test_humanitarian_verify_access_control.py::TestEvidenceAccessControl -v
```

### 3. End-to-End Tests

Test the complete audit trail from request to log:

```bash
pytest tests/test_evidence_access_audit_e2e.py -v
```

### 4. Performance Tests

Ensure audit logging doesn't impact performance:

```bash
pytest tests/test_audit_performance.py -v
```

## Deployment Considerations

### 1. Log Storage

Audit logs need to be stored long-term for compliance:

- Configure appropriate log retention policies
- Ensure logs are immutable to prevent tampering
- Set up backup and disaster recovery for audit logs

### 2. Rate Limiting

Protect audit endpoints from abuse:

- Apply rate limiting to audit log retrieval endpoints
- Monitor for abnormal access patterns to audit logs

### 3. Monitoring

Set up alerts for suspicious access patterns:

- Alert on multiple failed access attempts from same IP
- Alert on access attempts to sensitive evidence
- Monitor log volume for potential log flooding attacks

## Compliance Checklist

[ ] Evidence artifacts validate organization ownership
[ ] Access attempts are logged with sufficient context
[ ] Unauthorized access is denied with appropriate error messages
[ ] Administrative interfaces for audit log access
[ ] Comprehensive test coverage for cross-org access
[ ] Performance testing to ensure audit logging doesn't impact throughput
[ ] Log retention policies implemented
[ ] Alerting for suspicious access patterns
[ ] Documentation of audit requirements

## Rollback Plan

If issues are encountered during deployment:

1. Disable evidence ownership validation by setting `EVIDENCE_OWNERSHIP_REQUIRED=false`
2. Temporarily disable audit logging to reduce log volume
3. Revert ownership validation while fixes are developed
4. Ensure no impact to existing non-violating access patterns

## Post-Implementation Actions

1. Review and clean up any redundant access control logic
2. Create dashboards for monitoring evidence access patterns
3. Document operational procedures for handling audit log inquiries
4. Conduct regular security reviews of evidence access controls
5. Update runbooks with procedures for handling access-related incidents

This implementation ensures evidence ownership enforcement, comprehensive audit logging, and complete test coverage while maintaining system performance and usability.