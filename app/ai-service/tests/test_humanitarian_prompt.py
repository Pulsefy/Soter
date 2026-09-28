import pytest
from typing import Any, Dict, List
from services.prompt_registry import VerificationPrompt, PromptRegistry
from services.humanitarian_prompt import (
    HumanitarianPromptEngine,
    HumanitarianPrimaryPromptV1,
    HumanitarianFallbackPromptV1,
    HumanitarianPrimaryPromptV2,
    HumanitarianFallbackPromptV2,
    create_default_prompt_registry,
)


class CustomTestPrompt(VerificationPrompt):
    def __init__(
        self, name: str = "custom_test", version: str = "v1", desc: str = "Test prompt"
    ):
        self._name = name
        self._version = version
        self._desc = desc

    @property
    def name(self) -> str:
        return self._name

    @property
    def version(self) -> str:
        return self._version

    @property
    def description(self) -> str:
        return self._desc

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        return {
            "system": f"System prompt for {self.name}:{self.version}",
            "user": f"User prompt for claim={aid_claim}",
        }


class TestPromptRegistry:
    def setup_method(self):
        self.registry = PromptRegistry()

    def test_register_and_get_by_name_and_version(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        p2 = CustomTestPrompt(name="eval_prompt", version="v2")

        self.registry.register(p1)
        self.registry.register(p2)

        assert self.registry.get("eval_prompt", version="v1") is p1
        assert self.registry.get("eval_prompt", version="v2") is p2

    def test_get_defaults_to_active_version(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        p2 = CustomTestPrompt(name="eval_prompt", version="v2")

        self.registry.register(p1)  # First registered is automatically active
        self.registry.register(p2)

        assert self.registry.get("eval_prompt") is p1
        assert self.registry.get_active_version("eval_prompt") == "v1"

    def test_set_active_version_switches_active_prompt(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        p2 = CustomTestPrompt(name="eval_prompt", version="v2")

        self.registry.register(p1)
        self.registry.register(p2)

        self.registry.set_active_version("eval_prompt", "v2")
        assert self.registry.get("eval_prompt") is p2
        assert self.registry.get_active_version("eval_prompt") == "v2"

    def test_immutability_prevent_in_place_overwrite(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        p1_duplicate = CustomTestPrompt(name="eval_prompt", version="v1")

        self.registry.register(p1)

        with pytest.raises(ValueError) as exc_info:
            self.registry.register(p1_duplicate)

        assert "already registered" in str(exc_info.value)
        assert "Prompts are immutable; register a new version instead" in str(
            exc_info.value
        )

    def test_unknown_prompt_name_raises_value_error(self):
        with pytest.raises(ValueError) as exc_info:
            self.registry.get("nonexistent_prompt")

        assert "Unknown prompt name: 'nonexistent_prompt'" in str(exc_info.value)

    def test_unknown_version_raises_value_error(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        self.registry.register(p1)

        with pytest.raises(ValueError) as exc_info:
            self.registry.get("eval_prompt", version="v99")

        assert "has no version 'v99'" in str(exc_info.value)

    def test_set_active_version_unknown_version_raises_value_error(self):
        p1 = CustomTestPrompt(name="eval_prompt", version="v1")
        self.registry.register(p1)

        with pytest.raises(ValueError) as exc_info:
            self.registry.set_active_version("eval_prompt", "v99")

        assert "Cannot set active version to 'v99'" in str(exc_info.value)

    def test_list_prompts_and_versions(self):
        self.registry.register(CustomTestPrompt(name="prompt_a", version="v1"))
        self.registry.register(CustomTestPrompt(name="prompt_a", version="v2"))
        self.registry.register(CustomTestPrompt(name="prompt_b", version="v1"))

        prompts = self.registry.list_prompts()
        assert prompts == {
            "prompt_a": ["v1", "v2"],
            "prompt_b": ["v1"],
        }
        assert self.registry.list_versions("prompt_a") == ["v1", "v2"]
        assert self.registry.list_versions("prompt_b") == ["v1"]
        assert self.registry.list_versions("prompt_c") == []

    def test_has_check(self):
        self.registry.register(CustomTestPrompt(name="prompt_a", version="v1"))

        assert self.registry.has("prompt_a") is True
        assert self.registry.has("prompt_a", "v1") is True
        assert self.registry.has("prompt_a", "v2") is False
        assert self.registry.has("prompt_unknown") is False

    def test_default_prompt_registry_contains_v1_and_v2(self):
        reg = create_default_prompt_registry()

        assert reg.has("humanitarian_primary", "v1")
        assert reg.has("humanitarian_primary", "v2")
        assert reg.has("humanitarian_fallback", "v1")
        assert reg.has("humanitarian_fallback", "v2")
        assert reg.get_active_version("humanitarian_primary") == "v1"
        assert reg.get_active_version("humanitarian_fallback") == "v1"


class TestHumanitarianPromptEngine:
    def setup_method(self):
        self.registry = create_default_prompt_registry()
        self.engine = HumanitarianPromptEngine(registry=self.registry)

    def test_primary_prompt_includes_sphere_criteria(self):
        prompt = self.engine.build_primary_prompt(
            aid_claim="Community reports potable water deliveries are insufficient.",
            supporting_evidence=["Field report #22", "Distribution logs"],
            context_factors={"region": "north", "season": "dry"},
        )

        assert "Sphere Criteria" in prompt["user"]
        assert "water_supply_sanitation_hygiene" in prompt["user"]
        assert "food_security_nutrition" in prompt["user"]

    def test_primary_prompt_includes_context_factors(self):
        prompt = self.engine.build_primary_prompt(
            aid_claim="Temporary shelter distribution completed.",
            supporting_evidence=[],
            context_factors={
                "security_level": "high_risk",
                "displacement_status": "ongoing",
            },
        )

        assert "Context Factors" in prompt["user"]
        assert "security_level: high_risk" in prompt["user"]
        assert "displacement_status: ongoing" in prompt["user"]

    def test_fallback_prompt_is_compact_and_structured(self):
        prompt = self.engine.build_fallback_prompt(
            aid_claim="Clinic stockout has been resolved.",
            supporting_evidence=["Health cluster update"],
            context_factors={"district": "A1"},
        )

        assert "Fallback Humanitarian Verification" in prompt["user"]
        assert "Respond with JSON only" in prompt["user"]
        assert "verdict" in prompt["user"]

    def test_primary_prompt_version_selection(self):
        prompt_v1 = self.engine.build_primary_prompt(
            aid_claim="Food distribution claim",
            supporting_evidence=[],
            context_factors={},
            version="v1",
        )
        prompt_v2 = self.engine.build_primary_prompt(
            aid_claim="Food distribution claim",
            supporting_evidence=[],
            context_factors={},
            version="v2",
        )

        assert "Humanitarian Standard Verification Task\n\n" in prompt_v1["user"]
        assert (
            "Humanitarian Standard Verification Task (v2 Enhanced)\n\n"
            in prompt_v2["user"]
        )
        assert prompt_v1["system"] != prompt_v2["system"]

    def test_fallback_prompt_version_selection(self):
        prompt_v1 = self.engine.build_fallback_prompt(
            aid_claim="Medical claim",
            supporting_evidence=[],
            context_factors={},
            version="v1",
        )
        prompt_v2 = self.engine.build_fallback_prompt(
            aid_claim="Medical claim",
            supporting_evidence=[],
            context_factors={},
            version="v2",
        )

        assert "Fallback Humanitarian Verification\n\n" in prompt_v1["user"]
        assert "Fallback Humanitarian Verification (v2)\n\n" in prompt_v2["user"]

    def test_active_version_switch_changes_engine_output(self):
        prompt_default = self.engine.build_primary_prompt(
            aid_claim="Health claim",
            supporting_evidence=[],
            context_factors={},
        )
        assert "v2 Enhanced" not in prompt_default["user"]

        self.registry.set_active_version("humanitarian_primary", "v2")

        prompt_after_switch = self.engine.build_primary_prompt(
            aid_claim="Health claim",
            supporting_evidence=[],
            context_factors={},
        )
        assert "v2 Enhanced" in prompt_after_switch["user"]

    def test_build_repair_prompt(self):
        repair = self.engine.build_repair_prompt(
            original_user_prompt="Original request prompt text",
            malformed_content='{"verdict": "credible"',
            error_message="Unterminated string",
        )
        assert "system" in repair and "user" in repair
        assert "Return ONLY corrected, strictly valid JSON" in repair["system"]
        assert "Unterminated string" in repair["user"]
        assert '{"verdict": "credible"' in repair["user"]
        assert "Original request prompt text" in repair["user"]
