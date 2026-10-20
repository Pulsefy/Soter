"""Tests for multilingual humanitarian verification prompts."""

import json
import os

import pytest

from regression_harness.deterministic_provider import DeterministicVerificationProvider
from regression_harness.run_accuracy_harness import LABELS, validate_fixtures
from services.humanitarian_prompt import (
    HumanitarianPromptEngine,
    create_default_prompt_registry,
)
from services.humanitarian_prompt_languages import (
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    detect_language,
    normalize_language,
    resolve_language,
)

FIXTURES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "regression_harness",
    "fixtures",
)
NON_ENGLISH = [lang for lang in SUPPORTED_LANGUAGES if lang != DEFAULT_LANGUAGE]


def _load(lang: str):
    with open(os.path.join(FIXTURES_DIR, f"golden_fixtures_{lang}.json")) as f:
        return json.load(f)


class TestLanguageResolution:
    @pytest.mark.parametrize(
        "hint,expected",
        [
            ("es", "es"),
            ("PT-br", "pt"),
            ("fr_CA", "fr"),
            ("xx", None),
            ("", None),
            (None, None),
        ],
    )
    def test_normalize(self, hint, expected):
        assert normalize_language(hint) == expected

    def test_detects_each_language_from_fixtures(self):
        for lang in NON_ENGLISH:
            for case in _load(lang):
                assert detect_language(case["input"]["aid_claim"]) == lang, case["id"]

    def test_detects_english_and_defaults(self):
        assert (
            detect_language("The team delivered kits to all of the households.") == "en"
        )
        assert detect_language("") == "en"
        assert detect_language("12345 !!!") == "en"

    def test_hint_overrides_detection(self):
        assert resolve_language("The team delivered the kits.", "fr") == "fr"

    def test_unsupported_hint_falls_back_to_detection(self):
        assert (
            resolve_language("Los equipos entregaron los kits con la lista.", "zz")
            == "es"
        )


class TestLocalizedRegistry:
    def test_each_language_registered_and_versioned(self):
        registry = create_default_prompt_registry()
        for lang in NON_ENGLISH:
            for kind in ("primary", "fallback"):
                name = f"humanitarian_{kind}_{lang}"
                assert registry.has(name, "v1")
                assert registry.get(name).version == "v1"

    def test_english_prompts_unchanged(self):
        engine = HumanitarianPromptEngine()
        prompt = engine.build_primary_prompt("Relief teams delivered kits.", [], {})
        assert "objective humanitarian verification analyst" in prompt["system"]

    @pytest.mark.parametrize("lang", NON_ENGLISH)
    def test_prompt_is_localized_and_keeps_schema(self, lang):
        engine = HumanitarianPromptEngine()
        case = _load(lang)[0]["input"]
        for builder in (engine.build_primary_prompt, engine.build_fallback_prompt):
            prompt = builder(
                case["aid_claim"],
                case["supporting_evidence"],
                case["context_factors"],
                language=lang,
            )
            assert case["aid_claim"] in prompt["user"]
            assert (
                "credible|partially_credible|inconclusive|not_credible"
                in prompt["user"]
            )
            assert "objective humanitarian" not in prompt["system"]

    def test_detected_language_selects_prompt_without_hint(self):
        engine = HumanitarianPromptEngine()
        case = _load("es")[0]["input"]
        prompt = engine.build_primary_prompt(case["aid_claim"], [], {})
        assert "Criterios Sphere" in prompt["user"]

    def test_unknown_english_version_falls_back_for_localized(self):
        engine = HumanitarianPromptEngine()
        prompt = engine.resolve_prompt("primary", "x", language="fr", version="v2")
        assert prompt.name == "humanitarian_primary_fr"
        assert prompt.version == "v1"

    def test_hint_forces_language_for_english_text(self):
        engine = HumanitarianPromptEngine()
        prompt = engine.resolve_prompt(
            "primary", "Relief kits were delivered.", language="pt"
        )
        assert prompt.name == "humanitarian_primary_pt"


class TestMultilingualGoldenFixtures:
    @pytest.mark.parametrize("lang", NON_ENGLISH)
    def test_fixture_file_is_valid(self, lang):
        cases = _load(lang)
        validate_fixtures(cases)
        counts = {label: 0 for label in LABELS}
        for case in cases:
            assert case["language"] == lang
            counts[case["expected"]] += 1
        assert all(counts[label] >= 3 for label in LABELS)

    @pytest.mark.parametrize("lang", NON_ENGLISH)
    def test_provider_runs_every_case(self, lang):
        provider = DeterministicVerificationProvider()
        for case in _load(lang):
            inp = case["input"]
            result = provider.predict(
                aid_claim=inp["aid_claim"],
                supporting_evidence=inp["supporting_evidence"],
                context_factors=inp["context_factors"],
                language=case["language"],
            )
            assert result["label"] in LABELS
