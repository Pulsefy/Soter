"""Tests for multi-language humanitarian prompt builder (issue #1201)."""
import json
from pathlib import Path
import pytest
from services.humanitarian_prompt import HumanitarianPromptEngine
from services.prompt_registry import PromptRegistry, PromptTemplate, default_registry

FIXTURES = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "humanitarian_prompts_i18n.json")
    .read_text(encoding="utf-8")
)


@pytest.mark.parametrize(
    "lang,fixture",
    [(k, v) for k, v in FIXTURES.items() if not k.startswith("_")],
)
def test_golden_fixture(lang, fixture):
    p = HumanitarianPromptEngine().build_primary_prompt(
        aid_claim=fixture["sample_claim"],
        supporting_evidence=[],
        context_factors={},
        language=lang,
    )
    assert p["language"] == lang
    assert p["prompt_version"] == fixture["prompt_version"]
    assert p["language_fallback"] == "false"
    for s in fixture["assert_contains"]:
        assert s in p["user"], f"{lang}: missing {s!r}"


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

    def test_unknown_language_falls_back_to_english(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Aid reached all households.",
            supporting_evidence=[],
            context_factors={},
            language="xx",
        )
        assert p["language"] == "en"
        assert p["language_fallback"] == "true"


class TestLanguageDetection:
    def test_detects_arabic_script(self):
        assert HumanitarianPromptEngine.detect_language("\u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0627\u062a") == "ar"

    def test_detects_spanish_by_inverted_punctuation(self):
        assert HumanitarianPromptEngine.detect_language("\u00bfLa ayuda lleg\u00f3?") == "es"

    def test_detects_french_by_cedilla(self):
        assert HumanitarianPromptEngine.detect_language("L'aide est arriv\u00e9e \u00e7a") == "fr"

    def test_defaults_to_english_for_plain_latin(self):
        assert HumanitarianPromptEngine.detect_language("Aid reached all households.") == "en"


class TestPromptRegistry:
    def test_default_registry_has_all_languages(self):
        langs = default_registry.supported_languages("primary")
        for code in ("en", "es", "fr", "ar"):
            assert code in langs

    def test_registry_get_returns_fallback_flag(self):
        t, lang, fallback = default_registry.get("primary", "zz")
        assert lang == "en"
        assert fallback is True

    def test_custom_registration(self):
        reg = PromptRegistry()
        custom = PromptTemplate(
            variant="primary", language="xx", version="0.1",
            system_prompt="sys",
            user_prompt_template="{claim} {evidence} {context} {criteria}",
        )
        reg.register(custom)
        t, lang, fallback = reg.get("primary", "xx")
        assert lang == "xx"
        assert fallback is False
        assert t.version == "0.1"