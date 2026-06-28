from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from schemas.common import AnchorMetadata


class ClaimMetadata(BaseModel):
    claim_id: str = Field(examples=["claim-abc123"])
    ip_address: Optional[str] = Field(None, examples=["192.168.1.1"])
    evidence_hash: Optional[str] = Field(None, examples=["abc123def456"])
    amount: Optional[float] = Field(None, examples=[100.0])
    location: Optional[str] = Field(None, examples=["Kano, Nigeria"])
    extra: Dict[str, Any] = Field(default_factory=dict, examples=[{"source": "mobile_app"}])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "claim_id": "claim-abc123",
                    "ip_address": "192.168.1.1",
                    "amount": 100.0,
                    "location": "Kano, Nigeria"
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
                        {"claim_id": "claim-abc123", "ip_address": "192.168.1.1", "amount": 100.0, "location": "Kano, Nigeria"},
                        {"claim_id": "claim-def456", "ip_address": "192.168.1.2", "amount": 100.0, "location": "Kano, Nigeria"}
                    ],
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001"}
                }
            ]
        }
    }


class ClaimFraudResult(BaseModel):
    claim_id: str = Field(examples=["claim-abc123"])
    fraud_risk_score: float = Field(ge=0.0, le=1.0, examples=[0.15, 0.95])
    is_flagged: bool = Field(examples=[False, True])
    reason: Optional[str] = Field(None, examples=["Statistical outlier in amount"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"claim_id": "claim-abc123", "fraud_risk_score": 0.15, "is_flagged": False},
                {"claim_id": "claim-def456", "fraud_risk_score": 0.95, "is_flagged": True, "reason": "Statistical outlier in amount"}
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
                        {"claim_id": "claim-abc123", "fraud_risk_score": 0.15, "is_flagged": False},
                        {"claim_id": "claim-def456", "fraud_risk_score": 0.95, "is_flagged": True, "reason": "Statistical outlier in amount"}
                    ],
                    "flagged_count": 1,
                    "anchor_metadata": {"campaign_ref": "campaign-2024-001"}
                }
            ]
        }
    }
