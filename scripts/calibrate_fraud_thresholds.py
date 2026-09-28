"""
Calibration script for fraud detection thresholds.

Runs the current fraud detection model against the committed fixture set
(tests/fixtures/fraud_claims.json) and reports how many claims land in each
decision band under the active configuration. Regenerate
reports/fraud_threshold_calibration.md whenever the model or the fixture
set changes, so the documented defaults stay backed by real numbers.

Usage:
    python scripts/calibrate_fraud_thresholds.py
"""

import json
from collections import Counter
from pathlib import Path

from config import get_settings
from schemas.fraud import ClaimMetadata
from services.fraud_detection import detect_fraud

FIXTURES_PATH = Path("tests/fixtures/fraud_claims.json")
REPORT_PATH = Path("reports/fraud_threshold_calibration.md")


def main() -> None:
    settings = get_settings()
    raw_claims = json.loads(FIXTURES_PATH.read_text())
    claims = [ClaimMetadata(**c) for c in raw_claims]

    results = detect_fraud(claims)
    band_counts = Counter(r.band.value for r in results)

    lines = [
        "# Fraud Threshold Calibration Report",
        "",
        f"Fixture set: `{FIXTURES_PATH}` ({len(claims)} claims)",
        f"Thresholds: FRAUD_PASS_MAX_SCORE={settings.fraud_pass_max_score}, "
        f"FRAUD_REVIEW_MAX_SCORE={settings.fraud_review_max_score}",
        "",
        "## Band distribution",
        "",
        "| Band | Count |",
        "|---|---|",
        f"| PASS | {band_counts.get('PASS', 0)} |",
        f"| REVIEW | {band_counts.get('REVIEW', 0)} |",
        f"| REJECT | {band_counts.get('REJECT', 0)} |",
        "",
        "## Per-claim scores",
        "",
        "| Claim ID | Score | Band |",
        "|---|---|---|",
    ]
    for r in sorted(results, key=lambda r: -r.fraud_risk_score):
        lines.append(f"| {r.claim_id} | {r.fraud_risk_score:.4f} | {r.band.value} |")

    lines += [
        "",
        "## Notes",
        "",
        "- The fixture set contains three normal clusters, three "
        "medium-severity anomalies (off on IP + location but with a "
        "plausible amount), and three strong anomalies (off on every "
        "dimension, extreme amount).",
        "- Local Outlier Factor scores local density, so a claim that only "
        "differs on categorical fields (IP/location) but stays inside a "
        "dense cluster's amount range can still score low. This is a known "
        "limitation of the current feature encoding, not of the "
        "thresholds - worth a follow-up issue if categorical-only fraud "
        "needs better sensitivity.",
        "- Re-run this script after any change to the model or the fixture "
        "set, and commit the updated report alongside the change.",
    ]

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines) + "\n")
    print(f"Wrote {REPORT_PATH}")
    print(f"Band distribution: {dict(band_counts)}")


if __name__ == "__main__":
    main()
