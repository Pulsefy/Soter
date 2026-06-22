from services.humanitarian_prompt import HumanitarianPromptEngine


class TestHumanitarianPromptEngine:
    def setup_method(self):
        self.engine = HumanitarianPromptEngine()

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
            context_factors={"security_level": "high_risk", "displacement_status": "ongoing"},
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
