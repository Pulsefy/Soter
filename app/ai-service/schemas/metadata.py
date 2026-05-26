"""Verification metadata schemas for on-chain anchoring."""

from typing import Optional
from pydantic import BaseModel, Field, validator
import uuid


class VerificationMetadata(BaseModel):
    """Metadata for anchoring verification results to on-chain events."""

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
    
    # Additional traceable identifiers
    verification_timestamp: int = Field(
        ...,
        description="Unix timestamp when verification was performed"
    )
    verification_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this verification run"
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

    @validator("verification_timestamp")
    def validate_timestamp(cls, v):
        """Ensure verification_timestamp is positive and reasonable."""
        if v <= 0:
            raise ValueError("verification_timestamp must be positive")
        # Check if timestamp is within reasonable bounds (allow timestamps up to year 2100)
        if v > 4102444800:  # Jan 1, 2100
            raise ValueError("verification_timestamp appears to be unreasonably far in the future")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "campaign_id": "camp_abc123def456",
                "claim_id": "claim_xyz789uvw012",
                "package_id": "pkg_mnop345qrst678",
                "verification_timestamp": 1672531200,
                "verification_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
            }
        }
