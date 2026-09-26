# Fraud Threshold Calibration Report

Fixture set: `tests/fixtures/fraud_claims.json` (30 claims)
Thresholds: FRAUD_PASS_MAX_SCORE=0.4, FRAUD_REVIEW_MAX_SCORE=0.75

## Band distribution

| Band | Count |
|---|---|
| PASS | 27 |
| REVIEW | 1 |
| REJECT | 2 |

## Per-claim scores

| Claim ID | Score | Band |
|---|---|---|
| strong-1 | 1.0000 | REJECT |
| strong-3 | 0.8260 | REJECT |
| strong-2 | 0.6095 | REVIEW |
| normB-7 | 0.0122 | PASS |
| normB-6 | 0.0121 | PASS |
| normB-5 | 0.0119 | PASS |
| normB-4 | 0.0118 | PASS |
| normB-3 | 0.0117 | PASS |
| normB-2 | 0.0116 | PASS |
| medium-2 | 0.0116 | PASS |
| normB-1 | 0.0114 | PASS |
| normB-0 | 0.0113 | PASS |
| medium-1 | 0.0004 | PASS |
| normA-0 | 0.0001 | PASS |
| normA-1 | 0.0001 | PASS |
| normA-2 | 0.0001 | PASS |
| normA-3 | 0.0001 | PASS |
| normA-4 | 0.0001 | PASS |
| normA-5 | 0.0001 | PASS |
| normA-6 | 0.0001 | PASS |
| normA-7 | 0.0001 | PASS |
| normA-9 | 0.0001 | PASS |
| normC-0 | 0.0001 | PASS |
| normC-1 | 0.0001 | PASS |
| normA-8 | 0.0000 | PASS |
| normC-2 | 0.0000 | PASS |
| normC-3 | 0.0000 | PASS |
| normC-4 | 0.0000 | PASS |
| normC-5 | 0.0000 | PASS |
| medium-3 | 0.0000 | PASS |

## Notes

- The fixture set contains three normal clusters, three medium-severity anomalies (off on IP + location but with a plausible amount), and three strong anomalies (off on every dimension, extreme amount).
- Local Outlier Factor scores local density, so a claim that only differs on categorical fields (IP/location) but stays inside a dense cluster's amount range can still score low. This is a known limitation of the current feature encoding, not of the thresholds — worth a follow-up issue if categorical-only fraud needs better sensitivity.
- Re-run `scripts/calibrate_fraud_thresholds.py` after any change to the model or the fixture set, and commit the updated report alongside the change.
