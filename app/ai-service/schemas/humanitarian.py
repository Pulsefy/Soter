import re
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class VerificationAnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = Field(default=None, description="Stable campaign reference used by backend/on-chain demo flows")
    claim_id: Optional[str] = Field(default=None, description="Stable claim identifier")
    package_id: Optional[str] = Field(default=None, description="Stable package identifier")

    @field_validator("campaign_ref", "claim_id", "package_id")
    @classmethod
    def validate_identifier(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("identifier must not be empty")
        if not IDENTIFIER_PATTERN.fullmatch(cleaned):
            raise ValueError(
                "identifier must start with an alphanumeric character and contain only letters, numbers, ., _, :, or -"
            )
        return cleaned

    @model_validator(mode="after")
    def require_at_least_one_identifier(self):
        if not any((self.campaign_ref, self.claim_id, self.package_id)):
            raise ValueError("anchor metadata must include at least one identifier")
        return self


class HumanitarianVerificationRequest(BaseModel):
    aid_claim: str = Field(min_length=10, description="Aid claim to verify")
    supporting_evidence: List[str] = Field(default_factory=list)
    context_factors: Dict[str, Any] = Field(default_factory=dict)
    anchor_metadata: Optional[VerificationAnchorMetadata] = None
    provider_preference: Literal["auto", "test", "openai", "groq"] = "auto"
    timeout: Optional[float] = Field(default=None, description="Request-level timeout in seconds for provider call")


class HumanitarianVerificationResponse(BaseModel):
    success: bool
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_variant: Optional[str] = None
    verification: Optional[Dict[str, Any]] = None
    anchor_metadata: Optional[VerificationAnchorMetadata] = None
    error: Optional[str] = None
