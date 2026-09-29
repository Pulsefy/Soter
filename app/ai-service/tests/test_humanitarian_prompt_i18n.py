"""Tests for multi-language humanitarian prompt builder (issue #1201)."""

import json
from pathlib import Path

import pytest

from services.humanitarian_prompt import (
    HumanitarianPromptEngine,
    detect_language,
    default_prompt_registry,
)

FIXTURES = json.loads(
    (
        Path(__file__).parent.parent / "fixtures" / "humanitarian_prompts_i18n.json"
    ).read_text(encoding="utf-8")
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
        assert p["variant"] == "primary"
        assert p["prompt_version"] == "v1"

    def test_unknown_language_falls_back_to_english(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Aid reached all households.",
            supporting_evidence=[],
            context_factors={},
            language="xx",
        )
        assert p["language"] == "en"

    def test_spanish_prompt_is_translated(self):
        p = self.engine.build_primary_prompt(
            aid_claim="Las entregas de agua son insuficientes.",
            supporting_evidence=[],
            context_factors={},
            language="es",
        )
        assert p["language"] == "es"
        assert "Criterios de Esfera" in p["user"]


class TestLanguageDetection:
    def test_detects_arabic_script(self):
        assert (
            detect_language("\u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0627\u062a")
            == "ar"
        )

    def test_detects_spanish_by_inverted_punctuation(self):
        assert detect_language("\u00bfLa ayuda lleg\u00f3?") == "es"

    def test_detects_french_by_cedilla(self):
        assert detect_language("L'aide est arriv\u00e9e \u00e7a") == "fr"

    def test_defaults_to_english_for_plain_latin(self):
        assert detect_language("Aid reached all households.") == "en"

    def test_empty_input_defaults_to_english(self):
        assert detect_language("") == "en"

    def test_region_suffix_is_stripped(self):
        p = HumanitarianPromptEngine().build_primary_prompt(
            aid_claim="Las entregas de agua son insuficientes.",
            supporting_evidence=[],
            context_factors={},
            language="es-MX",
        )
        assert p["language"] == "es"


class TestPromptRegistry:
    def test_registry_has_primary_and_fallback(self):
        assert default_prompt_registry.has("humanitarian_primary")
        assert default_prompt_registry.has("humanitarian_fallback")

    def test_registry_lists_v1_and_v2(self):
        versions = default_prompt_registry.list_versions("humanitarian_primary")
        assert "v1" in versions
        assert "v2" in versions
