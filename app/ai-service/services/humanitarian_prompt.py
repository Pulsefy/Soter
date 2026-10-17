"""
Prompt templating for humanitarian aid claim verification.

This module standardizes prompt construction across providers and model families
(OpenAI/Groq-compatible APIs) to keep scoring objective and reproducible.
All prompts are versioned and managed through a PromptRegistry.
"""

from typing import Any, Dict, List, Optional
from services.prompt_registry import VerificationPrompt, PromptRegistry

#: Version of the prompt templates below. Bump this whenever the system or
#: user prompt text changes so decision audit records (issue #990) can tie a
#: past decision to the exact prompt that produced it.
HUMANITARIAN_PROMPT_VERSION = "humanitarian-sphere-v1"
SUPPORTED_HUMANITARIAN_LANGUAGES = ("en", "es", "fr", "ar")

_LOCALIZED_PROMPTS = {
    "es": {
        "system": "Eres un analista objetivo de verificación humanitaria. Evalúa las afirmaciones únicamente con la evidencia y el contexto proporcionados. No infieras hechos que no estén presentes. Responde en español y devuelve solo JSON válido.",
        "task": "Tarea de verificación de estándares humanitarios",
        "instruction": "Evalúa si la afirmación es creíble, parcialmente creíble, inconclusa o no creíble. Relaciona el análisis con los criterios del Manual Esfera y explica la incertidumbre.",
        "criteria": "Criterios Esfera",
        "claim": "Afirmación de ayuda",
        "evidence": "Evidencia de apoyo",
        "context": "Factores contextuales (del backend)",
        "summary": "resumen neutral breve",
        "criterion": "string",
        "status": "met|partially_met|not_met|unknown",
        "reason": "string",
        "fallback": "Verificación humanitaria alternativa",
        "respond": "Responde solo con JSON:",
        "criteria_names": ["agua, saneamiento e higiene", "seguridad alimentaria y nutrición", "alojamiento y asentamientos", "salud", "protección, inclusión y rendición de cuentas"],
    },
    "fr": {
        "system": "Vous êtes un analyste objectif de vérification humanitaire. Évaluez les affirmations uniquement à partir des preuves et du contexte fournis. N'inférez aucun fait absent. Répondez en français et renvoyez uniquement du JSON valide.",
        "task": "Tâche de vérification des normes humanitaires",
        "instruction": "Évaluez si l'affirmation est crédible, partiellement crédible, indéterminée ou non crédible. Reliez l'analyse aux critères du Manuel Sphère et expliquez les incertitudes.",
        "criteria": "Critères Sphère",
        "claim": "Affirmation concernant l'aide",
        "evidence": "Éléments de preuve",
        "context": "Facteurs contextuels (du backend)",
        "summary": "bref résumé neutre",
        "criterion": "string",
        "status": "met|partially_met|not_met|unknown",
        "reason": "string",
        "fallback": "Vérification humanitaire de secours",
        "respond": "Répondez uniquement en JSON :",
        "criteria_names": ["eau, assainissement et hygiène", "sécurité alimentaire et nutrition", "abris et établissements", "santé", "protection, inclusion et responsabilité"],
    },
    "ar": {
        "system": "أنت محلل موضوعي للتحقق الإنساني. قيّم الادعاءات اعتماداً فقط على الأدلة والسياق المقدمين. لا تستنتج حقائق غير مذكورة. أجب باللغة العربية وأعد JSON صالحاً فقط.",
        "task": "مهمة التحقق من المعايير الإنسانية",
        "instruction": "قيّم ما إذا كان الادعاء موثوقاً أو موثوقاً جزئياً أو غير محسوم أو غير موثوق. اربط التحليل بمعايير دليل اسفير واشرح مواطن عدم اليقين.",
        "criteria": "معايير اسفير",
        "claim": "ادعاء المساعدة",
        "evidence": "الأدلة الداعمة",
        "context": "عوامل السياق (من النظام الخلفي)",
        "summary": "ملخص محايد وموجز",
        "criterion": "string",
        "status": "met|partially_met|not_met|unknown",
        "reason": "string",
        "fallback": "التحقق الإنساني البديل",
        "respond": "أجب بصيغة JSON فقط:",
        "criteria_names": ["المياه والصرف الصحي والنظافة", "الأمن الغذائي والتغذية", "المأوى والمستوطنات", "الصحة", "الحماية والشمول والمساءلة"],
    },
}


