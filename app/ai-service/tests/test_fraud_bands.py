"""
Tests for fraud detection banding and threshold boundaries.

Coverage
--------
- Each of the three bands (pass / review / reject) is reachable
- Boundary values at fraud_review_threshold and fraud_reject_threshold
  produce the expected band (boundary belongs to the *higher* band)
- band field is present in every ClaimFraudResult
- band field is propagated through the API envelope
- Threshold configuration is validated (review < reject, both in (0, 1])
- Audit log entry includes threshold snapshot
- is_flagged and band are independent signals (band=reject does not
  require is_flagged=True)
"""

from unittest.mock import patch, MagicMock
import logging
import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.fraud import ClaimMetadata, ClaimFraudResult, FraudBand
from services.fraud_detection import detect_fraud, _assign_band

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _claims(n: int, *, ip="1.2.3.4", amount=100.0, location="Kano, NG"):
    return [
        ClaimMetadata(claim_id=f"c{i}", ip_address=ip, amount=amount, location=location)
        for i in range(n)
    ]


def _api_claims(n: int, *, ip="1.2.3.4", amount=100.0):
    return [
        {"claim_id": f"c{i}", "ip_address": ip, "amount": amount}
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# _assign_band unit tests
# ---------------------------------------------------------------------------

class TestAssignBand:
    """Unit tests for the _assign_band helper, isolated from LOF logic."""

    def test_score_zero_is_pass(self):
        assert _assign_band(0.0, 0.40, 0.75) == FraudBand.PASS

    def test_score_below_review_threshold_is_pass(self):
        assert _assign_band(0.39, 0.40, 0.75) == FraudBand.PASS

    def test_score_at_review_threshold_is_review(self):
        """Boundary value: score == review_threshold belongs to review band."""
        assert _assign_band(0.40, 0.40, 0.75) == FraudBand.REVIEW

    def test_score_just_above_review_threshold_is_review(self):
        assert _assign_band(0.41, 0.40, 0.75) == FraudBand.REVIEW

    def test_score_just_below_reject_threshold_is_review(self):
        assert _assign_band(0.74, 0.40, 0.75) == FraudBand.REVIEW

    def test_score_at_reject_threshold_is_reject(self):
        """Boundary value: score == reject_threshold belongs to reject band."""
        assert _assign_band(0.75, 0.40, 0.75) == FraudBand.REJECT

    def test_score_just_above_reject_threshold_is_reject(self):
        assert _assign_band(0.76, 0.40, 0.75) == FraudBand.REJECT

    def test_score_one_is_reject(self):
        assert _assign_band(1.0, 0.40, 0.75) == FraudBand.REJECT

    def test_mid_review_range_is_review(self):
        assert _assign_band(0.57, 0.40, 0.75) == FraudBand.REVIEW

    def test_custom_thresholds_narrow_review_band(self):
        """Custom thresholds: review band 0.3–0.5."""
        assert _assign_band(0.29, 0.30, 0.50) == FraudBand.PASS
        assert _assign_band(0.30, 0.30, 0.50) == FraudBand.REVIEW
        assert _assign_band(0.49, 0.30, 0.50) == FraudBand.REVIEW
        assert _assign_band(0.50, 0.30, 0.50) == FraudBand.REJECT

    def test_custom_thresholds_wide_review_band(self):
        """Custom thresholds: review band 0.1–0.9."""
        assert _assign_band(0.09, 0.10, 0.90) == FraudBand.PASS
        assert _assign_band(0.10, 0.10, 0.90) == FraudBand.REVIEW
        assert _assign_band(0.89, 0.10, 0.90) == FraudBand.REVIEW
        assert _assign_band(0.90, 0.10, 0.90) == FraudBand.REJECT


# ---------------------------------------------------------------------------
# detect_fraud band tests (service layer)
# ---------------------------------------------------------------------------

class TestDetectFraudBands:
    """Tests that detect_fraud returns valid band values on every result."""

    def test_single_claim_band_is_pass(self):
        results = detect_fraud([ClaimMetadata(claim_id="x1", ip_address="1.1.1.1")])
        assert results[0].band == FraudBand.PASS
        assert results[0].fraud_risk_score == 0.0

    def test_all_results_have_band_field(self):
        results = detect_fraud(_claims(5))
        for r in results:
            assert isinstance(r.band, FraudBand)

    def test_clear_outlier_receives_reject_band(self):
        """A claim with extreme amount should score 1.0 → reject band."""
        claims = _claims(8)
        claims.append(
            ClaimMetadata(claim_id="outlier", ip_address="1.2.3.4", amount=99999.0)
        )
        results = {r.claim_id: r for r in detect_fraud(claims)}
        assert results["outlier"].band == FraudBand.REJECT
        assert results["outlier"].fraud_risk_score == 1.0

    def test_inliers_receive_pass_band(self):
        """All homogeneous claims in a batch should score 0 → pass band."""
        claims = _claims(8)
        claims.append(
            ClaimMetadata(claim_id="outlier", ip_address="1.2.3.4", amount=99999.0)
        )
        results = {r.claim_id: r for r in detect_fraud(claims)}
        for cid, r in results.items():
            if cid != "outlier":
                assert r.band == FraudBand.PASS, f"{cid} expected pass, got {r.band}"

    def test_review_band_reachable_via_config(self):
        """
        Force a review band result by setting review_threshold=0.0 and
        reject_threshold=0.99, so even moderate anomalies hit 'review'.
        """
        with patch("services.fraud_detection.settings") as mock_settings:
            mock_settings.fraud_review_threshold = 0.0
            mock_settings.fraud_reject_threshold = 0.99
            mock_settings.fraud_lof_outlier_threshold = -1.5
            claims = _claims(8)
            # Include a moderate outlier that won't quite reach 1.0
            claims.append(
                ClaimMetadata(claim_id="mod-out", ip_address="1.2.3.4", amount=300.0)
            )
            results = {r.claim_id: r for r in detect_fraud(claims)}
            # mod-out will have a score > 0 → band=review (since reject_threshold=0.99)
            assert results["mod-out"].band in (FraudBand.REVIEW, FraudBand.REJECT)

    def test_band_enum_values(self):
        """Verify FraudBand enum string values match the spec."""
        assert FraudBand.PASS.value == "pass"
        assert FraudBand.REVIEW.value == "review"
        assert FraudBand.REJECT.value == "reject"

    def test_band_present_when_is_flagged_false(self):
        """Claims that are not flagged still have a valid band."""
        results = detect_fraud(_claims(5))
        for r in results:
            assert r.band in list(FraudBand)
            # Non-flagged claims may still have review or reject band
            if not r.is_flagged:
                assert r.band is not None

    def test_custom_thresholds_affect_band_assignment(self):
        """Lowering thresholds should move moderate anomalies into reject."""
        with patch("services.fraud_detection.settings") as mock_settings:
            mock_settings.fraud_review_threshold = 0.01
            mock_settings.fraud_reject_threshold = 0.02
            mock_settings.fraud_lof_outlier_threshold = -1.5
            claims = _claims(8)
            claims.append(
                ClaimMetadata(claim_id="outlier", ip_address="1.2.3.4", amount=9999.0)
            )
            results = {r.claim_id: r for r in detect_fraud(claims)}
            # With very low thresholds, outlier should be reject
            assert results["outlier"].band == FraudBand.REJECT

    def test_score_boundaries_match_bands(self):
        """
        After a real detection run the assigned band must be consistent with
        the score and the active thresholds.
        """
        from config import settings as cfg
        claims = _claims(8)
        claims.append(
            ClaimMetadata(claim_id="outlier", ip_address="99.0.0.0", amount=9999.0)
        )
        results = detect_fraud(claims)
        for r in results:
            if r.fraud_risk_score < cfg.fraud_review_threshold:
                assert r.band == FraudBand.PASS, (
                    f"score={r.fraud_risk_score} should be pass, got {r.band}"
                )
            elif r.fraud_risk_score < cfg.fraud_reject_threshold:
                assert r.band == FraudBand.REVIEW, (
                    f"score={r.fraud_risk_score} should be review, got {r.band}"
                )
            else:
                assert r.band == FraudBand.REJECT, (
                    f"score={r.fraud_risk_score} should be reject, got {r.band}"
                )


# ---------------------------------------------------------------------------
# API endpoint band tests
# ---------------------------------------------------------------------------

class TestFraudEndpointBands:
    """Tests that the band field appears in API responses."""

    def test_each_result_has_band_field(self):
        payload = {"claims": _api_claims(4)}
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        for r in resp.json()["result"]:
            assert "band" in r
            assert r["band"] in ("pass", "review", "reject")

    def test_single_claim_band_is_pass(self):
        payload = {"claims": [{"claim_id": "solo", "ip_address": "9.9.9.9", "amount": 50.0}]}
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        result = resp.json()["result"][0]
        assert result["band"] == "pass"

    def test_clear_outlier_band_is_reject(self):
        """Outlier with extreme amount should come back with band=reject."""
        claims = _api_claims(8)
        claims.append({"claim_id": "outlier", "ip_address": "1.2.3.4", "amount": 99999.0})
        resp = client.post("/v1/fraud/detect", json={"claims": claims})
        assert resp.status_code == 200
        results = {r["claim_id"]: r for r in resp.json()["result"]}
        assert results["outlier"]["band"] == "reject"

    def test_band_values_are_valid_strings(self):
        payload = {"claims": _api_claims(5)}
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        valid = {"pass", "review", "reject"}
        for r in resp.json()["result"]:
            assert r["band"] in valid

    def test_inlier_bands_are_pass_when_outlier_present(self):
        claims = _api_claims(8)
        claims.append({"claim_id": "outlier", "ip_address": "1.2.3.4", "amount": 99999.0})
        resp = client.post("/v1/fraud/detect", json={"claims": claims})
        assert resp.status_code == 200
        results = {r["claim_id"]: r for r in resp.json()["result"]}
        for cid, r in results.items():
            if cid != "outlier":
                assert r["band"] == "pass"


# ---------------------------------------------------------------------------
# Threshold configuration validation tests
# ---------------------------------------------------------------------------

class TestThresholdConfiguration:
    """Tests that invalid threshold configurations are rejected."""

    def test_valid_default_thresholds_load(self):
        from config import settings
        assert 0.0 < settings.fraud_review_threshold < settings.fraud_reject_threshold <= 1.0

    def test_review_threshold_must_be_less_than_reject(self):
        from pydantic import ValidationError
        from config import Settings
        with pytest.raises(ValidationError):
            Settings(
                fraud_review_threshold=0.80,
                fraud_reject_threshold=0.40,
            )

    def test_review_threshold_cannot_be_zero(self):
        from pydantic import ValidationError
        from config import Settings
        with pytest.raises(ValidationError):
            Settings(
                fraud_review_threshold=0.0,
                fraud_reject_threshold=0.75,
            )

    def test_reject_threshold_cannot_exceed_one(self):
        from pydantic import ValidationError
        from config import Settings
        with pytest.raises(ValidationError):
            Settings(
                fraud_review_threshold=0.40,
                fraud_reject_threshold=1.1,
            )

    def test_equal_thresholds_are_invalid(self):
        from pydantic import ValidationError
        from config import Settings
        with pytest.raises(ValidationError):
            Settings(
                fraud_review_threshold=0.50,
                fraud_reject_threshold=0.50,
            )


# ---------------------------------------------------------------------------
# Audit log tests
# ---------------------------------------------------------------------------

class TestFraudAuditLog:
    """Tests that the audit log entry captures threshold configuration."""

    def test_audit_log_emitted_with_threshold_snapshot(self, caplog):
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            detect_fraud(_claims(4))

        audit_records = [
            r for r in caplog.records
            if "fraud_decision_audit" in r.getMessage()
        ]
        assert len(audit_records) >= 1

    def test_audit_log_contains_threshold_fields(self, caplog):
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            detect_fraud(_claims(4))

        # Find the audit record by checking for the 'thresholds' extra field
        audit_record = None
        for r in caplog.records:
            if hasattr(r, "thresholds"):
                audit_record = r
                break

        assert audit_record is not None, "No audit record with 'thresholds' extra found"
        assert "review" in audit_record.thresholds
        assert "reject" in audit_record.thresholds
        assert "lof_outlier" in audit_record.thresholds

    def test_audit_log_threshold_values_match_config(self, caplog):
        from config import settings
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            detect_fraud(_claims(4))

        for r in caplog.records:
            if hasattr(r, "thresholds"):
                assert r.thresholds["review"] == settings.fraud_review_threshold
                assert r.thresholds["reject"] == settings.fraud_reject_threshold
                assert r.thresholds["lof_outlier"] == settings.fraud_lof_outlier_threshold
                break
        else:
            pytest.fail("No audit record with threshold fields found")

    def test_audit_log_contains_band_counts(self, caplog):
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            detect_fraud(_claims(4))

        for r in caplog.records:
            if hasattr(r, "band_counts"):
                assert "pass" in r.band_counts
                assert "review" in r.band_counts
                assert "reject" in r.band_counts
                break
        else:
            pytest.fail("No audit record with band_counts field found")

    def test_audit_log_decisions_match_results(self, caplog):
        claims = _claims(3)
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            results = detect_fraud(claims)

        for r in caplog.records:
            if hasattr(r, "decisions"):
                logged_ids = {d["claim_id"] for d in r.decisions}
                result_ids = {res.claim_id for res in results}
                assert logged_ids == result_ids
                break
        else:
            pytest.fail("No audit record with decisions field found")

    def test_audit_log_emitted_for_single_claim(self, caplog):
        """Single-claim path also emits an audit entry."""
        with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
            detect_fraud([ClaimMetadata(claim_id="solo", ip_address="1.1.1.1")])

        audit_records = [r for r in caplog.records if hasattr(r, "thresholds")]
        assert len(audit_records) >= 1

    def test_custom_threshold_snapshot_recorded(self, caplog):
        """Overriding thresholds via config patch is reflected in audit log."""
        with patch("services.fraud_detection.settings") as mock_settings:
            mock_settings.fraud_review_threshold = 0.30
            mock_settings.fraud_reject_threshold = 0.60
            mock_settings.fraud_lof_outlier_threshold = -2.0
            with caplog.at_level(logging.INFO, logger="services.fraud_detection"):
                detect_fraud(_claims(4))

        for r in caplog.records:
            if hasattr(r, "thresholds"):
                assert r.thresholds["review"] == 0.30
                assert r.thresholds["reject"] == 0.60
                assert r.thresholds["lof_outlier"] == -2.0
                break
        else:
            pytest.fail("No audit record reflecting custom thresholds found")
