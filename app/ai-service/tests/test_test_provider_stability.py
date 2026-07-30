"""Stability tests for the fixture-driven TestProvider across all endpoints."""

import pytest
from unittest.mock import MagicMock

from config import settings
from services.test_provider import TestProvider
from services.humanitarian_verification import HumanitarianVerificationService
from services.ocr import OCRService
from services.pii_scrubber import PIIScrubberService
from services.providers import LLMResponse

__test__ = True


# -----------------------------------------------------------------------
# TestProvider unit-level determinism
# -----------------------------------------------------------------------


class TestTestProviderDeterminism:
    def setup_method(self):
        self.provider = TestProvider()

    def test_same_input_returns_same_output(self):
        first = self.provider.get_response("humanitarian", {"text": "hello"})
        second = self.provider.get_response("humanitarian", {"text": "hello"})
        assert first == second

    def test_different_inputs_can_produce_different_outputs(self):
        results = set()
        for i in range(30):
            r = self.provider.get_response("humanitarian", {"seed": i})
            results.add(str(r))
        assert len(results) > 1

    def test_deterministic_key_includes_all_fields(self):
        key1 = self.provider._deterministic_key("ep", {"a": 1, "b": 2})
        key2 = self.provider._deterministic_key("ep", {"b": 2, "a": 1})
        assert key1 == key2

    def test_different_endpoints_have_different_fixtures(self):
        ocr_resp = self.provider.get_response("ocr", {"dummy": True})
        pol_resp = self.provider.get_response("proof_of_life", {"dummy": True})
        assert ocr_resp != pol_resp

    def test_proof_of_life_borderline_fixture_is_selected_deterministically(self):
        first = self.provider.get_response(
            "proof_of_life",
            {"has_burst": True, "confidence_threshold": 0.70, "scenario": "borderline"},
        )
        second = self.provider.get_response(
            "proof_of_life",
            {"has_burst": True, "confidence_threshold": 0.70, "scenario": "borderline"},
        )

        assert first == second
        assert first["is_real_person"] is False
        assert first["confidence"] == pytest.approx(0.68)
        assert "borderline" in first["reason"].lower()
        assert "threshold" in first["reason"].lower()

    def test_provider_cache_works(self):
        assert "humanitarian" not in self.provider._cache
        self.provider.get_response("humanitarian", {"x": 1})
        assert "humanitarian" in self.provider._cache


# -----------------------------------------------------------------------
# Humanitarian verification – stability
# -----------------------------------------------------------------------


