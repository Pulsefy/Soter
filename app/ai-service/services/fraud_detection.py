"""
Fraud detection service using scikit-learn clustering.

Clusters claim metadata by similarity and flags outliers or clusters that exceed a risk threshold as potentially fraudulent.
"""

import logging
from typing import List

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


def _band_for_score(score: float, pass_max: float, review_max: float) -> FraudBand:
    """Map a normalised fraud_risk_score (0-1) to a decision band.

    Each threshold acts as a hard ceiling for the band below it: a score exactly equal to ``pass_max`` bands as REVIEW (not PASS), and a score exactly equal to ``review_max`` bands as REJECT (not REVIEW).
    """
    if score < pass_max:
        return FraudBand.PASS
    if score < review_max:
        return FraudBand.REVIEW
    return FraudBand.REJECT


def _log_decision(result: ClaimFraudResult, pass_max: float, review_max: float) -> None:
    """Record a single claim's decision for audit purposes.

    Logs the score, the band it was assigned, and the exact thresholds that were active at decision time - so if thresholds are retuned later, past decisions remain fully explainable from the logs alone.
    """
    audit_logger.info(
        "fraud_decision claim_id=%s score=%s band=%s "
        "fraud_pass_max_score=%s fraud_review_max_score=%s",
        result.claim_id,
        result.fraud_risk_score,
        result.band.value,
        pass_max,
        review_max,
    )


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
