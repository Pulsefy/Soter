"""
Fraud detection service using scikit-learn clustering.

Clusters claim metadata by similarity and flags outliers or clusters that exceed a risk threshold as potentially fraudulent.
"""

import logging
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np
from sklearn.preprocessing import LabelEncoder
from sklearn.neighbors import LocalOutlierFactor

from config import get_settings
from schemas.fraud import (
    ClaimMetadata,
    ClaimFraudResult,
    FraudBand,
    FraudExplanationCode,
)

logger = logging.getLogger(__name__)

# Dedicated logger for the decision audit trail. Kept separate from the
# general application logger so decision records can be routed/retained
# independently (e.g. shipped to a different sink or kept longer).

audit_logger = logging.getLogger("audit.fraud_detection")


#: Maximum number of recent decisions kept in memory for feedback linking.
#: This is a sliding window - older decisions are evicted as new ones arrive.
#: The audit log remains the durable record; this buffer only enables
# looking up the original score/band when a reviewer submits feedback.

_RECENT_DECISIONS_MAX = 10000
_recent_decisions: "deque[dict]" = deque(maxlen=_RECENT_DECISIONS_MAX)
_recent_decisions_by_id: Dict[str, dict] = {}


#: Reviewer feedback records. Each record references the original
#: decision audit entry (by decision_id) rather than duplicating claim
#: content, and captures the reviewer's final outcome.

_feedback_records: List[dict] = []


def _band_for_score(score: float, pass_max: float, review_max: float) -> FraudBand:
    """Map a normalised fraud_risk_score (0-1) to a decision band.

    Each threshold acts as a hard ceiling for the band below it: a score exactly equal to ``pass_max`` bands as REVIEW (not PASS), and a score exactly equal to ``review_max`` bands as REJECT (not REVIEW).
    """
    if score < pass_max:
        return FraudBand.PASS
    if score < review_max:
        return FraudBand.REVIEW
    return FraudBand.REJECT


def _log_decision(result: ClaimFraudResult, pass_max: float, review_max: float) -> str:
    """Record a single claim's decision for audit purposes.

    Logs the score, the band it was assigned, and the exact thresholds that were active at decision time - so if thresholds are retuned later, past decisions remain fully explainable from the logs alone.

    Returns the generated decision_id, which is the handle that reviewer
    feedback records use to reference this audit entry (without copying
    claim content into the feedback record).
    """
    decision_id = uuid.uuid4().hex
    audit_logger.info(
        "fraud_decision decision_id=%s claim_id=%s score=%s band=%s "
        "fraud_pass_max_score=%s fraud_review_max_score=%s rules_version=%s",
        decision_id,
        result.claim_id,
        result.fraud_risk_score,
        result.band.value,
        pass_max,
        review_max,
        FRAUD_RULES_VERSION,
    )
    record = {
        "decision_id": decision_id,
        "claim_id": result.claim_id,
        "fraud_risk_score": result.fraud_risk_score,
        "band": result.band.value,
        "pass_max": pass_max,
        "review_max": review_max,
        "rules_version": FRAUD_RULES_VERSION,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }
    if len(_recent_decisions) >= _RECENT_DECISIONS_MAX:
        evicted = _recent_decisions.popleft()
        _recent_decisions_by_id.pop(evicted["decision_id"], None)
    _recent_decisions.append(record)
    _recent_decisions_by_id[decision_id] = record
    return decision_id


#: Version of the fraud scoring rules. Fraud detection is statistical rather
#: than prompt-driven, so this constant plays the "prompt version" role in the
#: decision audit record (issue #990): bump it whenever the feature set or the
#: outlier threshold changes, so historical scores stay explainable.
FRAUD_RULES_VERSION = "fraud-lof-v1"


def _vectorize(claims: List[ClaimMetadata]) -> np.ndarray:
    """Convert claim metadata into a numeric feature matrix."""
    ip_enc = LabelEncoder()
    hash_enc = LabelEncoder()
    loc_enc = LabelEncoder()

    ips = [c.ip_address or "" for c in claims]
    hashes = [c.evidence_hash or "" for c in claims]
    locs = [c.location or "" for c in claims]
    amounts = [c.amount or 0.0 for c in claims]

    ip_enc.fit(ips)
    hash_enc.fit(hashes)
    loc_enc.fit(locs)

    return np.column_stack(
        [
            ip_enc.transform(ips),
            hash_enc.transform(hashes),
            loc_enc.transform(locs),
            amounts,
        ]
    ).astype(float)


