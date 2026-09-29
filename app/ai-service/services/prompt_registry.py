"""Versioned, language-keyed prompt template registry for the humanitarian verifier.

Introduced for issue #1201 (multi-language support for humanitarian verification
prompts). Before this module, prompts lived as string literals inside
``HumanitarianPromptEngine`` and had no notion of language or version. Claims
submitted in any language were processed by an English-only prompt.

Design:

- Each ``(variant, language)`` pair maps to a ``PromptTemplate`` with an
  explicit ``version`` string. Bumping the wording of a prompt is a version
  bump, which lets regression fixtures pin to a version instead of a raw
  string.
- Only ``en`` is registered with full fixtures for now. ``es``, ``fr``, and
  ``ar`` are registered with translations of the same structural template —
  their fixtures are added in a follow-up so this PR stays reviewable.
- Unknown languages fall back to ``en`` and set ``language_fallback=True``
  in the returned metadata, so callers can tell the difference between
  "we support this language" and "we didn't and used English."
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class PromptTemplate:
    """A single versioned prompt variant for one (variant, language) pair."""

    variant: str  # "primary" | "fallback"
    language: str  # BCP-47-ish: "en", "es", "fr", "ar"
    version: str  # semver-ish: "1.0", "1.1"
    system_prompt: str
    user_prompt_template: str  # contains {criteria}, {claim}, {evidence}, {context}

    def render(
        self,
        *,
        criteria_text: str,
        aid_claim: str,
        evidence_text: str,
        context_text: str,
    ) -> Dict[str, str]:
        return {
            "system": self.system_prompt,
            "user": self.user_prompt_template.format(
                criteria=criteria_text,
                claim=aid_claim,
                evidence=evidence_text,
                context=context_text,
            ),
        }


_DEFAULT_LANGUAGE = "en"


# ─── English templates (version 1.0) ────────────────────────────────────────

_EN_PRIMARY = PromptTemplate(
    variant="primary",
    language="en",
    version="1.0",
    system_prompt=(
        "You are an objective humanitarian verification analyst. "
        "Evaluate aid claims only from provided evidence and context. "
        "Apply a Humanitarian Standard grounded in Sphere criteria. "
        "Do not infer facts that are not explicitly present. "
        "Return valid JSON only."
    ),
    user_prompt_template=(
        "Humanitarian Standard Verification Task\n\n"
        "Assess whether the aid claim is credible, partially credible, inconclusive, or not credible. "
        "Your analysis must map to Sphere Handbook criteria and explain uncertainty.\n\n"
        "Sphere Criteria:\n{criteria}\n\n"
        "Aid Claim:\n{claim}\n\n"
        "Supporting Evidence:\n{evidence}\n\n"
        "Context Factors (from backend):\n{context}\n\n"
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
    ),
)

_EN_FALLBACK = PromptTemplate(
    variant="fallback",
    language="en",
    version="1.0",
    system_prompt=(
        "You verify humanitarian aid claims conservatively. "
        "Use only supplied inputs. Return strict JSON only."
    ),
    user_prompt_template=(
        "Fallback Humanitarian Verification\n\n"
        "Claim: {claim}\n"
        "Evidence: {evidence}\n"
        "Context: {context}\n\n"
        "Respond with JSON only:\n"
        '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
        '"confidence":0.0,"summary":"",'
        '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
    ),
)


# ─── Spanish / French / Arabic placeholders (version 1.0) ───────────────────
# Structural translations of the English templates. Fixture coverage for these
# is added in a follow-up; the registry entries ship now so callers can pass
# `language="es"` etc. and get a prompt in that language rather than silently
# falling back to English.

_ES_PRIMARY = PromptTemplate(
    variant="primary",
    language="es",
    version="1.0",
    system_prompt=(
        "Eres un analista objetivo de verificacion humanitaria. "
        "Evalua las afirmaciones de ayuda unicamente a partir de la evidencia "
        "y el contexto proporcionados. Aplica el Estandar Humanitario basado "
        "en los criterios de Esfera. No infieras hechos que no esten "
        "explicitamente presentes. Devuelve unicamente JSON valido."
    ),
    user_prompt_template=(
        "Tarea de Verificacion del Estandar Humanitario\n\n"
        "Evalua si la afirmacion de ayuda es creible, parcialmente creible, "
        "no concluyente o no creible. Tu analisis debe mapear a los criterios "
        "del Manual Esfera y explicar la incertidumbre.\n\n"
        "Criterios de Esfera:\n{criteria}\n\n"
        "Afirmacion de Ayuda:\n{claim}\n\n"
        "Evidencia de Apoyo:\n{evidence}\n\n"
        "Factores de Contexto (del backend):\n{context}\n\n"
        "Devuelve el esquema JSON exactamente:\n"
        "{\n"
        '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
        '  "confidence": 0.0,\n'
        '  "summary": "resumen neutral corto",\n'
        '  "criteria_assessment": [\n'
        '    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}\n'
        "  ],\n"
        '  "risk_flags": ["string"],\n'
        '  "missing_information": ["string"],\n'
        '  "recommended_next_steps": ["string"]\n'
        "}"
    ),
)

_FR_PRIMARY = PromptTemplate(
    variant="primary",
    language="fr",
    version="1.0",
    system_prompt=(
        "Vous etes un analyste objectif de verification humanitaire. "
        "Evaluez les declarations d'aide uniquement a partir des preuves et "
        "du contexte fournis. Appliquez la Norme Humanitaire basee sur les "
        "criteres Sphere. N'inferencez pas de faits non explicitement presents. "
        "Retournez uniquement du JSON valide."
    ),
    user_prompt_template=(
        "Tache de Verification de la Norme Humanitaire\n\n"
        "Evaluez si la declaration d'aide est credible, partiellement credible, "
        "non concluante ou non credible. Votre analyse doit correspondre aux "
        "criteres du Manuel Sphere et expliquer l'incertitude.\n\n"
        "Criteres Sphere:\n{criteria}\n\n"
        "Declaration d'Aide:\n{claim}\n\n"
        "Preuves a l'Appui:\n{evidence}\n\n"
        "Facteurs de Contexte (du backend):\n{context}\n\n"
        "Retournez le schema JSON exactement:\n"
        "{\n"
        '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
        '  "confidence": 0.0,\n'
        '  "summary": "resume neutre court",\n'
        '  "criteria_assessment": [\n'
        '    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}\n'
        "  ],\n"
        '  "risk_flags": ["string"],\n'
        '  "missing_information": ["string"],\n'
        '  "recommended_next_steps": ["string"]\n'
        "}"
    ),
)

_AR_PRIMARY = PromptTemplate(
    variant="primary",
    language="ar",
    version="1.0",
    system_prompt=(
        "انت محلل موضوعي للتحقق من المساعدات الانسانية. "
        "قم بتقييم مزاعم المساعدات فقط من الادلة والسياق المقدمين. "
        "طبق المعيار الانساني المستند الى معايير كرة الارض. "
        "لا تستنتج حقائق غير موجودة بشكل صريح. "
        "ارجع فقط JSON صالح."
    ),
    user_prompt_template=(
        "مهمة التحقق من المعيار الانساني\n\n"
        "قم بتقييم ما اذا كان مزعم المساعدة موثوقا او موثوقا جزئيا او غير حاسم او غير موثوق. "
        "يجب ان يتوافق تحليلك مع معايير كتيب كرة الارض ويشرح عدم اليقين.\n\n"
        "معايير كرة الارض:\n{criteria}\n\n"
        "مزعم المساعدة:\n{claim}\n\n"
        "الادلة الداعمة:\n{evidence}\n\n"
        "عوامل السياق (من الواجهة الخلفية):\n{context}\n\n"
        "ارجع مخطط JSON بالضبط:\n"
        "{\n"
        '  "verdict": "credible|partially_credible|inconclusive|not_credible",\n'
        '  "confidence": 0.0,\n'
        '  "summary": "ملخص محايد قصير",\n'
        '  "criteria_assessment": [\n'
        '    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}\n'
        "  ],\n"
        '  "risk_flags": ["string"],\n'
        '  "missing_information": ["string"],\n'
        '  "recommended_next_steps": ["string"]\n'
        "}"
    ),
)


_REGISTRY: Dict[tuple, PromptTemplate] = {
    ("primary", "en"): _EN_PRIMARY,
    ("fallback", "en"): _EN_FALLBACK,
    ("primary", "es"): _ES_PRIMARY,
    ("primary", "fr"): _FR_PRIMARY,
    ("primary", "ar"): _AR_PRIMARY,
    # Fallbacks in non-English languages intentionally not registered yet —
    # the primary template is the load-bearing path; the fallback is a
    # safety-net used after a provider failure, and English is acceptable
    # there. Add language-keyed fallbacks in a follow-up if needed.
}


class PromptRegistry:
    """Lookup + registration for versioned prompt templates.

    The default instance is pre-populated with the templates above. Callers
    register additional templates with :meth:`register` — typically only
    tests, or a plugin that adds a language the base set doesn't cover.
    """

    def __init__(self) -> None:
        self._templates: Dict[tuple, PromptTemplate] = dict(_REGISTRY)

    def register(self, template: PromptTemplate) -> None:
        self._templates[(template.variant, template.language)] = template

    def get(
        self,
        variant: str,
        language: Optional[str],
    ) -> tuple:
        """Return ``(template, used_language, fallback)``.

        ``fallback`` is ``True`` when the requested language is not
        registered and English is used instead.
        """
        lang = (language or _DEFAULT_LANGUAGE).lower().strip()
        template = self._templates.get((variant, lang))
        if template is not None:
            return template, lang, False
        # Fall back to English for this variant.
        english = self._templates.get((variant, _DEFAULT_LANGUAGE))
        if english is None:  # pragma: no cover — English is always registered
            raise KeyError(f"No template for variant={variant!r} in any language")
        return english, _DEFAULT_LANGUAGE, True

    def supported_languages(self, variant: str = "primary") -> List[str]:
        return sorted(
            lang for (v, lang) in self._templates.keys() if v == variant
        )


default_registry = PromptRegistry()