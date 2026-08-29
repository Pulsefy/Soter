from typing import Any, Dict, Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar("T")


class AnchorMetadata(BaseModel):
    campaign_ref: Optional[str] = Field(None, examples=["campaign-2024-001"])
    claim_id: Optional[str] = Field(None, examples=["claim-abc123"])
    package_id: Optional[str] = Field(None, examples=["package-x7y8z9"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"campaign_ref": "campaign-2024-001", "claim_id": "claim-abc123"}
            ]
        }
    }


class PromptVersionInfo(BaseModel):
    """Identity of a specific prompt used to produce an AI result.

    Populated on the ``ResultEnvelope.prompt_versions`` map so every
    successful AI response can be traced to the exact prompt (name + version) that
    produced it.

    ``content_hash`` is the SHA256 hex digest of the rendered prompt text
    (system + user) for a given call. Tests assert this hash against the
    registry's known content for the declared version, preventing drift.
    """

    name: str = Field(
        ...,
        description="Prompt name as registered in PromptRegistry.",
        examples=["humanitarian_primary"],
    )
    version: str = Field(
        ...,
        description="Prompt version string as registered.",
        examples=["1.0"],
    )
    content_hash: str = Field(
        ...,
        description="SHA256 hex digest of the rendered (system+user) prompt text.",
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "name": "humanitarian_primary",
                    "version": "1.0",
                    "content_hash": "a1b2c3d4e5f6789012345678abcdef123456789012345678abcdef12345678",
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
    prompt_versions Map of prompt-variant label -> PromptVersionInfo. Lets every
                    result can be traced to the exact prompt version. For
                    humanitarian endpoint populates keys "primary" / fallback"
                    and "fallback" variants.
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
    prompt_versions: Optional[Dict[str, PromptVersionInfo]] = Field(
        None,
        description=(
            "Map of prompt-variant label to PromptVersionInfo. Records the "
            "prompt_name and version used to produce the result. For the "
            "humanitarian endpoint the keys are 'primary' and 'fallback'."
        ),
        examples=[
            {
                "primary": {
                    "name": "humanitarian_primary",
                    "version": "1.0",
                    "content_hash": "a1b2c3",
                },
            }
        ],
    )