def detect_fraud(claims: List[ClaimMetadata]) -> List[ClaimFraudResult]:
    """
    Analyse a batch of claims and return a fraud_risk_score for each.

    Uses Local Outlier Factor (unsupervised) to score each claim relative to its neighbours. Scores are normalised to [0, 1] where 1 = highest risk, then banded into pass / review / reject using the thresholds in
    Settings.fraud_pass_max_score and Settings.fraud_review_max_score.
    See reports/fraud_threshold_calibration.md for how the defaults were chosen. Every decision is written to the audit log via _log_decision.
    """
    settings = get_settings()
    pass_max = settings.fraud_pass_max_score
    review_max = settings.fraud_review_max_score

    if len(claims) == 1:
        # LOF needs at least 2 samples; single claim gets a neutral score

        band = _band_for_score(0.0, pass_max, review_max)
        result = ClaimFraudResult(
            claim_id=claims[0].claim_id,
            fraud_risk_score=0.0,
            is_flagged=False,
            band=band,
        )
        _log_decision(result, pass_max, review_max)
        return [result]
    X = _vectorize(claims)

    # Add tiny random noise to prevent identical point degeneracy and zero-distance division issues

    np.random.seed(42)
    X_noise = X + np.random.normal(0, 1e-5, X.shape)

    n_neighbors = min(20, max(2, len(claims) // 2))
    lof = LocalOutlierFactor(n_neighbors=n_neighbors, contamination="auto")
    lof.fit_predict(X_noise)
    raw_scores: np.ndarray = (
        lof.negative_outlier_factor_
    )  # negative; more negative = more anomalous

    # Normalise to [0, 1]: most anomalous → 1, most normal → 0

    min_s, max_s = raw_scores.min(), raw_scores.max()
    if max_s == min_s:
        normalised = np.zeros(len(raw_scores))
    else:
        normalised = (max_s - raw_scores) / (max_s - min_s)
    results: List[ClaimFraudResult] = []
    for claim, score in zip(claims, normalised):
        score = round(float(score), 4)
        band = _band_for_score(score, pass_max, review_max)
        is_flagged = band != FraudBand.PASS
        reason = "Anomalous pattern detected" if is_flagged else None
        code = FraudExplanationCode.ANOMALY_DETECTED if is_flagged else None
        result = ClaimFraudResult(
            claim_id=claim.claim_id,
            fraud_risk_score=score,
            is_flagged=is_flagged,
            band=band,
            code=code,
            reason=reason,
        )
        _log_decision(result, pass_max, review_max)
        results.append(result)
    logger.info(
        "Fraud detection complete: %d claims, %d flagged",
        len(claims),
        sum(r.is_flagged for r in results),
    )
    return results


def record_reviewer_feedback(
    decision_id: str,
    final_outcome: str,
    reviewer_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict:
    """Capture a reviewer's final decision on a flagged claim.

    The feedback record links back to the original fraud score and band via
    the decision_id of the existing audit entry. It deliberately does not
    copy claim content (IP, evidence hash, location, amount) - only the
    claim_id handle and the reviewer outcome are stored.

    Raises KeyError if the decision_id is not known (e.g. evicted from the
    rolling window or never issued), and ValueError for an unknown outcome.
    """
    normalised = final_outcome.strip().upper()
    if normalised not in _ALLOWED_OUTCOMES:
        raise ValueError(
            f"final_outcome must be one of {sorted(_ALLOWED_OUTCOMES)}, got {final_outcome!r}"
        )
    decision = _recent_decisions_by_id.get(decision_id)
    if decision is None:
        raise KeyError(
            f"unknown decision_id {decision_id!r}; no matching audit entry"
        )
    record = {
        "decision_id": decision_id,
        "claim_id": decision["claim_id"],
        "predicted_band": decision["band"],
        "fraud_risk_score": decision["fraud_risk_score"],
        "rules_version": decision["rules_version"],
        "final_outcome": normalised,
        "reviewer_id": reviewer_id,
        "notes": notes,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    _feedback_records.append(record)
    audit_logger.info(
        "fraud_feedback decision_id=%s claim_id=%s predicted_band=%s "
        "final_outcome=%s reviewer_id=%s",
        decision_id,
        record["claim_id"],
        record["predicted_band"],
        normalised,
        reviewer_id,
    )
    return record


def get_feedback_report(window_days: int = 30) -> dict:
    """Compare predicted bands against actual outcomes over a rolling window.

    This is distinct from the fixture-based calibration report: it uses
    real reviewer outcomes captured via record_reviewer_feedback. Returns a
    confusion matrix between predicted band and final outcome, along with
    per-band accuracy and total counts.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    predicted_bands = [b.value for b in FraudBand]
    outcomes = sorted(_ALLOWED_OUTCOMES)
    confusion: Dict[str, Dict[str, int]] = {
        pb: {o: 0 for o in outcomes} for pb in predicted_bands
    }
    total = 0
    matched = 0
    for record in _feedback_records:
        try:
            recorded_at = datetime.fromisoformat(record["recorded_at"])
        except ValueError:
            continue
        if recorded_at < cutoff:
            continue
        pb = record["predicted_band"]
        o = record["final_outcome"]
        if pb not in confusion or o not in confusion[pb]:
            continue
        confusion[pb][o] += 1
        total += 1
        if pb == o:
            matched += 1
    per_band = {}
    for pb in predicted_bands:
        row_total = sum(confusion[pb].values())
        per_band[pb] = {
            "count": row_total,
            "correct": confusion[pb].get(pb, 0),
            "accuracy": (
                round(confusion[pb].get(pb, 0) / row_total, 4)
                if row_total
                else None
            ),
        }
    return {
        "window_days": window_days,
        "total_records": total,
        "overall_accuracy": round(matched / total, 4) if total else None,
        "confusion_matrix": confusion,
        "per_band": per_band,
    }


_ALLOWED_OUTCOMES = {"APPROVED", "REJECTED", "FRAUD", "LEGITIMATE"}
