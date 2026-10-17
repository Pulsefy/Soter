from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field
import hashlib
import json

T = TypeVar("T")


class AnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = Field(
        None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
        examples=["campaign-2024-001"],
    )
    claim_id: Optional[str] = Field(
        None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
        examples=["claim-abc123"],
    )
    package_id: Optional[str] = Field(
        None,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_-]+$",
        examples=["package-x7y8z9"],
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
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
    prompt_version  Version of the prompt template used for verification/inference.
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
    prompt_version: Optional[str] = Field(
        None,
        description="Version of the prompt template used for verification.",
        examples=["v1"],
    )


class IdempotencyKey(BaseModel):
    """
    Optional idempotency key supplied by callers to make inference requests
    replay-safe at the ai-service boundary.

    A resubmission with the same key and an identical payload within the
    bounded window returns the original result rather than reprocessing.
    A resubmission with the same key but a different payload is rejected
    with a conflict error.
    """

    key: str = Field(
        ...,
        min_length=1,
        max_length=128,
        pattern=r"^[a-zA-Z0-9_.:-]+$",
        description="Caller-supplied idempotency key.",
        examples=["req-7f3a9c2e-4b1d-4e8a-9c0f-1234567890ab"],
    )
    window_seconds: Optional[int] = Field(
        None,
        ge=1,
        le=86400,
        description="Bounded replay window in seconds. Defaults to service config.",
        examples=[900],
    )

    def payload_fingerprint(self, payload: object) -> str:
        """
        Compute a stable fingerprint of the request payload so that a
        resubmission with the same key but a different payload can be
        detected and rejected as a conflict.
        """
        if isinstance(payload, BaseModel):
            canonical = payload.model_dump(mode="json", exclude_none=True)
        else:
            canonical = payload
        encoded = json.dumps(
            canonical, sort_keys=True, separators=(",", ":"), default=str
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"key": "req-7f3a9c2e-4b1d-4e8a-9c0f-1234567890ab", "window_seconds": 900}
            ]
        }
    }
