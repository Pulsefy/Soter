"""Confidence explanation alongside the numeric score (#1415).

The verification envelope carries a ``confidence`` score; this suite covers
the companion ``confidence_explanation`` list: which factors in the claim
produced that score, where the model's reasoning output supports deriving
them, and the graceful omission when it does not.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import main
from config import settings
from main import app
from services.confidence_explanation import (
    MAX_CONFIDENCE_FACTORS,
    derive_confidence_explanation,
)
from services.humanitarian_verification import HumanitarianVerificationService
from services.rate_limiter import rate_limiter

__test__ = True

client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Keep this module's requests out of the shared in-memory rate-limit
    window so later endpoint suites (e.g. the manual-review E2E path) still
    have budget -- same approach as test_versioned_routes.py."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()


_FIXTURES_PATH = (
    Path(__file__).resolve().parent.parent / "fixtures" / "humanitarian_responses.json"
)

# ---------------------------------------------------------------------------
# Derivation unit tests
# ---------------------------------------------------------------------------


class TestDeriveConfidenceExplanation:
    def test_explicit_confidence_factors_are_used_verbatim(self):
        verification = {
            "verdict": "credible",
            "confidence": 0.7,
            "confidence_factors": [
                "Two independent sources corroborate the claim",
                "Beneficiary appears in the displacement registry",
            ],
        }
        assert derive_confidence_explanation(verification) == [
            "Two independent sources corroborate the claim",
            "Beneficiary appears in the displacement registry",
        ]

    def test_confidence_factor_dicts_keep_the_impact(self):
        verification = {
            "confidence_factors": [
                {"factor": "No distribution record", "impact": "decreases confidence"},
                {"factor": "Recent field report"},
            ]
        }
        assert derive_confidence_explanation(verification) == [
            "No distribution record (decreases confidence)",
            "Recent field report",
        ]

    def test_factor_list_is_capped(self):
        verification = {
            "confidence_factors": [f"factor {i}" for i in range(10)],
        }
        explanation = derive_confidence_explanation(verification)
        assert explanation is not None
        assert len(explanation) == MAX_CONFIDENCE_FACTORS

    def test_criteria_assessment_puts_downward_drivers_first(self):
        verification = {
            "confidence": 0.42,
            "criteria_assessment": [
                {"criterion": "Beneficiary identification", "status": "met"},
                {"criterion": "Supporting documentation", "status": "not_met"},
                {"criterion": "Evidence recency", "status": "partially_met"},
                {"criterion": "Independent corroboration", "status": "unknown"},
            ],
        }
        assert derive_confidence_explanation(verification) == [
            "Supporting documentation: not_met",
            "Evidence recency: partially_met",
            "Independent corroboration: unknown",
        ]

    def test_criteria_assessment_keeps_the_model_reason(self):
        verification = {
            "criteria_assessment": [
                {
                    "criterion": "Supporting documentation",
                    "status": "not_met",
                    "reason": "No damage assessment attached",
                }
            ]
        }
        assert derive_confidence_explanation(verification) == [
            "Supporting documentation: not_met — No damage assessment attached"
        ]

    def test_uncertainty_flags_are_used_when_no_criteria_breakdown(self):
        verification = {
            "confidence": 0.3,
            "risk_flags": ["Claim district has no distribution record"],
            "missing_information": ["Beneficiary registry identifier"],
        }
        assert derive_confidence_explanation(verification) == [
            "Risk flag: Claim district has no distribution record",
            "Missing information: Beneficiary registry identifier",
        ]

    def test_list_form_reasoning_is_used_as_factors(self):
        verification = {
            "confidence": 0.6,
            "reasoning": [
                "Evidence matches the reported flood timeline",
                "No second source could confirm the household size",
            ],
        }
        assert derive_confidence_explanation(verification) == [
            "Evidence matches the reported flood timeline",
            "No second source could confirm the household size",
        ]

    def test_summary_only_response_is_omitted_not_fabricated(self):
        """A provider that returned only a prose summary yields no explanation."""
        verification = {
            "verdict": "credible",
            "confidence": 0.74,
            "summary": "The claim is well-supported by the provided evidence.",
        }
        assert derive_confidence_explanation(verification) is None

    def test_prose_reasoning_is_not_split_into_factors(self):
        verification = {
            "confidence": 0.8,
            "reasoning": "Evidence is consistent with regional monitoring data.",
        }
        assert derive_confidence_explanation(verification) is None

    @pytest.mark.parametrize(
        "verification",
        [
            None,
            "credible",
            {},
            {"criteria_assessment": []},
            {"confidence_factors": "not a list"},
            {"criteria_assessment": ["nonsense", 42]},
            {"risk_flags": [None, "", {}]},
        ],
    )
    def test_unusable_responses_return_none(self, verification):
        assert derive_confidence_explanation(verification) is None

    def test_junk_criteria_fall_through_to_the_next_source(self):
        verification = {
            "criteria_assessment": ["unusable"],
            "risk_flags": ["No corroboration"],
        }
        assert derive_confidence_explanation(verification) == [
            "Risk flag: No corroboration"
        ]

    def test_very_long_factors_are_trimmed(self):
        verification = {
            "criteria_assessment": [
                {"criterion": "A" * 500, "status": "not_met", "reason": "B" * 500}
            ]
        }
        explanation = derive_confidence_explanation(verification)
        assert explanation is not None
        assert len(explanation[0]) <= 200


# ---------------------------------------------------------------------------
# Envelope (HTTP) behaviour
# ---------------------------------------------------------------------------


class TestEnvelopeConfidenceExplanation:
    _REQUEST = {
        "aid_claim": "Confidence explanation: family of four displaced by flood needs shelter",
        "supporting_evidence": ["photo of damaged home"],
        "context_factors": {"location": "Kano, Nigeria"},
    }

    def test_explanation_sits_alongside_the_score(self):
        fake_verify = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "inconclusive",
                "confidence": 0.42,
                "summary": "Insufficient evidence.",
                "criteria_assessment": [
                    {"criterion": "Supporting documentation", "status": "not_met"},
                    {"criterion": "Independent corroboration", "status": "unknown"},
                ],
            },
            "raw_response": "{}",
        }
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=fake_verify,
        ):
            data = client.post("/v1/ai/humanitarian/verify", json=self._REQUEST).json()

        assert data["confidence"] == pytest.approx(0.42)
        assert data["confidence_explanation"] == [
            "Supporting documentation: not_met",
            "Independent corroboration: unknown",
        ]

    def test_explanation_omitted_when_reasoning_output_unsupported(self):
        fake_verify = {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "credible",
                "confidence": 0.74,
                "summary": "The claim is well-supported by the provided evidence.",
            },
            "raw_response": "{}",
        }
        with patch.object(
            main.humanitarian_verification_service,
            "verify_claim",
            return_value=fake_verify,
        ):
            data = client.post(
                "/v1/ai/humanitarian/verify",
                json={
                    **self._REQUEST,
                    "aid_claim": "Summary only provider response claim",
                },
            ).json()

        assert data["confidence"] == pytest.approx(0.74)
        assert data["confidence_explanation"] is None


# ---------------------------------------------------------------------------
# Fixture-based coverage for the standard test provider (AC)
# ---------------------------------------------------------------------------


class TestTestFixtureProviderConfidenceExplanation:
    """The standard test provider must always explain its score."""

    @pytest.fixture(autouse=True)
    def _use_test_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)
        monkeypatch.setattr(
            app.state,
            "humanitarian_verification_service",
            HumanitarianVerificationService(),
        )

    def test_verification_response_explains_confidence(self):
        response = client.post(
            "/v1/ai/humanitarian/verify",
            json={
                "aid_claim": (
                    "Fixture provider confidence explanation claim: "
                    "family of five displaced by flood"
                ),
                "supporting_evidence": ["photo of damaged home", "local report"],
                "context_factors": {"location": "Kano, Nigeria"},
                "provider_preference": "test",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["result"]["provider"] == "test"
        assert data["confidence"] is not None

        explanation = data["confidence_explanation"]
        assert explanation, "test provider response must carry a confidence explanation"
        assert len(explanation) <= MAX_CONFIDENCE_FACTORS
        for factor in explanation:
            assert isinstance(factor, str)
            assert factor.strip()

    @pytest.mark.parametrize(
        "fixture",
        json.loads(_FIXTURES_PATH.read_text()),
        ids=lambda fixture: f"{fixture['verdict']}-{fixture['confidence']}",
    )
    def test_every_test_provider_fixture_supports_an_explanation(self, fixture):
        explanation = derive_confidence_explanation(fixture)
        assert explanation, f"fixture lacks derivable confidence factors: {fixture}"
        assert 0 < len(explanation) <= MAX_CONFIDENCE_FACTORS
