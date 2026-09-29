"""
Prompt templating for humanitarian aid claim verification.
"""

from typing import Any, Dict, List, Optional

from services.prompt_registry import VerificationPrompt, PromptRegistry

HUMANITARIAN_PROMPT_VERSION = "humanitarian-sphere-v1"
SUPPORTED_LANGUAGES = ("en", "es", "fr", "ar")


def detect_language(text: str) -> str:
    """Coarse script-based language detection. Conservative: defaults to en."""
    if not text:
        return "en"
    if any("\u0600" <= ch <= "\u06ff" or "\u0750" <= ch <= "\u077f" for ch in text):
        return "ar"
    if any(ch in "\u00bf\u00a1\u00f1\u00d1" for ch in text):
        return "es"
    if any(ch in "\u00e7\u00c7\u0153\u0152" for ch in text):
        return "fr"
    return "en"


_JSON_SCHEMA = (
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


_PRIMARY_TEMPLATES = {
    "en": {
        "system": (
            "You are an objective humanitarian verification analyst. "
            "Evaluate aid claims only from provided evidence and context. "
            "Apply a Humanitarian Standard grounded in Sphere criteria. "
            "Do not infer facts that are not explicitly present. "
            "Return valid JSON only."
        ),
        "user": (
            "Humanitarian Standard Verification Task\n\n"
            "Assess whether the aid claim is credible, partially credible, inconclusive, or not credible. "
            "Your analysis must map to Sphere Handbook criteria and explain uncertainty.\n\n"
            "Sphere Criteria:\n<<CRITERIA>>\n\n"
            "Aid Claim:\n<<CLAIM>>\n\n"
            "Supporting Evidence:\n<<EVIDENCE>>\n\n"
            "Context Factors (from backend):\n<<CONTEXT>>\n\n"
            "Output JSON schema exactly:\n" + _JSON_SCHEMA
        ),
    },
    "es": {
        "system": (
            "Eres un analista objetivo de verificacion humanitaria. "
            "Devuelve unicamente JSON valido."
        ),
        "user": (
            "Tarea de Verificacion del Estandar Humanitario\n\n"
            "Criterios de Esfera:\n<<CRITERIA>>\n\n"
            "Afirmacion de Ayuda:\n<<CLAIM>>\n\n"
            "Evidencia de Apoyo:\n<<EVIDENCE>>\n\n"
            "Factores de Contexto:\n<<CONTEXT>>\n\n"
            "Devuelve el esquema JSON exactamente:\n" + _JSON_SCHEMA
        ),
    },
    "fr": {
        "system": (
            "Vous etes un analyste objectif de verification humanitaire. "
            "Retournez uniquement du JSON valide."
        ),
        "user": (
            "Tache de Verification de la Norme Humanitaire\n\n"
            "Criteres Sphere:\n<<CRITERIA>>\n\n"
            "Declaration d Aide:\n<<CLAIM>>\n\n"
            "Preuves a l Appui:\n<<EVIDENCE>>\n\n"
            "Facteurs de Contexte:\n<<CONTEXT>>\n\n"
            "Retournez le schema JSON exactement:\n" + _JSON_SCHEMA
        ),
    },
    "ar": {
        "system": "\u0623\u0646\u062a \u0645\u062d\u0644\u0644 \u0645\u0648\u0636\u0648\u0639\u064a. \u0623\u0639\u062f JSON \u0641\u0642\u0637.",
        "user": (
            "\u0645\u0647\u0645\u0629 \u0627\u0644\u062a\u062d\u0642\u0642\n\n"
            "\u0645\u0639\u0627\u064a\u064a\u0631:\n<<CRITERIA>>\n\n"
            "\u0627\u0644\u0645\u0637\u0627\u0644\u0628\u0629:\n<<CLAIM>>\n\n"
            "\u0627\u0644\u0623\u062f\u0644\u0629:\n<<EVIDENCE>>\n\n"
            "\u0627\u0644\u0633\u064a\u0627\u0642:\n<<CONTEXT>>\n\n"
            "\u0623\u0639\u062f JSON:\n" + _JSON_SCHEMA
        ),
    },
}


_FALLBACK_TEMPLATES = {
    "en": {
        "system": "You verify humanitarian aid claims conservatively. Return strict JSON only.",
        "user": (
            "Fallback Humanitarian Verification\n\n"
            "Claim: <<CLAIM>>\nEvidence: <<EVIDENCE>>\nContext: <<CONTEXT>>\n\n"
            "Respond with JSON only:\n"
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        ),
    },
    "es": {
        "system": "Verifica de forma conservadora. Devuelve solo JSON.",
        "user": (
            "Verificacion de Respaldo\n\n"
            "Afirmacion: <<CLAIM>>\nEvidencia: <<EVIDENCE>>\nContexto: <<CONTEXT>>\n\n"
            "Responde solo con JSON:\n"
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        ),
    },
    "fr": {
        "system": "Verifiez de maniere conservatrice. Retournez uniquement du JSON.",
        "user": (
            "Verification de Secours\n\n"
            "Declaration: <<CLAIM>>\nPreuves: <<EVIDENCE>>\nContexte: <<CONTEXT>>\n\n"
            "Repondez uniquement en JSON:\n"
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        ),
    },
    "ar": {
        "system": "\u062a\u062d\u0642\u0642 \u0628\u062d\u0630\u0631. \u0623\u0639\u062f JSON \u0641\u0642\u0637.",
        "user": (
            "\u0627\u0644\u062a\u062d\u0642\u0642 \u0627\u0644\u0627\u062d\u062a\u064a\u0627\u0637\u064a\n\n"
            "\u0627\u0644\u0645\u0637\u0627\u0644\u0628\u0629: <<CLAIM>>\n"
            "\u0627\u0644\u0623\u062f\u0644\u0629: <<EVIDENCE>>\n"
            "\u0627\u0644\u0633\u064a\u0627\u0642: <<CONTEXT>>\n\n"
            "\u0623\u062c\u0628 \u0628\u0640 JSON:\n"
            '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
            '"confidence":0.0,"summary":"",'
            '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
        ),
    },
}


def _resolve_language(language):
    if not language:
        return "en"
    normalized = language.strip().lower().split("-")[0]
    return normalized if normalized in SUPPORTED_LANGUAGES else "en"


SPHERE_HANDBOOK_CRITERIA = {
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


def format_sphere_criteria(criteria=None):
    target = criteria or SPHERE_HANDBOOK_CRITERIA
    lines = []
    for section, items in target.items():
        lines.append(f"- {section}:")
        for item in items:
            lines.append(f"  * {item}")
    return "\n".join(lines)


def format_evidence(supporting_evidence):
    if not supporting_evidence:
        return "- No supporting evidence provided"
    return "\n".join(f"- {entry}" for entry in supporting_evidence)


def format_context_factors(context_factors):
    if not context_factors:
        return "- No context factors provided"
    lines = []
    for key in sorted(context_factors.keys()):
        lines.append(f"- {key}: {context_factors[key]}")
    return "\n".join(lines)


def _render(template_str, criteria_text, claim, evidence_text, context_text):
    return (
        template_str.replace("<<CRITERIA>>", criteria_text)
        .replace("<<CLAIM>>", claim)
        .replace("<<EVIDENCE>>", evidence_text)
        .replace("<<CONTEXT>>", context_text)
    )


class HumanitarianPrimaryPromptV1(VerificationPrompt):
    prompt_version = HUMANITARIAN_PROMPT_VERSION

    @property
    def name(self):
        return "humanitarian_primary"

    @property
    def version(self):
        return "v1"

    @property
    def description(self):
        return "Standard humanitarian primary verification prompt. Multi-language."

    def build_prompt(
        self, aid_claim, supporting_evidence, context_factors, language=None
    ):
        criteria_text = format_sphere_criteria()
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)
        lang = _resolve_language(language)
        template = _PRIMARY_TEMPLATES.get(lang, _PRIMARY_TEMPLATES["en"])
        return {
            "system": template["system"],
            "user": _render(
                template["user"], criteria_text, aid_claim, evidence_text, context_text
            ),
            "language": lang,
        }


class HumanitarianFallbackPromptV1(VerificationPrompt):
    @property
    def name(self):
        return "humanitarian_fallback"

    @property
    def version(self):
        return "v1"

    @property
    def description(self):
        return "Compact fallback verification prompt. Multi-language."

    def build_prompt(
        self, aid_claim, supporting_evidence, context_factors, language=None
    ):
        evidence_text = format_evidence(supporting_evidence)
        context_text = format_context_factors(context_factors)
        lang = _resolve_language(language)
        template = _FALLBACK_TEMPLATES.get(lang, _FALLBACK_TEMPLATES["en"])
        return {
            "system": template["system"],
            "user": _render(
                template["user"], "", aid_claim, evidence_text, context_text
            ),
            "language": lang,
        }


class HumanitarianPrimaryPromptV2(HumanitarianPrimaryPromptV1):
    @property
    def version(self):
        return "v2"


class HumanitarianFallbackPromptV2(HumanitarianFallbackPromptV1):
    @property
    def version(self):
        return "v2"


def create_default_prompt_registry():
    registry = PromptRegistry()
    registry.register(HumanitarianPrimaryPromptV1(), set_active=True)
    registry.register(HumanitarianFallbackPromptV1(), set_active=True)
    registry.register(HumanitarianPrimaryPromptV2(), set_active=False)
    registry.register(HumanitarianFallbackPromptV2(), set_active=False)
    return registry


default_prompt_registry = create_default_prompt_registry()


class HumanitarianPromptEngine:
    def __init__(self, registry=None):
        self.registry = registry or default_prompt_registry

    def build_primary_prompt(
        self,
        aid_claim,
        supporting_evidence,
        context_factors,
        version=None,
        language=None,
    ):
        prompt = self.registry.get("humanitarian_primary", version=version)
        effective_language = language or detect_language(aid_claim)
        rendered = prompt.build_prompt(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
            language=effective_language,
        )
        rendered.setdefault("language", effective_language)
        rendered.setdefault("language_fallback", "false")
        rendered.setdefault("prompt_version", prompt.version)
        rendered.setdefault("variant", "primary")
        return rendered

    def build_fallback_prompt(
        self,
        aid_claim,
        supporting_evidence,
        context_factors,
        version=None,
        language=None,
    ):
        prompt = self.registry.get("humanitarian_fallback", version=version)
        effective_language = language or detect_language(aid_claim)
        rendered = prompt.build_prompt(
            aid_claim=aid_claim,
            supporting_evidence=supporting_evidence,
            context_factors=context_factors,
            language=effective_language,
        )
        rendered.setdefault("language", effective_language)
        rendered.setdefault("language_fallback", "false")
        rendered.setdefault("prompt_version", prompt.version)
        rendered.setdefault("variant", "fallback")
        return rendered

    def build_repair_prompt(
        self, original_user_prompt, malformed_content, error_message
    ):
        system_prompt = (
            "Your previous response could not be parsed as valid JSON. "
            "Return ONLY corrected, strictly valid JSON."
        )
        user_prompt = (
            f"Previous error: {error_message}\n\n"
            f"Previous response:\n{malformed_content}\n\n"
            f"Original request:\n{original_user_prompt}\n\n"
            "Reply again with corrected JSON only."
        )
        return {"system": system_prompt, "user": user_prompt}

    detect_language = staticmethod(detect_language)

    def _format_sphere_criteria(self):
        return format_sphere_criteria()

    def _format_evidence(self, supporting_evidence):
        return format_evidence(supporting_evidence)

    def _format_context_factors(self, context_factors):
        return format_context_factors(context_factors)
