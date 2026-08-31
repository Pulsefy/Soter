"""Tests for fraud detection endpoint and service."""

import pytest
from fastapi.testclient import TestClient

from main import app
from schemas.fraud import ClaimMetadata
from services.fraud_detection import detect_fraud

client = TestClient(app)


def _make_claims(n: int):
    return [
        {
            "claim_id": f"c{i}",
            "ip_address": "1.2.3.4",
            "evidence_hash": f"hash{i}",
            "amount": 100.0,
        }
        for i in range(n)
    ]


class TestFraudDetectionEndpoint:
    def test_returns_score_per_claim(self):
        payload = {"claims": _make_claims(3)}
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        # Response is now a ResultEnvelope; per-claim results are in data["result"]

        assert "result" in data
        assert len(data["result"]) == 3
        for r in data["result"]:
            assert 0.0 <= r["fraud_risk_score"] <= 1.0

    def test_flagged_count_matches(self):
        payload = {"claims": _make_claims(5)}
        resp = client.post("/v1/fraud/detect", json=payload)
        data = resp.json()
        flagged = sum(r["is_flagged"] for r in data["result"])
        # reasons list has one entry per flagged claim that has a reason

        if flagged and data["reasons"]:
            assert len(data["reasons"]) <= flagged

    def test_single_claim_returns_zero_risk(self):
        payload = {
            "claims": [{"claim_id": "solo", "ip_address": "9.9.9.9", "amount": 50.0}]
        }
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        result = resp.json()["result"][0]
        assert result["fraud_risk_score"] == 0.0
        assert result["is_flagged"] is False

    def test_empty_claims_rejected(self):
        resp = client.post("/v1/fraud/detect", json={"claims": []})
        assert resp.status_code == 422

    def test_outlier_gets_higher_score(self):
        """A claim with a very different IP should score higher than identical ones."""
        claims = [
            {"claim_id": f"c{i}", "ip_address": "1.2.3.4", "amount": 100.0}
            for i in range(8)
        ]
        claims.append(
            {"claim_id": "outlier", "ip_address": "99.99.99.99", "amount": 9999.0}
        )
        resp = client.post("/v1/fraud/detect", json={"claims": claims})
        assert resp.status_code == 200
        results = {r["claim_id"]: r for r in resp.json()["result"]}
        assert (
            results["outlier"]["fraud_risk_score"] > results["c0"]["fraud_risk_score"]
        )
        if results["outlier"]["is_flagged"]:
            assert results["outlier"]["code"] == "ANOMALY_DETECTED"
            assert "Anomalous pattern" in results["outlier"]["reason"]


class TestFraudDetectionService:
    def test_single_claim(self):
        claims = [ClaimMetadata(claim_id="x1", ip_address="1.1.1.1")]
        results = detect_fraud(claims)
        assert len(results) == 1
        assert results[0].fraud_risk_score == 0.0

    def test_scores_in_range(self):
        claims = [
            ClaimMetadata(claim_id=f"c{i}", ip_address="1.1.1.1", amount=float(i))
            for i in range(5)
        ]
        results = detect_fraud(claims)
        for r in results:
            assert 0.0 <= r.fraud_risk_score <= 1.0


class TestFraudThresholdBanding:
    """Covers each band and the exact boundaries between them."""

    def test_band_pass_below_threshold(self):
        from services.fraud_detection import _band_for_score
        from schemas.fraud import FraudBand

        assert _band_for_score(0.0, pass_max=0.4, review_max=0.75) == FraudBand.PASS
        assert _band_for_score(0.39, pass_max=0.4, review_max=0.75) == FraudBand.PASS

    def test_band_pass_review_boundary(self):
        """A score exactly at pass_max must fall into REVIEW, not PASS."""
        from services.fraud_detection import _band_for_score
        from schemas.fraud import FraudBand

        assert _band_for_score(0.4, pass_max=0.4, review_max=0.75) == FraudBand.REVIEW

    def test_band_review_between_thresholds(self):
        from services.fraud_detection import _band_for_score
        from schemas.fraud import FraudBand

        assert _band_for_score(0.5, pass_max=0.4, review_max=0.75) == FraudBand.REVIEW
        assert _band_for_score(0.74, pass_max=0.4, review_max=0.75) == FraudBand.REVIEW

    def test_band_review_reject_boundary(self):
        """A score exactly at review_max must fall into REJECT, not REVIEW."""
        from services.fraud_detection import _band_for_score
        from schemas.fraud import FraudBand

        assert _band_for_score(0.75, pass_max=0.4, review_max=0.75) == FraudBand.REJECT

    def test_band_reject_above_threshold(self):
        from services.fraud_detection import _band_for_score
        from schemas.fraud import FraudBand

        assert _band_for_score(0.9, pass_max=0.4, review_max=0.75) == FraudBand.REJECT
        assert _band_for_score(1.0, pass_max=0.4, review_max=0.75) == FraudBand.REJECT


class TestFraudResponseIncludesBand:
    def test_endpoint_response_includes_valid_band(self):
        payload = {"claims": _make_claims(3)}
        resp = client.post("/v1/fraud/detect", json=payload)
        assert resp.status_code == 200
        for r in resp.json()["result"]:
            assert r["band"] in ("PASS", "REVIEW", "REJECT")

    def test_single_claim_bands_as_pass(self):
        """A neutral 0.0 score for a lone claim should band as PASS."""
        payload = {
            "claims": [{"claim_id": "solo", "ip_address": "9.9.9.9", "amount": 50.0}]
        }
        resp = client.post("/v1/fraud/detect", json=payload)
        result = resp.json()["result"][0]
        assert result["band"] == "PASS"
