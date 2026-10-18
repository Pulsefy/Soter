from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata
from datetime import datetime


class FraudExplanationCode(str, Enum):
    ANOMALY_DETECTED = "ANOMALY_DETECTED"
    # Additional codes can be added here as new detection rules are implemented


class FraudBand(str, Enum):
    """Decision band derived from a claim's fraud_risk_score.

    PASS: score below FRAUD_PASS_MAX_SCORE - no action needed.
    REVIEW: score between the pass and review thresholds - a human should
        look at the claim before it proceeds.
    REJECT: score at/above FRAUD_REVIEW_MAX_SCORE - treat as fraudulent
        pending appeal.
    """

    PASS = "PASS"
    REVIEW = "REVIEW"
    REJECT = "REJECT"


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
    is_flagged: bool = Field(examples=[False, True])
    band: FraudBand = Field(examples=[FraudBand.PASS, FraudBand.REJECT])
    code: Optional[FraudExplanationCode] = Field(
        None, examples=[FraudExplanationCode.ANOMALY_DETECTED]
    )
    reason: Optional[str] = Field(None, examples=["Statistical outlier in amount"])
    decision_audit_id: Optional[str] = Field(
        None, examples=["audit-abc123"], description="Reference to the decision audit entry for this claim"
    )

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claim_id": "claim-abc123",
                    "fraud_risk_score": 0.15,
                    "is_flagged": False,
                },
                {
                    "claim_id": "claim-def456",
                    "fraud_risk_score": 0.95,
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
                            "is_flagged": False,
                        },
                        {
                            "claim_id": "claim-def456",
                            "fraud_risk_score": 0.95,
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


class ReviewerDecision(str, Enum):
    """Final human reviewer decision on a flagged claim."""

    CONFIRMED_FRAUD = "CONFIRMED_FRAUD"
    FALSE_POSITIVE = "FALSE_POSITIVE"
    INCONCLUSIVE = "INCONCLUSIVE"


class FraudFeedbackRecord(BaseModel):
    """Captures a reviewer's final decision on a flagged claim.

    Links back to the original fraud score and band. Sensitive claim content
    is NOT duplicated here - the decision_audit_id references the existing
    decision audit entry that holds the underlying claim details.
    """

    claim_id: str = Field(examples=["claim-def456"])
    decision_audit_id: str = Field(
        examples=["audit-abc123"],
        description="Reference to the existing decision audit entry; no sensitive content is duplicated",
    )
    fraud_risk_score: float = Field(ge=0.0, le=1.0, examples=[0.95])
    predicted_band: FraudBand = Field(examples=[FraudBand.REJECT])
    reviewer_decision: ReviewerDecision = Field(
        examples=[ReviewerDecision.CONFIRMED_FRAUD]
    )
    reviewer_id: Optional[str] = Field(None, examples=["reviewer-42"])
    notes: Optional[str] = Field(None, examples=["Confirmed via manual review"])
    decided_at: datetime = Field(examples=["2024-01-15T10:30:00Z"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claim_id": "claim-def456",
                    "decision_audit_id": "audit-abc123",
                    "fraud_risk_score": 0.95,
                    "predicted_band": "REJECT",
                    "reviewer_decision": "CONFIRMED_FRAUD",
                    "reviewer_id": "reviewer-42",
                    "decided_at": "2024-01-15T10:30:00Z",
                }
            ]
        }
    }


class FraudFeedbackRequest(BaseModel):
    records: List[FraudFeedbackRecord] = Field(min_length=1)
    anchor_metadata: Optional[AnchorMetadata] = None


class BandOutcomeStats(BaseModel):
    """Predicted band vs actual outcome counts over a rolling window."""

    band: FraudBand
    total: int = Field(examples=[10])
    confirmed_fraud: int = Field(examples=[6])
    false_positive: int = Field(examples=[3])
    inconclusive: int = Field(examples=[1])
    precision: Optional[float] = Field(
        None, ge=0.0, le=1.0, examples=[0.6],
        description="confirmed_fraud / total for this band",
    )


class FraudFeedbackReport(BaseModel):
    """Rolling-window comparison of predicted bands against actual outcomes.

    Distinct from the fixture-based calibration report: this reflects
    real-world reviewer decisions rather than the static golden fixture set.
    """

    window_start: datetime = Field(examples=["2024-01-01T00:00:00Z"])
    window_end: datetime = Field(examples=["2024-01-31T23:59:59Z"])
    total_records: int = Field(examples=[25])
    band_stats: List[BandOutcomeStats]
    anchor_metadata: Optional[AnchorMetadata] = None

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "window_start": "2024-01-01T00:00:00Z",
                    "window_end": "2024-01-31T23:59:59Z",
                    "total_records": 25,
                    "band_stats": [
                        {
                            "band": "REJECT",
                            "total": 10,
                            "confirmed_fraud": 6,
                            "false_positive": 3,
                            "inconclusive": 1,
                            "precision": 0.6,
                        }
                    ],
                }
            ]
        }
    }
