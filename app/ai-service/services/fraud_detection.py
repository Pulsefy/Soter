"""
Fraud detection service using scikit-learn clustering.

Clusters claim metadata by similarity and flags outliers or clusters
that exceed a risk threshold as potentially fraudulent.

Threshold configuration
-----------------------
All numeric thresholds are read from ``config.Settings`` so that operators
can tune sensitivity without a code change:

  FRAUD_REVIEW_THRESHOLD   (default 0.40)
      Normalised score at which a claim is escalated from *pass* to *review*.
  FRAUD_REJECT_THRESHOLD   (default 0.75)
      Normalised score at which a claim is escalated from *review* to *reject*.
  FRAUD_LOF_OUTLIER_THRESHOLD  (default -1.5)
      Raw LOF negative_outlier_factor_ value; claims whose raw score is below
      this value are marked ``is_flagged=True``.

Band semantics
--------------
  pass    : fraud_risk_score < FRAUD_REVIEW_THRESHOLD
  review  : FRAUD_REVIEW_THRESHOLD <= fraud_risk_score < FRAUD_REJECT_THRESHOLD
  reject  : fraud_risk_score >= FRAUD_REJECT_THRESHOLD

Every decision emits a structured audit log entry that includes the active
threshold values, so that any subsequent threshold change can be traced back
to a specific configuration state.
"""

import logging
from typing import List

import numpy as np
from sklearn.preprocessing import LabelEncoder
from sklearn.neighbors import LocalOutlierFactor

from config import settings
from schemas.fraud import ClaimMetadata, ClaimFraudResult, FraudBand, FraudExplanationCode

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Band helpers
# ---------------------------------------------------------------------------

def _assign_band(score: float, review_threshold: float, reject_threshold: float) -> FraudBand:
    """Return the risk band for a normalised score given the active thresholds."""
    if score >= reject_threshold:
        return FraudBand.REJECT
    if score >= review_threshold:
        return FraudBand.REVIEW
    return FraudBand.PASS


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Main detection function
# ---------------------------------------------------------------------------

def detect_fraud(claims: List[ClaimMetadata]) -> List[ClaimFraudResult]:
    """
    Analyse a batch of claims and return a fraud_risk_score and band for each.

    Uses Local Outlier Factor (unsupervised) to score each claim relative
    to its neighbours.  Scores are normalised to [0, 1] where 1 = highest risk.

    Threshold values are sourced from ``config.settings`` at call time, so
    runtime overrides (e.g. in tests) take effect immediately.

    An audit log entry is emitted for every batch, recording:
      - the active threshold configuration
      - per-claim outcome (band + is_flagged)
    """
    # Snapshot active thresholds at call time so the audit entry is self-contained
    review_threshold = settings.fraud_review_threshold
    reject_threshold = settings.fraud_reject_threshold
    lof_outlier_threshold = settings.fraud_lof_outlier_threshold

    if len(claims) == 1:
        # LOF needs at least 2 samples; single claim gets a neutral score
        band = _assign_band(0.0, review_threshold, reject_threshold)
        result = ClaimFraudResult(
            claim_id=claims[0].claim_id,
            fraud_risk_score=0.0,
            band=band,
            is_flagged=False,
        )
        _emit_audit_log(
            results=[result],
            review_threshold=review_threshold,
            reject_threshold=reject_threshold,
            lof_outlier_threshold=lof_outlier_threshold,
        )
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
    for claim, raw, score in zip(claims, raw_scores, normalised):
        is_flagged = raw < lof_outlier_threshold
        band = _assign_band(float(score), review_threshold, reject_threshold)
        reason = "Anomalous pattern detected" if is_flagged else None
        code = FraudExplanationCode.ANOMALY_DETECTED if is_flagged else None
        results.append(
            ClaimFraudResult(
                claim_id=claim.claim_id,
                fraud_risk_score=round(float(score), 4),
                band=band,
                is_flagged=is_flagged,
                code=code,
                reason=reason,
            )
        )

    _emit_audit_log(
        results=results,
        review_threshold=review_threshold,
        reject_threshold=reject_threshold,
        lof_outlier_threshold=lof_outlier_threshold,
    )
    return results


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------

def _emit_audit_log(
    results: List[ClaimFraudResult],
    review_threshold: float,
    reject_threshold: float,
    lof_outlier_threshold: float,
) -> None:
    """
    Emit a structured audit record for a fraud detection batch.

    The record is written at INFO level so it is captured by the JSON log
    pipeline.  It captures the *active* threshold values alongside every
    per-claim outcome, making it possible to reconstruct the decision logic
    in force at the time of evaluation even after thresholds are later changed.

    Log fields:
      event            Fixed marker for log filtering: "fraud_decision_audit"
      thresholds       Active threshold snapshot (review, reject, lof_outlier)
      batch_size       Number of claims evaluated
      flagged_count    Number of claims where is_flagged=True
      band_counts      Count of claims per band (pass/review/reject)
      decisions        Per-claim record: claim_id, score, band, is_flagged
    """
    band_counts = {FraudBand.PASS: 0, FraudBand.REVIEW: 0, FraudBand.REJECT: 0}
    decisions = []
    for r in results:
        band_counts[r.band] += 1
        decisions.append(
            {
                "claim_id": r.claim_id,
                "fraud_risk_score": r.fraud_risk_score,
                "band": r.band.value,
                "is_flagged": r.is_flagged,
            }
        )

    logger.info(
        "fraud_decision_audit",
        extra={
            "event": "fraud_decision_audit",
            "thresholds": {
                "review": review_threshold,
                "reject": reject_threshold,
                "lof_outlier": lof_outlier_threshold,
            },
            "batch_size": len(results),
            "flagged_count": sum(r.is_flagged for r in results),
            "band_counts": {
                "pass": band_counts[FraudBand.PASS],
                "review": band_counts[FraudBand.REVIEW],
                "reject": band_counts[FraudBand.REJECT],
            },
            "decisions": decisions,
        },
    )
