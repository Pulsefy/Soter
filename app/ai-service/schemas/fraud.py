from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, validator

from .metadata import VerificationMetadata


class ClaimMetadata(BaseModel):
    """Metadata for a specific claim in fraud detection."""
    
    claim_id: str = Field(
        ...,
        description="Unique identifier for the claim"
    )
    ip_address: Optional[str] = None
    evidence_hash: Optional[str] = None
    amount: Optional[float] = None
    location: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)
    
    # On-chain metadata
    campaign_id: Optional[str] = Field(
        None,
        description="Campaign identifier for context"
    )
    package_id: Optional[str] = Field(
        None,
        description="Package identifier for context"
    )

    @validator("claim_id")
    def validate_claim_id(cls, v):
        """Ensure claim_id is not empty or whitespace-only."""
        if not v or not v.strip():
            raise ValueError("claim_id cannot be empty or whitespace")
        return v.strip()


class ClaimFraudResult(BaseModel):
    """Fraud detection result for a single claim with metadata."""
    
    claim_id: str
    fraud_risk_score: float = Field(ge=0.0, le=1.0)
    is_flagged: bool
    reason: Optional[str] = None
    
    # On-chain metadata for anchoring
    campaign_id: Optional[str] = None
    package_id: Optional[str] = None


class FraudDetectionRequest(BaseModel):
    """Request for batch fraud detection analysis."""
    
    claims: List[ClaimMetadata] = Field(min_length=1)
    campaign_id: Optional[str] = Field(
        None,
        description="Optional campaign context for all claims"
    )

    @validator("campaign_id")
    def validate_campaign_id(cls, v):
        """Ensure campaign_id (if provided) is not empty or whitespace-only."""
        if v is not None:
            if not v.strip():
                raise ValueError("campaign_id cannot be empty or whitespace (must be None or non-empty)")
            return v.strip()
        return v


class FraudDetectionResponse(BaseModel):
    """Response containing fraud detection results with metadata."""
    
    results: List[ClaimFraudResult]
    flagged_count: int
    
    # Verification metadata for on-chain anchoring
    verification_metadata: Optional[VerificationMetadata] = None
