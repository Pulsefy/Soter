"""
Fraud detection service using scikit-learn clustering.

Clusters claim metadata by similarity and flags outliers or clusters
that exceed a risk threshold as potentially fraudulent.
"""

import logging
from typing import List

import numpy as np
from sklearn.preprocessing import LabelEncoder
from sklearn.neighbors import LocalOutlierFactor

from schemas.fraud import ClaimMetadata, ClaimFraudResult

logger = logging.getLogger(__name__)

# Claims with LOF score above this threshold are flagged
_OUTLIER_THRESHOLD = -1.5


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

    return np.column_stack([
        ip_enc.transform(ips),
        hash_enc.transform(hashes),
        loc_enc.transform(locs),
        amounts,
    ]).astype(float)


def detect_fraud(claims: List[ClaimMetadata]) -> List[ClaimFraudResult]:
    """
    Analyse a batch of claims and return a fraud_risk_score for each.

    Uses Local Outlier Factor (unsupervised) to score each claim relative
    to its neighbours.  Scores are normalised to [0, 1] where 1 = highest risk.
    """
    if len(claims) == 1:
        # LOF needs at least 2 samples; single claim gets a neutral score
        return [ClaimFraudResult(claim_id=claims[0].claim_id, fraud_risk_score=0.0, is_flagged=False)]

    X = _vectorize(claims)

    n_neighbors = min(20, len(claims) - 1)
    lof = LocalOutlierFactor(n_neighbors=n_neighbors, contamination="auto")
    lof.fit_predict(X)
    raw_scores: np.ndarray = lof.negative_outlier_factor_  # negative; more negative = more anomalous

    # Normalise to [0, 1]: most anomalous → 1, most normal → 0
    min_s, max_s = raw_scores.min(), raw_scores.max()
    if max_s == min_s:
        normalised = np.zeros(len(raw_scores))
    else:
        normalised = (max_s - raw_scores) / (max_s - min_s)

    results: List[ClaimFraudResult] = []
    for claim, raw, score in zip(claims, raw_scores, normalised):
        is_flagged = raw < _OUTLIER_THRESHOLD
        reason = "Anomalous pattern detected" if is_flagged else None
        results.append(
            ClaimFraudResult(
                claim_id=claim.claim_id,
                fraud_risk_score=round(float(score), 4),
                is_flagged=is_flagged,
                reason=reason,
            )
        )

    logger.info(
        "Fraud detection complete: %d claims, %d flagged",
        len(claims),
        sum(r.is_flagged for r in results),
    )
    return results
