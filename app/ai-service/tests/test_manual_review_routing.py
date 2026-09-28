"""
End-to-end tests for manual-review routing when all LLM providers are
unavailable (Issue #1199).

Acceptance criteria covered:
1. When all providers are unavailable, a verification request results in a
   claim being flagged for manual review rather than a bare rejection.
2. The flag is included in the response payload sent back to the backend so
   the claim visibly enters the review queue instead of being lost.
3. Recovery (a provider becoming available again) is detected and does not
   require manual intervention to resume normal routing.
4. Test covers the full-outage path end to end.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import main
from services.circuit_breaker import CircuitBreaker, OPEN, CLOSED, HALF_OPEN
from services.humanitarian_verification import HumanitarianVerificationService
from services.load_shedder import build_manual_review_response
from services.providers import ModelProvider, LLMResponse, ProviderRegistry


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(main.app, follow_redirects=True)


# ---------------------------------------------------------------------------
# Unit: HumanitarianVerificationService helpers
# ---------------------------------------------------------------------------


class TestFlagForManualReview:
    """flag_for_manual_review() returns a structured payload the backend can use
    to enqueue the claim for human review."""

    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_returns_flagged_true(self):
        result = self.service.flag_for_manual_review(
            aid_claim="Family of 5 displaced by flood needs food and shelter",
        )
        assert result["flagged_for_manual_review"] is True

    def test_includes_human_readable_reason(self):
        result = self.service.flag_for_manual_review(
            aid_claim="Food kit needed",
        )
        assert "manual_review_reason" in result
        reason = result["manual_review_reason"]
        assert isinstance(reason, str)
        assert len(reason) > 10

    def test_preserves_aid_claim(self):
        claim = "Emergency medical supplies needed for flood victims."
        result = self.service.flag_for_manual_review(aid_claim=claim)
        assert result["aid_claim"] == claim

    def test_preserves_supporting_evidence(self):
        evidence = ["field report", "photo of damage"]
        result = self.service.flag_for_manual_review(
            aid_claim="Claim",
            supporting_evidence=evidence,
        )
        assert result["supporting_evidence"] == evidence

    def test_preserves_context_factors(self):
        ctx = {"region": "North", "disaster_type": "flood"}
        result = self.service.flag_for_manual_review(
            aid_claim="Claim",
            context_factors=ctx,
        )
        assert result["context_factors"] == ctx

    def test_defaults_evidence_and_context_to_empty(self):
        result = self.service.flag_for_manual_review(aid_claim="Claim")
        assert result["supporting_evidence"] == []
        assert result["context_factors"] == {}


class TestAllProvidersUnavailable:
    """all_providers_unavailable() correctly reflects circuit breaker states."""

    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_returns_false_when_no_providers_registered(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = []
        monkeypatch.setattr(self.service, "registry", mock_registry)
        assert self.service.all_providers_unavailable() is False

    def test_returns_true_when_all_circuits_open(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = ["openai", "groq"]
        monkeypatch.setattr(self.service, "registry", mock_registry)

        # Trip both breakers into OPEN state.
        for name in ("openai", "groq"):
            breaker = CircuitBreaker(name=f"test_{name}_unavail", failure_threshold=1)
            breaker.record_failure()
            assert breaker.state == OPEN
            self.service.breakers[name] = breaker

        assert self.service.all_providers_unavailable() is True

    def test_returns_false_when_at_least_one_circuit_closed(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = ["openai", "groq"]
        monkeypatch.setattr(self.service, "registry", mock_registry)

        # openai OPEN, groq CLOSED.
        open_breaker = CircuitBreaker(name="test_openai_partial", failure_threshold=1)
        open_breaker.record_failure()
        self.service.breakers["openai"] = open_breaker

        closed_breaker = CircuitBreaker(name="test_groq_partial", failure_threshold=3)
        self.service.breakers["groq"] = closed_breaker

        assert self.service.all_providers_unavailable() is False

    def test_returns_false_in_test_provider_mode(self, monkeypatch):
        from config import settings

        monkeypatch.setattr(settings, "test_provider_mode", True)
        assert self.service.all_providers_unavailable() is False


class TestCheckRecovery:
    """check_recovery() detects automatic HALF_OPEN recovery without requiring
    manual intervention."""

    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_returns_true_when_a_provider_is_closed(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = ["openai"]
        monkeypatch.setattr(self.service, "registry", mock_registry)

        closed_breaker = CircuitBreaker(name="test_rec_closed", failure_threshold=3)
        self.service.breakers["openai"] = closed_breaker

        assert self.service.check_recovery() is True

    def test_returns_false_when_all_still_open(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = ["openai"]
        monkeypatch.setattr(self.service, "registry", mock_registry)

        open_breaker = CircuitBreaker(name="test_rec_open", failure_threshold=1)
        open_breaker.record_failure()
        assert open_breaker.state == OPEN
        self.service.breakers["openai"] = open_breaker

        assert self.service.check_recovery() is False

    def test_returns_true_in_test_provider_mode(self, monkeypatch):
        from config import settings

        monkeypatch.setattr(settings, "test_provider_mode", True)
        assert self.service.check_recovery() is True

    def test_returns_false_when_no_providers_registered(self, monkeypatch):
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = []
        monkeypatch.setattr(self.service, "registry", mock_registry)
        assert self.service.check_recovery() is False


# ---------------------------------------------------------------------------
# Unit: build_manual_review_response
# ---------------------------------------------------------------------------


class TestBuildManualReviewResponse:
    def test_returns_200(self):
        response = build_manual_review_response("POST", "/v1/ai/humanitarian/verify")
        assert response.status_code == 200

    def test_payload_contains_flagged_true(self):
        response = build_manual_review_response("POST", "/v1/ai/humanitarian/verify")
        body = json.loads(response.body.decode())
        assert body["flagged_for_manual_review"] is True

    def test_result_contains_flagged_true(self):
        response = build_manual_review_response("POST", "/v1/ai/humanitarian/verify")
        body = json.loads(response.body.decode())
        result = body["result"]
        assert result["flagged_for_manual_review"] is True
        assert result["success"] is True

    def test_result_contains_manual_review_reason(self):
        response = build_manual_review_response("POST", "/v1/ai/humanitarian/verify")
        body = json.loads(response.body.decode())
        reason = body["result"]["manual_review_reason"]
        assert isinstance(reason, str)
        assert len(reason) > 10

    def test_no_retry_after_header(self):
        """Unlike the 503 shed response, a manual-review 200 should NOT carry
        a Retry-After header because the client does not need to retry."""
        response = build_manual_review_response("POST", "/v1/ai/humanitarian/verify")
        assert "retry-after" not in {k.lower() for k in response.headers.keys()}


# ---------------------------------------------------------------------------
# End-to-end: full-outage path via the HTTP middleware
# ---------------------------------------------------------------------------


class TestFullOutagePathE2E:
    """Covers the complete request path: middleware intercepts the request when
    all providers are unavailable, returns 200 with manual-review flag, and the
    claim is not silently discarded."""

    def test_full_outage_returns_200_not_503(self, client):
        """AC1 + AC2: request is NOT rejected; response is 200 with flag."""
        with patch(
            "services.load_shedder.check_provider_pressure",
            return_value=("provider_down", {"provider_health": "down"}),
        ):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Family of five needs emergency food and shelter"},
            )
        assert response.status_code == 200

    def test_full_outage_response_flagged_for_manual_review(self, client):
        """AC2: the flag is present in the payload."""
        with patch(
            "services.load_shedder.check_provider_pressure",
            return_value=("provider_down", {"provider_health": "down"}),
        ):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Flood survivors require clean water"},
            )
        data = response.json()
        assert data["flagged_for_manual_review"] is True
        result = data["result"]
        assert result["flagged_for_manual_review"] is True
        assert result["success"] is True

    def test_full_outage_response_includes_manual_review_reason(self, client):
        """AC2: reason string tells the backend *why* the claim was flagged."""
        with patch(
            "services.load_shedder.check_provider_pressure",
            return_value=("provider_down", {"provider_health": "down"}),
        ):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Emergency shelter needed for displaced families"},
            )
        data = response.json()
        reason = data["result"]["manual_review_reason"]
        assert isinstance(reason, str)
        assert len(reason) > 0

    def test_full_outage_metrics_incremented(self, client):
        """The provider_down shed metric is still incremented so operators can
        observe the outage even though the HTTP status is 200."""
        import metrics

        before = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="provider_down",
            method="POST",
            endpoint="/v1/ai/humanitarian/verify",
        )._value.get()

        with patch(
            "services.load_shedder.check_provider_pressure",
            return_value=("provider_down", {"provider_health": "down"}),
        ):
            client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Displaced families need clean water and shelter"},
            )

        after = metrics.REQUESTS_SHED_TOTAL.labels(
            reason="provider_down",
            method="POST",
            endpoint="/v1/ai/humanitarian/verify",
        )._value.get()

        assert after > before

    def test_non_humanitarian_routes_still_503_on_memory_pressure(self, client):
        """Other shedding paths (memory, queue) are unaffected by this change."""
        with patch("metrics.check_system_resources", return_value=False):
            response = client.post(
                "/v1/ai/anonymize",
                json={"text": "Some text with Jane Smith in Lagos."},
            )
        assert response.status_code == 503

    def test_normal_request_succeeds_when_providers_available(self, client):
        """When providers are up, requests flow through as normal (no manual-review
        flag in a successful AI response)."""
        with patch(
            "services.load_shedder.check_provider_pressure", return_value=None
        ):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Food distribution reached all households"},
            )
        # Status must not be the manual-review 200-with-flag; any status from the
        # actual route handler is acceptable (200 success, 422 validation, etc.)
        if response.status_code == 200:
            data = response.json()
            # The manual-review payload always has flagged_for_manual_review=True at
            # both the top level and inside result. A normal route response wraps in
            # ResultEnvelope which does not set this flag at the top level.
            top_level_flag = data.get("flagged_for_manual_review", False)
            if top_level_flag:
                pytest.fail(
                    "Got manual_review flag in response when providers are available"
                )


# ---------------------------------------------------------------------------
# Recovery path: provider comes back without manual intervention
# ---------------------------------------------------------------------------


class TestRecoveryPathE2E:
    """AC3: recovery is automatic and does not require manual intervention."""

    def test_recovery_detected_after_circuit_half_open(self):
        """Once recovery_timeout elapses the circuit moves OPEN -> HALF_OPEN
        and check_recovery() returns True without any manual reset call."""
        service = HumanitarianVerificationService()

        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.available_llm_providers.return_value = ["openai"]
        service.registry = mock_registry

        # Trip the breaker into OPEN with a very short recovery timeout.
        breaker = CircuitBreaker(
            name="test_recovery_e2e", failure_threshold=1, recovery_timeout=0.001
        )
        breaker.record_failure()
        assert breaker.state == OPEN
        service.breakers["openai"] = breaker

        # Before timeout elapses, still unavailable.
        assert service.all_providers_unavailable() is True
        assert service.check_recovery() is False

        # Let the recovery_timeout elapse (1 ms).
        import time

        time.sleep(0.01)

        # Now allow_request() triggers OPEN -> HALF_OPEN automatically.
        assert service.check_recovery() is True
        # And all_providers_unavailable() should now be False.
        assert service.all_providers_unavailable() is False

    def test_normal_routing_resumes_after_provider_recovers(self, client):
        """After a provider comes back up, the middleware no longer intercepts
        humanitarian verify requests for manual review."""
        with patch(
            "services.load_shedder.check_provider_pressure", return_value=None
        ):
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={"aid_claim": "Food distribution verified across all sectors"},
            )
        # Must NOT be the manual-review intercept (which would have flagged=True).
        assert response.status_code != 503
        if response.status_code == 200:
            data = response.json()
            top_level_flag = data.get("flagged_for_manual_review", False)
            if top_level_flag:
                pytest.fail(
                    "Got manual_review flag in response when providers are available"
                )