def normalize_humanitarian_language(language: Optional[str]) -> str:
    """Normalize a caller-supplied language tag to a supported base language."""
    normalized = (language or "en").strip().lower().replace("_", "-").split("-")[0]
    if normalized not in SUPPORTED_HUMANITARIAN_LANGUAGES:
        raise ValueError(
            f"Unsupported humanitarian prompt language '{language}'. "
            f"Supported languages: {', '.join(SUPPORTED_HUMANITARIAN_LANGUAGES)}"
        )
    return normalized


def humanitarian_prompt_name(prompt_type: str, language: Optional[str] = None) -> str:
    normalized = normalize_humanitarian_language(language)
    base_name = f"humanitarian_{prompt_type}"
    return base_name if normalized == "en" else f"{base_name}_{normalized}"


class LocalizedHumanitarianPrompt(VerificationPrompt):
    """Localized immutable prompt variant registered per language and type."""

    def __init__(self, prompt_type: str, language: str):
        self.prompt_type = prompt_type
        self.language = language

    @property
    def name(self) -> str:
        return humanitarian_prompt_name(self.prompt_type, self.language)

    @property
    def version(self) -> str:
        return "v1"

    @property
    def description(self) -> str:
        return f"Version 1 {self.prompt_type} humanitarian prompt in {self.language}."

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        localized = _LOCALIZED_PROMPTS[self.language]
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)
        criteria = "\n".join(
            f"- {criterion}" for criterion in localized["criteria_names"]
        )
        if self.prompt_type == "primary":
            task = (
                f"{localized['task']}\n\n{localized['instruction']}\n\n"
                f"{localized['criteria']}:\n{criteria}\n\n"
            )
            schema = (
                '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
                '  "confidence": 0.0,\n'
                f'  "summary": "{localized["summary"]}",\n'
                '  "criteria_assessment": [\n'
                f'    {{"criterion": "{localized["criterion"]}", "status": "{localized["status"]}", "reason": "{localized["reason"]}"}}\n'
                "  ],\n"
                '  "risk_flags": ["string"],\n'
                '  "missing_information": ["string"],\n'
                '  "recommended_next_steps": ["string"]'
            )
        else:
            task = f"{localized['fallback']}\n\n"
            schema = (
                '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
                f'"confidence":0.0,"summary":"{localized["summary"]}",'
                '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
            )
        user_prompt = (
            f"{task}{localized['claim']}: {aid_claim}\n"
            f"{localized['evidence']}:\n{evidence_text}\n"
            f"{localized['context']}:\n{context_text}\n\n"
            f"{localized['respond']}\n{{\n{schema}\n}}"
        )
        return {"system": localized["system"], "user": user_prompt}

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


def format_sphere_criteria(criteria: Optional[Dict[str, List[str]]] = None) -> str:
    """Format Sphere Handbook criteria into structured markdown bullets."""
    target_criteria = criteria or SPHERE_HANDBOOK_CRITERIA
    lines: List[str] = []
    for section, items in target_criteria.items():
        lines.append(f"- {section}:")
        for item in items:
            lines.append(f"  * {item}")
    return "\n".join(lines)


def format_evidence(supporting_evidence: List[str]) -> str:
    """Format supporting evidence list into markdown bullets."""
    if not supporting_evidence:
        return "- No supporting evidence provided"
    return "\n".join(f"- {entry}" for entry in supporting_evidence)


