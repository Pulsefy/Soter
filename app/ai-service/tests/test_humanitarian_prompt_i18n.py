"""Tests for multi-language humanitarian prompt builder (issue #1201)."""

from services.humanitarian_prompt import HumanitarianPromptEngine
from services.prompt_registry import PromptRegistry, PromptTemplate, default_registry


class TestLanguageParameter:
    def setup_method(self):
        self.engine = HumanitarianPromptEngine()

    def test_english_prompt_by_default(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Water deliveries are insufficient.",
            supporting_evidence=["Field report #22"],
            context_factors={"region": "north"},
        )
        assert p["language"] == "en"
        assert p["language_fallback"] == "false"
        assert p["variant"] == "primary"
        assert p["prompt_version"] == "1.0"

    def test_spanish_prompt_is_translated(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Las entregas de agua son insuficientes.",
            supporting_evidence=["Informe de campo #22"],
            context_factors={"region": "norte"},
            language="es",
        )
        assert p["language"] == "es"
        assert p["language_fallback"] == "false"
        assert "Criterios de Esfera" in p["user"]
        assert "Afirmación" in p["user"] or "Afirmacion" in p["user"]

    def test_unknown_language_falls_back_to_english(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Aid reached all households.",
            supporting_evidence=[],
            context_factors={},
            language="xx",
        )
        assert p["language"] == "en"
        assert p["language_fallback"] == "true"

    def test_fallback_prompt_also_accepts_language(self):
        p = self.engine.build_fallback_prompt(
            aid_claim="Clinic stockout resolved.",
            supporting_evidence=[],
            context_factors={},
            language="en",
        )
        assert p["variant"] == "fallback"
        assert p["language"] == "en"


class TestLanguageDetection:
    def test_detects_arabic_script(self):
        assert HumanitarianPromptEngine.detect_language("المساعدات الإنسانية") == "ar"

    def test_detects_spanish_by_inverted_punctuation(self):
        assert HumanitarianPromptEngine.detect_language("¿La ayuda llegó?") == "es"

    def test_detects_french_by_cedilla(self):
        assert HumanitarianPromptEngine.detect_language("L'aide est arrivée ça") == "fr"

    def test_defaults_to_english_for_plain_latin(self):
        assert HumanitarianPromptEngine.detect_language("Aid reached all households.") == "en"

    def test_empty_input_defaults_to_english(self):
        assert HumanitarianPromptEngine.detect_language("") == "en"


class TestPromptRegistry:
    def test_default_registry_has_english(self):
        assert "en" in default_registry.supported_languages("primary")

    def test_default_registry_has_es_fr_ar(self):
        langs = default_registry.supported_languages("primary")
        assert "es" in langs and "fr" in langs and "ar" in langs

    def test_registry_get_returns_fallback_flag(self):
        t, lang, fallback = default_registry.get("primary", "zz")
        assert lang == "en"
        assert fallback is True

    def test_custom_registration(self):
        reg = PromptRegistry()
        custom = PromptTemplate(
            variant="primary",
            language="xx",
            version="0.1",
            system_prompt="sys",
            user_prompt_template="{claim} {evidence} {context} {criteria}",
        )
        reg.register(custom)
        t, lang, fallback = reg.get("primary", "xx")
        assert lang == "xx"
        assert fallback is False
        assert t.version == "0.1"