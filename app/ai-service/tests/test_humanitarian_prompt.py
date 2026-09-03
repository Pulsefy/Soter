"""Tests for the versioned humanitarian prompt registry.

Covers the acceptance criteria from the prompt-versioning ticket:

* Prompts are addressed by name and version from a registry.
* The prompt version used is recorded on the result envelope.
* Changing a prompt requires a new version rather than editing in place.
* The active version per prompt is configurable.
* Tests assert the recorded version matches the prompt actually used.
"""

from __future__ import annotations

from typing import Any, Dict
from unittest.mock import MagicMock

import pytest

from services.humanitarian_prompt import (
    PromptRegistry,
    PromptVersion,
    SPHERE_HANDBOOK_CRITERIA,
)
from services.humanitarian_verification import (
    HumanitarianVerificationService,
    PRIMARY_PROMPT_NAME,
    FALLBACK_PROMPT_NAME,
)
from services.providers import (
    ProviderRegistry,
    LLMResponse,
    ModelProvider,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sample_build_kwargs() -> Dict[str, Any]:
    return {
        "aid_claim": "Community reports potable water deliveries are insufficient.",
        "supporting_evidence": ["Field report #22", "Distribution logs"],
        "context_factors": {"region": "north", "season": "dry"},
    }


# ---------------------------------------------------------------------------
# PromptVersion immutability + content_hash
# ---------------------------------------------------------------------------


class TestPromptVersionImmutability:
    def test_prompt_version_dataclass_is_frozen(self):
        """Mutating a registered PromptVersion must be impossible."""
        pv = PromptVersion(
            name="humanitarian_primary",
            version="1.0",
            description="desc",
            builder=lambda **kw: {"system": "s", "user": "u"},
        )
        with pytest.raises(Exception):
            pv.version = "2.0"  # type: ignore[misc]
        with pytest.raises(Exception):
            pv.name = "other"  # type: ignore[misc]

    def test_content_hash_is_stable_and_deterministic(self):
        """Same inputs yield the same hash; different inputs differ."""
        pv = PromptVersion(
            name="t",
            version="1.0",
            description="",
            builder=lambda **kw: {"system": kw["aid_claim"], "user": str(kw["context_factors"])},
        )
        a = _sample_build_kwargs()
        b = _sample_build_kwargs()
        assert pv.content_hash(**a) == pv.content_hash(**b)

        c = _sample_build_kwargs()
        c["aid_claim"] = "different claim text"
        assert pv.content_hash(**c) != pv.content_hash(**a)


# ---------------------------------------------------------------------------
# Registry: address-by-name+version + no re-registration (edit-in-place guard)
# ---------------------------------------------------------------------------


class TestRegistryAddressingAndImmutability:
    def test_resolve_by_explicit_name_and_version(self):
        reg = PromptRegistry()
        pv = reg.resolve("humanitarian_primary", version="1.0")
        assert pv.name == "humanitarian_primary"
        assert pv.version == "1.0"
        rendered = pv.build(**_sample_build_kwargs())
        assert "system" in rendered and "user" in rendered

    def test_resolve_unknown_name_raises(self):
        reg = PromptRegistry()
        with pytest.raises(ValueError, match="Unknown prompt name"):
            reg.resolve("does_not_exist")

    def test_resolve_unknown_version_raises(self):
        reg = PromptRegistry()
        with pytest.raises(ValueError, match="has no version"):
            reg.resolve("humanitarian_primary", version="999.0")

    def test_registering_same_name_and_version_is_forbidden(self):
        """AC: changing a prompt requires a NEW version – never edit in place."""
        reg = PromptRegistry()
        duplicate = PromptVersion(
            name="humanitarian_primary",
            version="1.0",
            description="attempted overwrite",
            builder=lambda **kw: {"system": "bad", "user": "prompt"},
        )
        with pytest.raises(ValueError, match="already registered"):
            reg.register(duplicate)

    def test_new_version_can_be_registered_and_resolved(self):
        """A genuinely new prompt (different version string) registers fine."""
        reg = PromptRegistry()
        v2 = PromptVersion(
            name="humanitarian_primary",
            version="2.0",
            description="improved v2 prompt",
            builder=lambda **kw: {
                "system": "You are a strict analyst.",
                "user": f"Claim: {kw['aid_claim']}",
            },
        )
        reg.register(v2)
        resolved = reg.resolve("humanitarian_primary", version="2.0")
        assert resolved.version == "2.0"
        # v1 still untouched and resolvable
        assert reg.resolve("humanitarian_primary", "1.0").version == "1.0"

    def test_set_active_version_rejects_missing_entries(self):
        reg = PromptRegistry()
        with pytest.raises(ValueError, match="not registered"):
            reg.set_active_version("nope", "1.0")
        with pytest.raises(ValueError, match="not registered"):
            reg.set_active_version("humanitarian_primary", "42.0")

    def test_list_versions_sorted(self):
        reg = PromptRegistry()
        reg.register(
            PromptVersion(
                name="humanitarian_primary",
                version="2.0",
                description="newer",
                builder=lambda **kw: {"system": "", "user": ""},
            )
        )
        versions = reg.list_versions("humanitarian_primary")
        assert versions == ["1.0", "2.0"]


# ---------------------------------------------------------------------------
# Active version configuration
# ---------------------------------------------------------------------------


class TestActiveVersionConfiguration:
    def test_default_active_version_is_latest_registered(self):
        reg = PromptRegistry()
        reg.register(
            PromptVersion(
                name="humanitarian_primary",
                version="2.0",
                description="newer",
                builder=lambda **kw: {"system": "", "user": ""},
            )
        )
        # Without explicit config -> latest (2.0) wins.
        assert reg.get_active_version("humanitarian_primary") == "2.0"
        assert reg.resolve("humanitarian_primary").version == "2.0"

    def test_active_version_from_init_dict_pins_to_older_version(self):
        reg = PromptRegistry(active_versions={"humanitarian_primary": "1.0"})
        reg.register(
            PromptVersion(
                name="humanitarian_primary",
                version="2.0",
                description="newer",
                builder=lambda **kw: {"system": "", "user": ""},
            )
        )
        assert reg.get_active_version("humanitarian_primary") == "1.0"
        assert reg.resolve("humanitarian_primary").version == "1.0"

    def test_set_active_version_at_runtime(self):
        reg = PromptRegistry()
        reg.register(
            PromptVersion(
                name="humanitarian_fallback",
                version="2.0",
                description="",
                builder=lambda **kw: {"system": "", "user": ""},
            )
        )
        assert reg.resolve("humanitarian_fallback").version == "2.0"
        reg.set_active_version("humanitarian_fallback", "1.0")
        assert reg.resolve("humanitarian_fallback").version == "1.0"


# ---------------------------------------------------------------------------
# Prompt rendering correctness (migration smoke tests)
# ---------------------------------------------------------------------------


class TestDefaultPromptRendering:
    def setup_method(self):
        self.registry = PromptRegistry()

    def test_primary_v1_renders_sphere_criteria(self):
        out = self.registry.build_prompt("humanitarian_primary", "1.0", **_sample_build_kwargs())
        assert "Sphere Criteria" in out["user"]
        assert "water_supply_sanitation_hygiene" in out["user"]
        assert "food_security_nutrition" in out["user"]

    def test_primary_v1_renders_context_factors(self):
        kw = {
            "aid_claim": "Temporary shelter distribution completed.",
            "supporting_evidence": [],
            "context_factors": {
                "security_level": "high_risk",
                "displacement_status": "ongoing",
            },
        }
        out = self.registry.build_prompt("humanitarian_primary", "1.0", **kw)
        assert "Context Factors" in out["user"]
        assert "security_level: high_risk" in out["user"]
        assert "displacement_status: ongoing" in out["user"]

    def test_fallback_v1_is_compact_and_structured(self):
        kw = {
            "aid_claim": "Clinic stockout has been resolved.",
            "supporting_evidence": ["Health cluster update"],
            "context_factors": {"district": "A1"},
        }
        out = self.registry.build_prompt("humanitarian_fallback", "1.0", **kw)
        assert "Fallback Humanitarian Verification" in out["user"]
        assert "Respond with JSON only" in out["user"]
        assert "verdict" in out["user"]

    def test_build_prompt_attaches_version_metadata(self):
        out = self.registry.build_prompt("humanitarian_primary", **_sample_build_kwargs())
        assert out["prompt_name"] == "humanitarian_primary"
        assert out["prompt_version"] == "1.0"
        assert out["prompt_content_hash"]
        # content_hash must match the resolved version's direct computation.
        pv = self.registry.resolve("humanitarian_primary", "1.0")
        assert out["prompt_content_hash"] == pv.content_hash(**_sample_build_kwargs())


# ---------------------------------------------------------------------------
# Service: version metadata is recorded on the verify_claim result dict
# ---------------------------------------------------------------------------


class _StubLLMProvider(ModelProvider):
    def __init__(self, responses):
        self._responses = list(responses)
        self._call_count = 0

    @property
    def name(self):
        return "stub"

    def llm_chat(self, system_prompt, user_prompt, *, model=None, timeout=None):
        if self._call_count >= len(self._responses):
            raise RuntimeError("No more stub responses")
        resp = self._responses[self._call_count]
        self._call_count += 1
        if isinstance(resp, Exception):
            raise resp
        return LLMResponse(content=resp, provider="stub", model=model or "stub-model")


class TestServiceRecordsPromptVersion:
    def setup_method(self):
        self.service = HumanitarianVerificationService()

    def _wire_stub_provider(self, responses):
        stub = _StubLLMProvider(responses)
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("stub", stub)]
        object.__setattr__(self.service, "registry", mock_registry)
        object.__setattr__(
            self.service, "_get_model_for_provider", lambda p: "stub-model"
        )

    def test_verify_claim_records_prompt_name_version_and_hash(self):
        self._wire_stub_provider(
            ['{"verdict":"credible","confidence":0.9,"summary":"ok"}']
        )
        build_kw = dict(
            aid_claim="Aid package reached all households.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"weather": "flooding"},
            provider_preference="stub",
        )
        result = self.service.verify_claim(**build_kw)

        # Basic shape preserved
        assert result["provider"] == "stub"
        assert result["prompt_variant"] == "primary"

        # New: registry metadata
        assert result["prompt_name"] == "humanitarian_primary"
        assert result["prompt_version"] == "1.0"
        assert "prompt_content_hash" in result

        # AC: recorded version must match the prompt actually used.
        pv = self.service.prompt_registry.resolve(
            result["prompt_name"], result["prompt_version"]
        )
        expected_hash = pv.content_hash(
            aid_claim=build_kw["aid_claim"],
            supporting_evidence=build_kw["supporting_evidence"],
            context_factors=build_kw["context_factors"],
        )
        assert result["prompt_content_hash"] == expected_hash, (
            "Recorded content_hash doesn't match re-rendered prompt content "
            "for the declared version."
        )

    def test_verify_claim_fallback_records_fallback_version(self):
        """Primary fails, fallback is used; recorded metadata must be fallback's."""
        self._wire_stub_provider(
            [
                RuntimeError("primary failure"),
                '{"verdict":"inconclusive","confidence":0.4,"summary":"insufficient evidence"}',
            ]
        )
        build_kw = dict(
            aid_claim="Aid package reached all households.",
            supporting_evidence=["monitoring sheet"],
            context_factors={"weather": "flooding"},
            provider_preference="stub",
        )
        result = self.service.verify_claim(**build_kw)
        assert result["prompt_variant"] == "fallback"
        assert result["prompt_name"] == "humanitarian_fallback"
        assert result["prompt_version"] == "1.0"

        pv = self.service.prompt_registry.resolve("humanitarian_fallback", "1.0")
        expected_hash = pv.content_hash(
            aid_claim=build_kw["aid_claim"],
            supporting_evidence=build_kw["supporting_evidence"],
            context_factors=build_kw["context_factors"],
        )
        assert result["prompt_content_hash"] == expected_hash

    def test_get_prompt_versions_tag_formats_both_prompts(self):
        tag = self.service.get_prompt_versions_tag()
        assert tag.startswith("primary=1.0|fallback=1.0")

    def test_service_uses_configured_active_versions_via_settings(self, monkeypatch):
        """Pinning an older active version surfaces its content in the result."""
        # Register v2 in a standalone registry, then construct the service
        # with a settings override that pins to v1.
        from config import settings

        monkeypatch.setattr(
            settings,
            "humanitarian_prompt_active_versions",
            {"humanitarian_primary": "1.0", "humanitarian_fallback": "1.0"},
        )

        svc = HumanitarianVerificationService()
        # Add a v2 primary
        svc.prompt_registry.register(
            PromptVersion(
                name="humanitarian_primary",
                version="2.0",
                description="test v2",
                builder=lambda **kw: {"system": "SYSTEM_V2", "user": f"V2: {kw['aid_claim']}"},
            )
        )
        self._wire_stub_provider_for(svc, ['{"verdict":"credible","confidence":1.0}'])

        result = svc.verify_claim(
            aid_claim="x" * 20,
            supporting_evidence=[],
            context_factors={},
            provider_preference="stub",
        )
        # With v1 pinned, recorded version should be 1.0 even though 2.0 exists.
        assert result["prompt_version"] == "1.0"

        # Now switch active to 2.0 at runtime: result should reflect v2 hash.
        svc.prompt_registry.set_active_version("humanitarian_primary", "2.0")
        self._wire_stub_provider_for(svc, ['{"verdict":"credible","confidence":1.0}'])
        result_v2 = svc.verify_claim(
            aid_claim="x" * 20,
            supporting_evidence=[],
            context_factors={},
            provider_preference="stub",
        )
        assert result_v2["prompt_version"] == "2.0"
        # Hashes must differ between versions because builders differ.
        assert result_v2["prompt_content_hash"] != result["prompt_content_hash"]

    @staticmethod
    def _wire_stub_provider_for(svc: HumanitarianVerificationService, responses):
        stub = _StubLLMProvider(responses)
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_llm.return_value = [("stub", stub)]
        object.__setattr__(svc, "registry", mock_registry)
        object.__setattr__(svc, "_get_model_for_provider", lambda p: "stub-model")
