"""
Prompt templating for humanitarian aid claim verification.

This module standardizes prompt construction across providers and model families
(OpenAI/Groq-compatible APIs) to keep scoring objective and reproducible.
"""

from typing import Any, Dict, List


SPHERE_HANDBOOK_CRITERIA: Dict[str, List[str]] = {
    "water_supply_sanitation_hygiene": [
        "Minimum daily water access is sufficient and equitable.",
        "Sanitation facilities are safe, accessible, and culturally appropriate.",
        "Hygiene support (soap, menstrual hygiene, handwashing) is consistently available.",
    ],
    "food_security_nutrition": [
        "Food assistance is adequate in quantity, quality, and nutritional value.",
        "Distribution is regular, impartial, and reaches vulnerable groups.",
        "Nutrition-sensitive support addresses children, pregnant, and lactating women.",
    ],
    "shelter_settlement": [
        "Shelter provides safety, privacy, weather protection, and dignity.",
        "Settlement planning reduces overcrowding and health risks.",
        "Shelter materials and design align with local context and inclusion needs.",
    ],
    "health": [
        "Essential health services are accessible without discrimination.",
        "Disease prevention and outbreak readiness are in place.",
        "Referral pathways and continuity of care are functioning.",
    ],
    "protection_inclusion_accountability": [
        "Assistance is impartial and minimizes protection risks.",
        "Affected people can provide feedback and raise complaints safely.",
        "Data and decision-making include age, gender, disability, and risk context.",
    ],
}


class HumanitarianPromptEngine:
    """Builds standardized humanitarian verification prompts."""

    def build_primary_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        criteria_text = self._format_sphere_criteria()
        evidence_text = self._format_evidence(supporting_evidence)
        context_text = self._format_context_factors(context_factors)

        system_prompt = (
            "You are an objective humanitarian verification analyst. "
            "Evaluate aid claims only from provided evidence and context. "
            "Apply a Humanitarian Standard grounded in Sphere criteria. "
            "Do not infer facts that are not explicitly present. "
            "Return valid JSON only."
        )

        user_prompt = (
            "Humanitarian Standard Verification Task\n\n"
            "Assess whether the aid claim is credible, partially credible, inconclusive, or not credible. "
            "Your analysis must map to Sphere Handbook criteria and explain uncertainty.\n\n"
            f"Sphere Criteria:\n{criteria_text}\n\n"
            f"Aid Claim:\n{aid_claim}\n\n"
            f"Supporting Evidence:\n{evidence_text}\n\n"
            f"Context Factors (from backend):\n{context_text}\n\n"
            "Output JSON schema exactly:\n"
            "{\n"
            "  \"verdict\": \"credible|partially_credible|inconclusive|not_credible\",\n"
            "  \"confidence\": 0.0,\n"
            "  \"summary\": \"short neutral summary\",\n"
            "  \"criteria_assessment\": [\n"
            "    {\"criterion\": \"string\", \"status\": \"met|partially_met|not_met|unknown\", \"reason\": \"string\"}\n"
            "  ],\n"
            "  \"risk_flags\": [\"string\"],\n"
            "  \"missing_information\": [\"string\"],\n"
            "  \"recommended_next_steps\": [\"string\"]\n"
            "}"
        )

        return {"system": system_prompt, "user": user_prompt}

    def build_fallback_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        evidence_text = self._format_evidence(supporting_evidence)
        context_text = self._format_context_factors(context_factors)

        system_prompt = (
            "You verify humanitarian aid claims conservatively. "
            "Use only supplied inputs. Return strict JSON only."
        )

        user_prompt = (
            "Fallback Humanitarian Verification\n\n"
            f"Claim: {aid_claim}\n"
            f"Evidence: {evidence_text}\n"
            f"Context: {context_text}\n\n"
            "Respond with JSON only:\n"
            "{\"verdict\":\"credible|partially_credible|inconclusive|not_credible\","
            "\"confidence\":0.0,\"summary\":\"\","
            "\"risk_flags\":[],\"missing_information\":[],\"recommended_next_steps\":[]}"
        )

        return {"system": system_prompt, "user": user_prompt}

    def _format_sphere_criteria(self) -> str:
        lines: List[str] = []
        for section, items in SPHERE_HANDBOOK_CRITERIA.items():
            lines.append(f"- {section}:")
            for item in items:
                lines.append(f"  * {item}")
        return "\n".join(lines)

    def _format_evidence(self, supporting_evidence: List[str]) -> str:
        if not supporting_evidence:
            return "- No supporting evidence provided"
        return "\n".join(f"- {entry}" for entry in supporting_evidence)

    def _format_context_factors(self, context_factors: Dict[str, Any]) -> str:
        if not context_factors:
            return "- No context factors provided"

        lines: List[str] = []
        for key in sorted(context_factors.keys()):
            value = context_factors[key]
            lines.append(f"- {key}: {value}")
        return "\n".join(lines)
