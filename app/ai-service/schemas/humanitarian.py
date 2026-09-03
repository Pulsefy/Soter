from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class LLMVerificationPayload(BaseModel):
    """Expected shape of a verification LLM's parsed JSON response.

    Only the fields every prompt variant asks for and that downstream code
    actually reads (`verdict`, `confidence`) are required; the rest of the
    requested schema (`criteria_assessment`, `risk_flags`, etc.) is accepted
    but not enforced here; the response is still processed by the caller
    with those fields present if the provider included them. This model
    exists to catch what genuinely renders a response unusable -- a missing
    verdict, an out-of-range confidence, or a wrong type -- not to be a
    strict superset check that would reject an otherwise-usable answer over
    an omitted optional field.
    """

    model_config = {"extra": "allow"}

    verdict: Literal["credible", "partially_credible", "inconclusive", "not_credible"]
    confidence: float = Field(ge=0.0, le=1.0)


class HumanitarianVerificationRequest(BaseModel):
    aid_claim: str = Field(
        min_length=10,
        description="Aid claim to verify",
        examples=["Family of 5 displaced by flood needs food and shelter"],
    )
    supporting_evidence: List[str] = Field(
        default_factory=list, examples=[["photo of damaged home", "local report"]]
    )
    context_factors: Dict[str, Any] = Field(
        default_factory=dict,
        examples=[{"location": "Kano, Nigeria", "disaster_type": "flood"}],
    )
    provider_preference: Literal["auto", "test", "openai", "groq"] = Field(
        "auto", examples=["auto"]
    )
    timeout: Optional[float] = Field(
        default=None,
        description="Request-level timeout in seconds for provider call",
        examples=[30.0],
    )
    artifact_ids: List[str] = Field(
        default_factory=list,
        description="IDs of evidence artifacts (see /ai/verification-artifacts) referenced by this claim. "
        "Used to key the response cache so it can be explicitly invalidated when an artifact is updated.",
        examples=[["artifact_abc123"]],
    )
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "aid_claim": "Family of 5 displaced by flood needs food and shelter",
                    "supporting_evidence": ["photo of damaged home"],
                    "context_factors": {
                        "location": "Kano, Nigeria",
                        "disaster_type": "flood",
                    },
                    "provider_preference": "auto",
                    "timeout": 30.0,
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
                }
            ]
        }
    }


class HumanitarianVerificationResponse(BaseModel):
    success: bool = Field(examples=[True])
    provider: Optional[str] = Field(None, examples=["test"])
    model: Optional[str] = Field(None, examples=["gpt-4o"])
    prompt_variant: Optional[str] = Field(None, examples=["v1"])
    verification: Optional[Dict[str, Any]] = Field(
        None,
        examples=[
            {
                "eligible": True,
                "confidence": 0.9,
                "reasoning": "Claim meets humanitarian criteria",
            }
        ],
    )
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
                    "verification": {
                        "eligible": True,
                        "confidence": 0.9,
                        "reasoning": "Claim meets humanitarian criteria",
                    },
                    "anchor_metadata": {
                        "campaign_ref": "campaign-2024-001",
                        "claim_id": "claim-abc123",
                    },
                },
                {"success": False, "error": "Provider timed out"},
            ]
        }
    }
