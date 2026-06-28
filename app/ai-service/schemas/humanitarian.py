from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class HumanitarianVerificationRequest(BaseModel):
    aid_claim: str = Field(min_length=10, description="Aid claim to verify", examples=["Family of 5 displaced by flood needs food and shelter"])
    supporting_evidence: List[str] = Field(default_factory=list, examples=[["photo of damaged home", "local report"]])
    context_factors: Dict[str, Any] = Field(default_factory=dict, examples=[{"location": "Kano, Nigeria", "disaster_type": "flood"}])
    provider_preference: Literal["auto", "test", "openai", "groq"] = Field("auto", examples=["auto"])
    timeout: Optional[float] = Field(default=None, description="Request-level timeout in seconds for provider call", examples=[30.0])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "aid_claim": "Family of 5 displaced by flood needs food and shelter",
                    "supporting_evidence": ["photo of damaged home"],
                    "context_factors": {"location": "Kano, Nigeria", "disaster_type": "flood"},
                    "provider_preference": "auto",
                    "timeout": 30.0,
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                }
            ]
        }
    }


class HumanitarianVerificationResponse(BaseModel):
    success: bool = Field(examples=[True])
    provider: Optional[str] = Field(None, examples=["test"])
    model: Optional[str] = Field(None, examples=["gpt-4o"])
    prompt_variant: Optional[str] = Field(None, examples=["v1"])
    verification: Optional[Dict[str, Any]] = Field(None, examples=[{"eligible": True, "confidence": 0.9, "reasoning": "Claim meets humanitarian criteria"}])
    error: Optional[str] = Field(None, examples=["Provider timed out"])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "success": True,
                    "provider": "test",
                    "model": "gpt-4o",
                    "prompt_variant": "v1",
                    "verification": {"eligible": True, "confidence": 0.9, "reasoning": "Claim meets humanitarian criteria"},
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
                },
                {
                    "success": False,
                    "error": "Provider timed out"
                }
            ]
        }
    }