def format_context_factors(context_factors: Dict[str, Any]) -> str:
    """Format context factors dictionary into deterministic sorted markdown bullets."""
    if not context_factors:
        return "- No context factors provided"

    lines: List[str] = []
    for key in sorted(context_factors.keys()):
        value = context_factors[key]
        lines.append(f"- {key}: {value}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Prompt Implementations (v1)
# ---------------------------------------------------------------------------


class HumanitarianPrimaryPromptV1(VerificationPrompt):
    """v1 Primary verification prompt grounded in standard Sphere criteria."""

    #: Exposed on the instance so callers (notably the decision audit trail)
    #: can record which prompt version produced a decision.
    prompt_version: str = HUMANITARIAN_PROMPT_VERSION

    @property
    def name(self) -> str:
        return "humanitarian_primary"

    @property
    def version(self) -> str:
        return "v1"

    @property
    def description(self) -> str:
        return "Standard humanitarian primary verification prompt grounded in Sphere handbook criteria."

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        criteria_text = format_sphere_criteria()
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)

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
            '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
            '  "confidence": 0.0,\n'
            '  "summary": "short neutral summary",\n'
            '  "criteria_assessment": [\n'
            '    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}\n'
            "  ],\n"
            '  "risk_flags": ["string"],\n'
            '  "missing_information": ["string"],\n'
            '  "recommended_next_steps": ["string"]\n'
            "}"
        )

        return {"system": system_prompt, "user": user_prompt}

    def build_primary_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        return self.build_prompt(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
        )


class HumanitarianFallbackPromptV1(VerificationPrompt):
    """v1 Compact fallback verification prompt for token-cheap retries."""

    @property
    def name(self) -> str:
        return "humanitarian_fallback"

    @property
    def version(self) -> str:
        return "v1"

    @property
    def description(self) -> str:
        return "Compact fallback verification prompt for resilience and quick retry."

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)

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
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        )

        return {"system": system_prompt, "user": user_prompt}


# ---------------------------------------------------------------------------
# Prompt Implementations (v2)
# ---------------------------------------------------------------------------


class HumanitarianPrimaryPromptV2(VerificationPrompt):
    """v2 Enhanced primary prompt with explicit cross-sector impact guidelines."""

    @property
    def name(self) -> str:
        return "humanitarian_primary"

    @property
    def version(self) -> str:
        return "v2"

    @property
    def description(self) -> str:
        return "Enhanced primary verification prompt with detailed cross-sector impact analysis."

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        criteria_text = format_sphere_criteria()
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)

        system_prompt = (
            "You are an expert humanitarian verification auditor. "
            "Evaluate aid claims strictly from provided evidence and context. "
            "Apply the Core Humanitarian Standard and Sphere criteria. "
            "Maintain high scrutiny for unverified inferences. "
            "Return valid JSON only."
        )

        user_prompt = (
            "Humanitarian Standard Verification Task (v2 Enhanced)\n\n"
            "Assess whether the aid claim is credible, partially credible, inconclusive, or not credible. "
            "Ensure criteria assessments cite specific evidence items where possible.\n\n"
            f"Sphere Criteria:\n{criteria_text}\n\n"
            f"Aid Claim:\n{aid_claim}\n\n"
            f"Supporting Evidence:\n{evidence_text}\n\n"
            f"Context Factors (from backend):\n{context_text}\n\n"
            "Output JSON schema exactly:\n"
            "{\n"
            '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
            '  "confidence": 0.0,\n'
            '  "summary": "short neutral summary",\n'
            '  "criteria_assessment": [\n'
            '    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}\n'
            "  ],\n"
            '  "risk_flags": ["string"],\n'
            '  "missing_information": ["string"],\n'
            '  "recommended_next_steps": ["string"]\n'
            "}"
        )

        return {"system": system_prompt, "user": user_prompt}