class TestHumanitarianTestProviderStability:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def test_deterministic_verify_claim_outputs_remain_stable(self, monkeypatch):
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", "test-api-key")

        mock_provider = MagicMock()
        mock_provider.llm_chat.return_value = LLMResponse(
            content='{"verdict":"credible","confidence":0.74,"summary":"Deterministic verification output for testing"}',
            provider="openai",
            model="test-model",
        )
        mock_registry = MagicMock()
        mock_registry.resolve_llm.return_value = [("openai", mock_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)
        monkeypatch.setattr(
            self.service, "_get_model_for_provider", lambda p: "test-model"
        )

        first = self.service.verify_claim(
            aid_claim="Emergency medical supplies delivered.",
            supporting_evidence=["field report"],
            context_factors={"region": "coastal"},
        )
        second = self.service.verify_claim(
            aid_claim="Emergency medical supplies delivered.",
            supporting_evidence=["field report"],
            context_factors={"region": "coastal"},
        )
        assert first == second

    def test_test_provider_stable_across_runs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        first = self.service.verify_claim(
            aid_claim="Food distribution reached 500 households.",
            supporting_evidence=["WFP log #A-42"],
            context_factors={"disaster": "flooding"},
        )
        second = self.service.verify_claim(
            aid_claim="Food distribution reached 500 households.",
            supporting_evidence=["WFP log #A-42"],
            context_factors={"disaster": "flooding"},
        )
        assert first == second

    def test_test_provider_output_structure(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        result = self.service.verify_claim(
            aid_claim="Test claim.",
            supporting_evidence=["doc"],
            context_factors={},
        )
        assert result["provider"] == "test"
        assert "verification" in result
        assert "verdict" in result["verification"]
        assert "confidence" in result["verification"]
        assert "summary" in result["verification"]
        assert result["verification"]["verdict"] in (
            "credible",
            "inconclusive",
            "not_credible",
        )
        assert 0.0 <= result["verification"]["confidence"] <= 1.0


# -----------------------------------------------------------------------
# OCR – stability (test provider bypasses Tesseract)
# -----------------------------------------------------------------------


class TestOCRTestProviderStability:
    def setup_method(self):
        self.service = OCRService()

    def test_ocr_stable_across_runs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        from PIL import Image

        img = Image.new("RGB", (100, 50), color="white")

        first = self.service.process_image(img)
        second = self.service.process_image(img)

        assert first.fields == second.fields
        assert first.raw_text == second.raw_text
        assert first.processing_time_ms == second.processing_time_ms

    def test_ocr_output_structure(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        from PIL import Image

        img = Image.new("RGB", (200, 100), color="white")

        result = self.service.process_image(img)
        assert hasattr(result, "fields")
        assert hasattr(result, "raw_text")
        assert hasattr(result, "processing_time_ms")

    def test_ocr_different_inputs_can_produce_different_outputs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        from services.providers import FixtureProvider

        provider = FixtureProvider()
        texts = set()
        for i in range(30):
            resp = provider._inner.get_response(
                "ocr", {"seed": i, "variant": f"input_{i}"}
            )
            texts.add(resp.get("raw_text", ""))

        assert len(texts) > 1

    def test_ocr_regular_service_unchanged(self, monkeypatch):
        """Without test_provider_mode, OCR goes through the real dependency path."""
        from unittest.mock import MagicMock
        from PIL import Image

        img = Image.new("RGB", (50, 50), color="red")

        monkeypatch.setattr(settings, "test_provider_mode", False)

        failing_provider = MagicMock()
        failing_provider.name = "failing"
        failing_provider.ocr_extract.side_effect = RuntimeError("no tesseract")

        mock_registry = MagicMock()
        mock_registry.resolve_ocr.return_value = [("failing", failing_provider)]
        monkeypatch.setattr(self.service, "registry", mock_registry)

        result = self.service.process_image(img)
        assert result.raw_text == ""
        assert result.fields == {}


# -----------------------------------------------------------------------
# PII scrubber – stability (test provider bypasses spaCy)
# -----------------------------------------------------------------------


class TestPIIscrubberTestProviderStability:
    def setup_method(self):
        self.service = PIIScrubberService()

    def test_anonymize_stable_across_runs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        text = "John Doe lives in New York and was born on 15/03/1988."

        first = self.service.anonymize(text)
        second = self.service.anonymize(text)

        assert first == second

    def test_anonymize_output_structure(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        result = self.service.anonymize("Sample text with some PII data.")

        assert "original_length" in result
        assert "anonymized_text" in result
        assert "pii_summary" in result
        assert "token_counts" in result
        assert "total" in result["pii_summary"]

    def test_anonymize_different_inputs_produce_different_outputs(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        outputs = set()
        for i in range(12):
            r = self.service.anonymize(f"Test input number {i} with unique content.")
            outputs.add(str(r))

        assert len(outputs) > 1

    def test_anonymize_pii_summary_is_valid(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)

        result = self.service.anonymize("Test")
        summary = result["pii_summary"]
        assert summary["names"] >= 0
        assert summary["locations"] >= 0
        assert summary["total"] == sum(
            summary[k]
            for k in ("names", "locations", "dates", "emails", "phones", "ids")
        )


# -----------------------------------------------------------------------
# Cross-endpoint determinism sanity
# -----------------------------------------------------------------------


class TestCrossEndpointStability:
    def setup_method(self):
        self.humanitarian = HumanitarianVerificationService()
        self.ocr = OCRService()
        self.pii = PIIScrubberService()

    def test_each_endpoint_has_own_fixture_set(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "openai_api_key", None)
        monkeypatch.setattr(settings, "groq_api_key", None)

        from PIL import Image

        h = self.humanitarian.verify_claim("Test claim.", ["doc"], {})
        o = self.ocr.process_image(Image.new("RGB", (50, 50), color="white"))
        a = self.pii.anonymize("Test text.")

        assert h["provider"] == "test"
        assert o.raw_text is not None
        assert "anonymized_text" in a
