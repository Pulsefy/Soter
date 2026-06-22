from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ClaimMetadata(BaseModel):
    claim_id: str
    ip_address: Optional[str] = None
    evidence_hash: Optional[str] = None
    amount: Optional[float] = None
    location: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class FraudDetectionRequest(BaseModel):
    claims: List[ClaimMetadata] = Field(min_length=1)


class ClaimFraudResult(BaseModel):
    claim_id: str
    fraud_risk_score: float = Field(ge=0.0, le=1.0)
    is_flagged: bool
    reason: Optional[str] = None


class FraudDetectionResponse(BaseModel):
    results: List[ClaimFraudResult]
    flagged_count: int
