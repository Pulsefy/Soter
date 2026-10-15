"""Tests for the verification cooldown service and its integration with
the humanitarian and fraud detection endpoints.

Acceptance criteria:
- A configurable minimum interval between verification attempts is enforced.
- A request inside the cooldown returns the prior result with from_cooldown=True.
- A request outside the cooldown (or with cooldown disabled) processes fresh.
- Tests cover inside and outside the cooldown window for both endpoints.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from services.rate_limiter import rate_limiter
from services.verification_cooldown import (
    VerificationCooldownService,
    build_fraud_key,
    build_humanitarian_key,
)


# ---------------------------------------------------------------------------
# Unit tests for VerificationCooldownService
# ---------------------------------------------------------------------------


class TestVerificationCooldownServiceUnit:
    """Pure unit tests — no FastAPI, no endpoints."""

    def test_first_request_is_not_in_cooldown(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        in_cd, result = svc.check("key-1")
        assert in_cd is False
        assert result is None

    def test_request_inside_cooldown_window_returns_prior_result(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        payload = {"verification": {"eligible": True, "confidence": 0.9}}
        svc.record("key-1", payload)

        in_cd, result = svc.check("key-1")
        assert in_cd is True
        assert result == payload

    def test_request_outside_cooldown_window_is_not_in_cooldown(self):
        svc = VerificationCooldownService(cooldown_seconds=0.05)  # 50 ms
        svc.record("key-1", {"result": "old"})

        # Advance past the window.
        time.sleep(0.1)

        in_cd, result = svc.check("key-1")
        assert in_cd is False
        assert result is None

    def test_disabled_cooldown_never_fires(self):
        svc = VerificationCooldownService(cooldown_seconds=0)
        svc.record("key-1", {"result": "old"})

        in_cd, result = svc.check("key-1")
        assert in_cd is False
        assert result is None

    def test_record_updates_timestamp_on_second_call(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        first_payload = {"result": "first"}
        second_payload = {"result": "second"}

        svc.record("key-1", first_payload)
        # Immediately overwrite — still within a 60 s window.
        svc.record("key-1", second_payload)

        in_cd, result = svc.check("key-1")
        assert in_cd is True
        assert result == second_payload

    def test_different_keys_are_independent(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        svc.record("key-a", {"result": "a"})

        in_cd_a, _ = svc.check("key-a")
        in_cd_b, _ = svc.check("key-b")

        assert in_cd_a is True
        assert in_cd_b is False

    def test_reset_clears_all_state(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        svc.record("key-1", {"result": "x"})
        svc.reset()

        in_cd, result = svc.check("key-1")
        assert in_cd is False
        assert result is None

    def test_remaining_seconds_inside_window(self):
        svc = VerificationCooldownService(cooldown_seconds=10)
        svc.record("key-1", {})

        remaining = svc.remaining_seconds("key-1")
        assert 0 < remaining <= 10

    def test_remaining_seconds_outside_window(self):
        svc = VerificationCooldownService(cooldown_seconds=0.05)
        svc.record("key-1", {})
        time.sleep(0.1)

        remaining = svc.remaining_seconds("key-1")
        assert remaining == 0.0

    def test_remaining_seconds_for_unknown_key(self):
        svc = VerificationCooldownService(cooldown_seconds=60)
        assert svc.remaining_seconds("never-seen") == 0.0

    def test_remaining_seconds_disabled_cooldown(self):
        svc = VerificationCooldownService(cooldown_seconds=0)
        svc.record("key-1", {})
        assert svc.remaining_seconds("key-1") == 0.0

    def test_max_entries_evicts_oldest(self):
        svc = VerificationCooldownService(cooldown_seconds=60, max_entries=3)
        svc.record("key-a", {"a": 1})
        svc.record("key-b", {"b": 2})
        svc.record("key-c", {"c": 3})
        # This 4th record must evict "key-a" (oldest).
        svc.record("key-d", {"d": 4})

        in_cd_a, _ = svc.check("key-a")
        in_cd_d, _ = svc.check("key-d")

        assert in_cd_a is False, "oldest entry should have been evicted"
        assert in_cd_d is True, "newest entry must still be present"


# ---------------------------------------------------------------------------
# Unit tests for identity-key builder helpers
# ---------------------------------------------------------------------------


class TestBuildHumanitarianKey:
    def test_uses_claim_id_when_present(self):
        key = build_humanitarian_key(
            claim_id="claim-abc",
            aid_claim="some long text",
            artifact_ids=["a1", "a2"],
        )
        assert key == "humanitarian:claim-abc"

    def test_fallback_key_from_claim_text(self):
        key = build_humanitarian_key(
            claim_id=None,
            aid_claim="Family of 5 displaced by flood",
            artifact_ids=[],
        )
        assert key.startswith("humanitarian:")
        assert "Family of 5 displaced by flood" in key

    def test_fallback_key_includes_sorted_artifact_ids(self):
        key_fwd = build_humanitarian_key(
            claim_id=None,
            aid_claim="claim text",
            artifact_ids=["b", "a"],
        )
        key_rev = build_humanitarian_key(
            claim_id=None,
            aid_claim="claim text",
            artifact_ids=["a", "b"],
        )
        assert key_fwd == key_rev

    def test_long_claim_text_is_truncated(self):
        long_claim = "x" * 200
        key = build_humanitarian_key(
            claim_id=None, aid_claim=long_claim, artifact_ids=[]
        )
        # Key must not grow indefinitely.
        assert len(key) <= len("humanitarian:") + 130


class TestBuildFraudKey:
    def test_returns_prefixed_claim_id(self):
        assert build_fraud_key("claim-xyz") == "fraud:claim-xyz"

    def test_returns_none_for_no_claim_id(self):
        assert build_fraud_key(None) is None
        assert build_fraud_key("") is None


# ---------------------------------------------------------------------------
# Integration tests — endpoint via TestClient with injected cooldown service
# ---------------------------------------------------------------------------

# Minimal stub provider response for humanitarian verification.
_STUB_HUMANITARIAN_RAW = {
    "success": True,
    "provider": "test",
    "model": "stub-model",
    "prompt_variant": "primary",
    "prompt_version": "v1",
    "verification": {
        "eligible": True,
        "confidence": 0.85,
        "reasoning": "Claim is credible",
    },
}


def _make_humanitarian_services():
    """Return (artifact_access_control, humanitarian_verification_service) stubs."""
    artifact_svc = MagicMock()
    artifact_svc.validate_role.return_value = True
    artifact_svc.validate_evidence_access.return_value = None

    verif_svc = MagicMock()
    verif_svc.get_model_version.return_value = "stub:1.0"
    verif_svc.verify_claim.return_value = _STUB_HUMANITARIAN_RAW

    return artifact_svc, verif_svc


def _humanitarian_payload(claim_id: str = "claim-001"):
    return {
        "aid_claim": "Family of 5 displaced by flood needs food and shelter",
        "supporting_evidence": ["damaged home photo"],
        "context_factors": {"location": "Kano, Nigeria"},
        "provider_preference": "test",
        "anchor_metadata": {"claim_id": claim_id, "campaign_ref": "camp-2024"},
    }


def _fraud_payload(claim_id: str = "fraud-claim-001"):
    return {
        "claims": [
            {
                "claim_id": "c1",
                "ip_address": "1.2.3.4",
                "evidence_hash": "abc",
                "amount": 100.0,
            },
            {
                "claim_id": "c2",
                "ip_address": "1.2.3.4",
                "evidence_hash": "def",
                "amount": 110.0,
            },
        ],
        "anchor_metadata": {"claim_id": claim_id, "campaign_ref": "camp-2024"},
    }


class TestHumanitarianCooldownIntegration:
    """End-to-end tests for the humanitarian cooldown via TestClient."""

    @pytest.fixture(autouse=True)
    def _inject_services(self):
        """Inject stub services and a fresh cooldown service before each test."""
        artifact_svc, verif_svc = _make_humanitarian_services()
        cooldown = VerificationCooldownService(cooldown_seconds=60)
        audit_store = MagicMock()
        audit_store.record.return_value = None

        app.state.artifact_access_control = artifact_svc
        app.state.humanitarian_verification_service = verif_svc
        app.state.cooldown_service = cooldown
        app.state.decision_audit_store = audit_store

        rate_limiter.reset()
        with patch("config.settings.rate_limit_enabled", False):
            yield

        # Clean up injected state.
        app.state.cooldown_service = None
        rate_limiter.reset()

    def test_first_request_processes_fresh(self):
        client = TestClient(app)
        resp = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        assert resp.status_code == 200
        data = resp.json()
        assert data["from_cooldown"] is False

    def test_second_request_inside_window_returns_cooldown(self):
        client = TestClient(app)
        # First request — fresh computation.
        r1 = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        assert r1.status_code == 200
        assert r1.json()["from_cooldown"] is False

        # Second request — same claim_id, within the 60 s window.
        r2 = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        assert r2.status_code == 200
        data2 = r2.json()
        assert data2["from_cooldown"] is True
        # The result payload should be identical to the first response's result.
        assert data2["result"] == r1.json()["result"]

    def test_request_outside_window_processes_fresh(self):
        """After the cooldown window expires a new computation is triggered."""
        # Use a very short window so we can test expiry without sleeping long.
        app.state.cooldown_service = VerificationCooldownService(
            cooldown_seconds=0.05
        )
        client = TestClient(app)

        r1 = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        assert r1.status_code == 200
        assert r1.json()["from_cooldown"] is False

        time.sleep(0.12)  # Past the 50 ms window.

        r2 = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        assert r2.status_code == 200
        assert r2.json()["from_cooldown"] is False

    def test_different_claim_ids_have_independent_cooldowns(self):
        client = TestClient(app)
        r1 = client.post(
            "/v1/ai/humanitarian/verify", json=_humanitarian_payload("claim-A")
        )
        assert r1.json()["from_cooldown"] is False

        # A different claim_id should NOT be in cooldown.
        r2 = client.post(
            "/v1/ai/humanitarian/verify", json=_humanitarian_payload("claim-B")
        )
        assert r2.json()["from_cooldown"] is False

        # The same claim-A again should now be in cooldown.
        r3 = client.post(
            "/v1/ai/humanitarian/verify", json=_humanitarian_payload("claim-A")
        )
        assert r3.json()["from_cooldown"] is True

    def test_cooldown_disabled_always_processes_fresh(self):
        """Setting cooldown_seconds=0 disables the cooldown entirely."""
        app.state.cooldown_service = VerificationCooldownService(cooldown_seconds=0)
        client = TestClient(app)

        for _ in range(3):
            resp = client.post(
                "/v1/ai/humanitarian/verify", json=_humanitarian_payload()
            )
            assert resp.status_code == 200
            assert resp.json()["from_cooldown"] is False

    def test_cooldown_response_contains_result_payload(self):
        """A cooldown response must carry a non-empty result, not None."""
        client = TestClient(app)
        client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())
        r2 = client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())

        data = r2.json()
        assert data["from_cooldown"] is True
        assert data["result"] is not None
        assert isinstance(data["result"], dict)

    def test_access_control_still_enforced_inside_cooldown(self):
        """A request with missing X-User-Role + artifact_ids must be rejected
        even when an earlier request already populated the cooldown store."""
        client = TestClient(app)
        # Prime the cooldown store with a clean request (no artifact_ids).
        client.post("/v1/ai/humanitarian/verify", json=_humanitarian_payload())

        # Now submit a request WITH artifact_ids but WITHOUT auth headers;
        # access control should reject before the cooldown can return a result.
        payload = _humanitarian_payload()
        payload["artifact_ids"] = ["artifact-abc"]
        resp = client.post("/v1/ai/humanitarian/verify", json=payload)
        assert resp.status_code == 400


class TestFraudCooldownIntegration:
    """End-to-end tests for the fraud detection cooldown via TestClient."""

    @pytest.fixture(autouse=True)
    def _inject_cooldown(self):
        cooldown = VerificationCooldownService(cooldown_seconds=60)
        audit_store = MagicMock()
        audit_store.record.return_value = None

        app.state.cooldown_service = cooldown
        app.state.decision_audit_store = audit_store

        rate_limiter.reset()
        with patch("config.settings.rate_limit_enabled", False):
            yield

        app.state.cooldown_service = None
        rate_limiter.reset()

    def test_first_request_processes_fresh(self):
        client = TestClient(app)
        resp = client.post("/v1/fraud/detect", json=_fraud_payload())
        assert resp.status_code == 200
        assert resp.json()["from_cooldown"] is False

    def test_second_request_inside_window_returns_cooldown(self):
        client = TestClient(app)
        r1 = client.post("/v1/fraud/detect", json=_fraud_payload())
        assert r1.status_code == 200
        assert r1.json()["from_cooldown"] is False

        r2 = client.post("/v1/fraud/detect", json=_fraud_payload())
        assert r2.status_code == 200
        data2 = r2.json()
        assert data2["from_cooldown"] is True

    def test_request_outside_window_processes_fresh(self):
        app.state.cooldown_service = VerificationCooldownService(cooldown_seconds=0.05)
        client = TestClient(app)

        r1 = client.post("/v1/fraud/detect", json=_fraud_payload())
        assert r1.json()["from_cooldown"] is False

        time.sleep(0.12)

        r2 = client.post("/v1/fraud/detect", json=_fraud_payload())
        assert r2.status_code == 200
        assert r2.json()["from_cooldown"] is False

    def test_no_anchor_claim_id_never_uses_cooldown(self):
        """Batches without an anchor claim_id are always processed fresh."""
        client = TestClient(app)
        payload = {
            "claims": [
                {"claim_id": "c1", "ip_address": "1.2.3.4", "amount": 100.0}
            ]
            # No anchor_metadata.
        }
        r1 = client.post("/v1/fraud/detect", json=payload)
        r2 = client.post("/v1/fraud/detect", json=payload)

        assert r1.json()["from_cooldown"] is False
        assert r2.json()["from_cooldown"] is False

    def test_cooldown_disabled_always_processes_fresh(self):
        app.state.cooldown_service = VerificationCooldownService(cooldown_seconds=0)
        client = TestClient(app)

        for _ in range(3):
            resp = client.post("/v1/fraud/detect", json=_fraud_payload())
            assert resp.status_code == 200
            assert resp.json()["from_cooldown"] is False

    def test_different_anchor_claim_ids_independent(self):
        client = TestClient(app)
        r1 = client.post("/v1/fraud/detect", json=_fraud_payload("fraud-A"))
        assert r1.json()["from_cooldown"] is False

        r2 = client.post("/v1/fraud/detect", json=_fraud_payload("fraud-B"))
        assert r2.json()["from_cooldown"] is False

        r3 = client.post("/v1/fraud/detect", json=_fraud_payload("fraud-A"))
        assert r3.json()["from_cooldown"] is True

    def test_cooldown_response_preserves_result_list(self):
        """Result list from cooldown response must match the original."""
        client = TestClient(app)
        r1 = client.post("/v1/fraud/detect", json=_fraud_payload())
        r2 = client.post("/v1/fraud/detect", json=_fraud_payload())

        assert r2.json()["from_cooldown"] is True
        # The results stored (ClaimFraudResult objects) are serialised via
        # Pydantic's model_dump, so comparing via JSON is the right approach.
        assert r2.json()["result"] == r1.json()["result"]
