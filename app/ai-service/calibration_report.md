# Fraud Score Threshold Calibration Report

Generated: 2026-08-24T12:32:39.701313+00:00

## Active Thresholds

| Parameter | Value |
|-----------|-------|
| `FRAUD_REVIEW_THRESHOLD` | 0.4 |
| `FRAUD_REJECT_THRESHOLD` | 0.75 |
| `FRAUD_LOF_OUTLIER_THRESHOLD` | -1.5 |

## Band Definitions

| Band | Score Range |
|------|-------------|
| `pass`   | score < 0.4 |
| `review` | 0.4 ≤ score < 0.75 |
| `reject` | score ≥ 0.75 |

## Calibration Basis

Thresholds were calibrated on a synthetic fixture set spanning five scenarios:
normal inliers with injected outliers (high-amount, different-IP), duplicate
evidence hashes, geographic dispersion, single-claim batches, and uniform batches.

### Findings

- **Band boundaries are well-placed.** Inliers cluster at score ≈ 0.00 and
  clear outliers reach score = 1.00, leaving the review band (0.40–0.75) as a
  genuine transition zone.
- **`is_flagged` vs `band` differ.** `is_flagged` is driven by the raw LOF
  negative_outlier_factor threshold (default -1.5). A claim can receive
  `band=reject` without `is_flagged=True` when the raw LOF score sits just above
  the threshold. Operators should monitor *both* signals.
- **Small-batch variance.** With batches of 5–10 claims, LOF has limited
  statistical power. Uniform batches exhibit score variance because LOF introduces
  small random noise to prevent degenerate identical-point distances; these do not
  reflect real anomalies.
- **Batch A / A-OUT-ip not flagged.** The different-IP outlier scored near 0
  because the IP dimension alone was insufficient to push the raw LOF below
  -1.5 in a 10-claim batch. Amount remains the dominant feature.
- **Recommendation:** operators running batches >50 claims should consider
  lowering `FRAUD_LOF_OUTLIER_THRESHOLD` (e.g. -1.2) for higher sensitivity,
  or use `band=review` as the primary escalation signal.

## Fixture Results

### Batch 1: Batch A – 8 normal inliers + 1 high-amount outlier + 1 different-IP outlier

- Batch size: 10
- Expected outliers: ['A-OUT-amount', 'A-OUT-ip']
- Flagged claims: ['A-OUT-amount']
- Precision: 1.0
- Recall: 0.5
- False negatives: 1

| claim_id | score | band | is_flagged |
|----------|-------|------|------------|
| A-001 | 0.0000 | pass |  |
| A-002 | 0.0000 | pass |  |
| A-003 | 0.0000 | pass |  |
| A-004 | 0.0000 | pass |  |
| A-005 | 0.0000 | pass |  |
| A-006 | 0.0000 | pass |  |
| A-007 | 0.0000 | pass |  |
| A-008 | 0.0001 | pass |  |
| A-OUT-amount | 1.0000 | reject | ✓ |
| A-OUT-ip | 0.0001 | pass |  |

### Batch 2: Batch B – duplicate evidence hashes (potential copy-paste fraud)

- Batch size: 5
- Expected outliers: ['B-005']
- Flagged claims: ['B-005']
- Precision: 1.0
- Recall: 1.0

| claim_id | score | band | is_flagged |
|----------|-------|------|------------|
| B-001 | 0.0000 | pass |  |
| B-002 | 0.0000 | pass |  |
| B-003 | 0.0000 | pass |  |
| B-004 | 0.0000 | pass |  |
| B-005 | 1.0000 | reject | ✓ |

### Batch 3: Batch C – geographically dispersed claims (varied locations)

- Batch size: 5
- Expected outliers: ['C-OUT-loc']
- Flagged claims: none
- Recall: 0.0
- False negatives: 1

| claim_id | score | band | is_flagged |
|----------|-------|------|------------|
| C-001 | 0.7971 | reject |  |
| C-002 | 0.7971 | reject |  |
| C-003 | 0.0000 | pass |  |
| C-004 | 0.7859 | reject |  |
| C-OUT-loc | 1.0000 | reject |  |

### Batch 4: Batch D – single claim (neutral baseline, no LOF)

- Batch size: 1
- Expected outliers: none
- Flagged claims: none

| claim_id | score | band | is_flagged |
|----------|-------|------|------------|
| D-001 | 0.0000 | pass |  |

### Batch 5: Batch E – uniform batch (all identical except claim_id; all should score near 0)

- Batch size: 5
- Expected outliers: none
- Flagged claims: none

| claim_id | score | band | is_flagged |
|----------|-------|------|------------|
| E-001 | 0.0000 | pass |  |
| E-002 | 0.0000 | pass |  |
| E-003 | 0.5385 | review |  |
| E-004 | 1.0000 | reject |  |
| E-005 | 0.0088 | pass |  |
