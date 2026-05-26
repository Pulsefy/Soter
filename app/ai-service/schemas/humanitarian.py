from typing import Any, Dict, List, Literal, Optional
import time

from pydantic import BaseModel, Field, validator

from .metadata import VerificationMetadata


class HumanitarianVerificationRequest(BaseModel):
    """Request for humanitarian verification with required metadata for on-chain anchoring."""
    
    aid_claim: str = Field(min_length=10, description="Aid claim to verify")
    supporting_evidence: List[str] = Field(default_factory=list)
    context_factors: Dict[str, Any] = Field(default_factory=dict)
    provider_preference: Literal["auto", "openai", "groq"] = "auto"
    
    # Metadata for on-chain anchoring
    campaign_id: str = Field(
        ...,
        min_length=1,
        description="Stable identifier for the aid campaign"
    )
    claim_id: str = Field(
        ...,
        min_length=1,
        description="Unique identifier for this specific claim"
    )
    package_id: Optional[str] = Field(
        None,
        description="Optional identifier for the aid package being claimed"
    )

    @validator("campaign_id")
    def validate_campaign_id(cls, v):
        """Ensure campaign_id is not empty or whitespace-only."""
        if not v or not v.strip():
            raise ValueError("campaign_id cannot be empty or whitespace")
        return v.strip()

    @validator("claim_id")
    def validate_claim_id(cls, v):
        """Ensure claim_id is not empty or whitespace-only."""
        if not v or not v.strip():
            raise ValueError("claim_id cannot be empty or whitespace")
        return v.strip()

    @validator("package_id")
    def validate_package_id(cls, v):
        """Ensure package_id (if provided) is not empty or whitespace-only."""
        if v is not None:
            if not v.strip():
                raise ValueError("package_id cannot be empty or whitespace (must be None or non-empty)")
            return v.strip()
        return v


class HumanitarianVerificationResponse(BaseModel):
    """Response containing verification results with on-chain metadata."""
    
    success: bool
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_variant: Optional[str] = None
    verification: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    
    # On-chain metadata for anchoring
    metadata: Optional[VerificationMetadata] = None
