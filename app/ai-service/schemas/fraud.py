from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class FraudExplanationCode(str, Enum):
    ANOMALY_DETECTED = "ANOMALY_DETECTED"
    # Additional codes can be added here as new detection rules are implemented


class FraudBand(str, Enum):
    """
    Human-readable risk band derived from the normalised fraud_risk_score.

    Band boundaries are driven by the service's configured thresholds:
      pass    : score < fraud_review_threshold (default 0.40)
      review  : fraud_review_threshold <= score < fraud_reject_threshold (default 0.75)
      reject  : score >= fraud_reject_threshold (default 0.75)
    """

    PASS = "pass"
    REVIEW = "review"
    REJECT = "reject"


class ClaimMetadata(BaseModel):
    claim_id: str = Field(examples=["claim-abc123"])
    ip_address: Optional[str] = Field(None, examples=["192.168.1.1"])
    evidence_hash: Optional[str] = Field(None, examples=["abc123def456"])
    amount: Optional[float] = Field(None, examples=[100.0])
    location: Optional[str] = Field(None, examples=["Kano, Nigeria"])
    extra: Dict[str, Any] = Field(
        default_factory=dict, examples=[{"source": "mobile_app"}]
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claim_id": "claim-abc123",
                    "ip_address": "192.168.1.1",
                    "amount": 100.0,
                    "location": "Kano, Nigeria",
                }
            ]
        }
    }


class FraudDetectionRequest(BaseModel):
    claims: List[ClaimMetadata] = Field(min_length=1)
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claims": [
                        {
                            "claim_id": "claim-abc123",
                            "ip_address": "192.168.1.1",
                            "amount": 100.0,
                            "location": "Kano, Nigeria",
                        },
                        {
                            "claim_id": "claim-def456",
                            "ip_address": "192.168.1.2",
                            "amount": 100.0,
                            "location": "Kano, Nigeria",
                        },
                    ],
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001"},
                }
            ]
        }
    }


class ClaimFraudResult(BaseModel):
    claim_id: str = Field(examples=["claim-abc123"])
    fraud_risk_score: float = Field(ge=0.0, le=1.0, examples=[0.15, 0.95])
    band: FraudBand = Field(
        examples=[FraudBand.PASS, FraudBand.REJECT],
        description=(
            "Risk band derived from fraud_risk_score and current threshold configuration. "
            "pass = score < review_threshold; review = review_threshold <= score < reject_threshold; "
            "reject = score >= reject_threshold."
        ),
    )
    is_flagged: bool = Field(examples=[False, True])
    code: Optional[FraudExplanationCode] = Field(
        None, examples=[FraudExplanationCode.ANOMALY_DETECTED]
    )
    reason: Optional[str] = Field(None, examples=["Statistical outlier in amount"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claim_id": "claim-abc123",
                    "fraud_risk_score": 0.15,
                    "band": "pass",
                    "is_flagged": False,
                },
                {
                    "claim_id": "claim-def456",
                    "fraud_risk_score": 0.95,
                    "band": "reject",
                    "is_flagged": True,
                    "code": "ANOMALY_DETECTED",
                    "reason": "Statistical outlier in amount",
                },
            ]
        }
    }


class FraudDetectionResponse(BaseModel):
    results: List[ClaimFraudResult]
    flagged_count: int = Field(examples=[1])
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "results": [
                        {
                            "claim_id": "claim-abc123",
                            "fraud_risk_score": 0.15,
                            "band": "pass",
                            "is_flagged": False,
                        },
                        {
                            "claim_id": "claim-def456",
                            "fraud_risk_score": 0.95,
                            "band": "reject",
                            "is_flagged": True,
                            "code": "ANOMALY_DETECTED",
                            "reason": "Statistical outlier in amount",
                        },
                    ],
                    "flagged_count": 1,
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001"},
                }
            ]
        }
    }