class HumanitarianFallbackPromptV2(VerificationPrompt):
    """v2 Fallback prompt with structured uncertainty flags."""

    @property
    def name(self) -> str:
        return "humanitarian_fallback"

    @property
    def version(self) -> str:
        return "v2"

    @property
    def description(self) -> str:
        return "v2 Fallback verification prompt with streamlined JSON structure."

    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
    ) -> Dict[str, str]:
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)

        system_prompt = (
            "You are a conservative humanitarian verification system (v2). "
            "Evaluate strictly from supplied inputs. Return JSON only."
        )

        user_prompt = (
            "Fallback Humanitarian Verification (v2)\n\n"
            f"Claim: {aid_claim}\n"
            f"Evidence: {evidence_text}\n"
            f"Context: {context_text}\n\n"
            "Respond with JSON only:\n"
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        )

        return {"system": system_prompt, "user": user_prompt}


# ---------------------------------------------------------------------------
# Default Registry Initializer
# ---------------------------------------------------------------------------


def create_default_prompt_registry() -> PromptRegistry:
    """Create and populate the default prompt registry with built-in prompt versions."""
    registry = PromptRegistry()

    # Register V1 prompts (active by default)
    registry.register(HumanitarianPrimaryPromptV1(), set_active=True)
    registry.register(HumanitarianFallbackPromptV1(), set_active=True)

    # Register V2 prompts (available for version switching)
    registry.register(HumanitarianPrimaryPromptV2(), set_active=False)
    registry.register(HumanitarianFallbackPromptV2(), set_active=False)

    for language in SUPPORTED_HUMANITARIAN_LANGUAGES:
        if language == "en":
            continue
        registry.register(LocalizedHumanitarianPrompt("primary", language))
        registry.register(LocalizedHumanitarianPrompt("fallback", language))

    return registry


# Singleton default registry
default_prompt_registry: PromptRegistry = create_default_prompt_registry()


# ---------------------------------------------------------------------------
# Backward-Compatible HumanitarianPromptEngine
# ---------------------------------------------------------------------------


class HumanitarianPromptEngine:
    """Builds standardized humanitarian verification prompts from registered templates."""

    def __init__(self, registry: Optional[PromptRegistry] = None):
        self.registry = registry or default_prompt_registry

    def build_primary_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        version: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Dict[str, str]:
        prompt = self.registry.get(
            humanitarian_prompt_name("primary", language), version=version
        )
        return prompt.build_prompt(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
        )

    def build_fallback_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        version: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Dict[str, str]:
        prompt = self.registry.get(
            humanitarian_prompt_name("fallback", language), version=version
        )
        return prompt.build_prompt(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
        )

    def build_repair_prompt(
        self,
        original_user_prompt: str,
        malformed_content: str,
        error_message: str,
    ) -> Dict[str, str]:
        """Asks the model to reformat its own previous, unusable response.

        Used for a bounded retry when a response is malformed JSON or fails
        schema validation -- distinct from `build_fallback_prompt`, which
        re-asks the *original question* from scratch with a different
        prompt, rather than asking the model to fix what it already wrote.
        """
        system_prompt = (
            "Your previous response could not be parsed as valid JSON matching "
            "the requested schema. Return ONLY corrected, strictly valid JSON. "
            "Do not include prose, explanations, or markdown code fences."
        )
        user_prompt = (
            "Your previous response could not be used because: "
            f"{error_message}\n\n"
            "Previous response:\n"
            f"{malformed_content}\n\n"
            "Original request:\n"
            f"{original_user_prompt}\n\n"
            "Reply again with corrected JSON only, matching the schema from "
            "the original request exactly."
        )
        return {"system": system_prompt, "user": user_prompt}

    def _format_sphere_criteria(self) -> str:
        return format_sphere_criteria()

    def _format_evidence(self, supporting_evidence: List[str]) -> str:
        return format_evidence(supporting_evidence)

    def _format_context_factors(self, context_factors: Dict[str, Any]) -> str:
        return format_context_factors(context_factors)
