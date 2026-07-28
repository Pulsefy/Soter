from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class AnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = Field(None, examples=["campaign-2024-001"])
    claim_id: Optional[str] = Field(None, examples=["claim-abc123"])
    package_id: Optional[str] = Field(None, examples=["package-x7y8z9"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "campaign_ref": "campaign-2024-001",
                    "claim_id": "claim-abc123"
                }
            ]
        }
    }


class ResultEnvelope(BaseModel, Generic[T]):
    """
    Standardized success-path envelope returned by all AI inference endpoints.

    Fields
    ------
    result          The endpoint-specific payload (type varies by endpoint).
    confidence      Aggregate confidence score in [0, 1], when meaningful.
    reasons         Human-readable list of reasons / explanations.
    anchor_metadata Pass-through of the caller-supplied correlation metadata.
    trace_id        Request-scoped correlation ID echoed from the
                    X-Correlation-Id / X-Request-Id header for distributed
                    tracing.
    """

    result: T
    confidence: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Aggregate confidence score in [0, 1].",
        examples=[0.92],
    )
    reasons: Optional[List[str]] = Field(
        None,
        description="Human-readable explanations or reasons for the result.",
        examples=[["Liveness verification passed"]],
    )
    anchor_metadata: Optional[AnchorMetadata] = None
    trace_id: Optional[str] = Field(
        None,
        description="Request-scoped correlation ID for distributed tracing.",
        examples=["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    )
