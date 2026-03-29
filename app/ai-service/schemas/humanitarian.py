from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class HumanitarianVerificationRequest(BaseModel):
    aid_claim: str = Field(min_length=10, description="Aid claim to verify")
    supporting_evidence: List[str] = Field(default_factory=list)
    context_factors: Dict[str, Any] = Field(default_factory=dict)
    provider_preference: Literal["auto", "openai", "groq"] = "auto"


class HumanitarianVerificationResponse(BaseModel):
    success: bool
    provider: Optional[str] = None
    model: Optional[str] = None
    prompt_variant: Optional[str] = None
    verification: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
