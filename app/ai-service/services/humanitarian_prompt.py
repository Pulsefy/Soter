"""
Prompt templating for humanitarian aid claim verification.

This module standardizes prompt construction across providers and model families
(OpenAI/Groq-compatible APIs) to keep scoring objective and reproducible.
"""

from typing import Any, Dict, List, Optional
from services.prompt_registry import default_registry


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
    """Builds standardized humanitarian verification prompts.

    Issue #1201: accepts an explicit ``language`` hint (BCP-47-ish: "en", "es",
    "fr", "ar"). If the hint is unknown, the registry falls back to English
    and the returned dict sets ``language_fallback=True`` so callers can tell.

    A ``detect_language`` helper is provided for callers that don't know the
    language up front. It uses a coarse script-based heuristic (no external
    dependency) and is intentionally conservative: on ambiguous input it
    returns ``"en"`` rather than guessing wrong.
    """

    def __init__(self, registry=None):
        self._registry = registry if registry is not None else default_registry

    def build_primary_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        language: Optional[str] = None,
    ) -> Dict[str, str]:
        criteria_text = self._format_sphere_criteria()
        evidence_text = self._format_evidence(supporting_evidence)
        context_text = self._format_context_factors(context_factors)

        template, used_lang, fallback = self._registry.get("primary", language)
        rendered = template.render(
            criteria_text=criteria_text,
            aid_claim=aid_claim,
            evidence_text=evidence_text,
            context_text=context_text,
        )
        rendered["variant"] = template.variant
        rendered["language"] = used_lang
        rendered["prompt_version"] = template.version
        rendered["language_fallback"] = "true" if fallback else "false"
        return rendered

    def build_fallback_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        language: Optional[str] = None,
    ) -> Dict[str, str]:
        evidence_text = self._format_evidence(supporting_evidence)
        context_text = self._format_context_factors(context_factors)

        template, used_lang, fallback = self._registry.get("fallback", language)
        rendered = template.render(
            criteria_text="",
            aid_claim=aid_claim,
            evidence_text=evidence_text,
            context_text=context_text,
        )
        rendered["variant"] = template.variant
        rendered["language"] = used_lang
        rendered["prompt_version"] = template.version
        rendered["language_fallback"] = "true" if fallback else "false"
        return rendered

    @staticmethod
    def detect_language(text: str) -> str:
        """Coarse script-based language detection. Conservative: defaults to "en".

        - Arabic script → "ar"
        - Latin script with Spanish-specific diacritics → "es"
        - Latin script with French-specific diacritics → "fr"
        - Otherwise → "en"

        This is deliberately not a full language identifier. It covers the
        scripts and diacritics that distinguish the currently-registered
        languages, and returns "en" on ambiguity, which is the safe default
        given English is always registered.
        """
        if not text:
            return "en"
        # Arabic block (0600-06FF) and Arabic Supplement (0750-077F)
        if any("\u0600" <= ch <= "\u06ff" or "\u0750" <= ch <= "\u077f" for ch in text):
            return "ar"
        # Spanish-specific: inverted punctuation + ñ
        if any(ch in "¿¡ñÑ" for ch in text):
            return "es"
        # French-specific: c-cedilla, plus accented chars that Spanish doesn't use
        if any(ch in "çÇœŒ" for ch in text):
            return "fr"
        return "en"

    def _format_sphere_criteria(self) -> str:
        lines: List[str] = []
        for section, items in SPHERE_HANDBOOK_CRITERIA.items():
            lines.append(f"- {section}:")
            for item in items:
                lines.append(f"  * {item}")
        return "\n".join(lines)

    def _format_evidence(self, supporting_evidence: List[str]) -> str:
        if not supporting_evidence:
            return "(none provided)"
        return "\n".join(f"- {e}" for e in supporting_evidence)

    def _format_context_factors(self, context_factors: Dict[str, Any]) -> str:
        if not context_factors:
            return "(none provided)"
        return "\n".join(f"- {k}: {v}" for k, v in context_factors.items())

