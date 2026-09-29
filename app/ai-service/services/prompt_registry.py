"""Versioned, language-keyed prompt template registry (issue #1201)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

_JSON_SCHEMA = """{
  "verdict": "credible|partially_credible|inconclusive|not_credible",
  "confidence": 0.0,
  "summary": "short neutral summary",
  "criteria_assessment": [
    {"criterion": "string", "status": "met|partially_met|not_met|unknown", "reason": "string"}
  ],
  "risk_flags": ["string"],
  "missing_information": ["string"],
  "recommended_next_steps": ["string"]
}"""


@dataclass(frozen=True)
class PromptTemplate:
    variant: str
    language: str
    version: str
    system_prompt: str
    user_prompt_template: str

    def render(
        self,
        *,
        criteria_text: str,
        aid_claim: str,
        evidence_text: str,
        context_text: str,
    ):
        # Manual substitution — avoids str.format's brace rules entirely, so
        # JSON blocks in the templates can contain literal { and } safely.
        user = (
            self.user_prompt_template.replace("<<CRITERIA>>", criteria_text)
            .replace("<<CLAIM>>", aid_claim)
            .replace("<<EVIDENCE>>", evidence_text)
            .replace("<<CONTEXT>>", context_text)
        )
        return {"system": self.system_prompt, "user": user}


_DEFAULT_LANGUAGE = "en"


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
        "Sphere Criteria:\n<<CRITERIA>>\n\n"
        "Aid Claim:\n<<CLAIM>>\n\n"
        "Supporting Evidence:\n<<EVIDENCE>>\n\n"
        "Context Factors (from backend):\n<<CONTEXT>>\n\n"
        "Output JSON schema exactly:\n" + _JSON_SCHEMA
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
        "Claim: <<CLAIM>>\n"
        "Evidence: <<EVIDENCE>>\n"
        "Context: <<CONTEXT>>\n\n"
        "Respond with JSON only:\n"
        '{"verdict":"credible|partially_credible|inconclusive|not_credible",'
        '"confidence":0.0,"summary":"",'
        '"risk_flags":[],"missing_information":[],"recommended_next_steps":[]}'
    ),
)

_ES_PRIMARY = PromptTemplate(
    variant="primary",
    language="es",
    version="1.0",
    system_prompt=(
        "Eres un analista objetivo de verificacion humanitaria. "
        "Evalua las afirmaciones de ayuda unicamente a partir de la evidencia y "
        "el contexto proporcionados. Devuelve unicamente JSON valido."
    ),
    user_prompt_template=(
        "Tarea de Verificacion del Estandar Humanitario\n\n"
        "Criterios de Esfera:\n<<CRITERIA>>\n\n"
        "Afirmacion de Ayuda:\n<<CLAIM>>\n\n"
        "Evidencia de Apoyo:\n<<EVIDENCE>>\n\n"
        "Factores de Contexto:\n<<CONTEXT>>\n\n"
        "Devuelve el esquema JSON exactamente:\n" + _JSON_SCHEMA
    ),
)

_FR_PRIMARY = PromptTemplate(
    variant="primary",
    language="fr",
    version="1.0",
    system_prompt=(
        "Vous etes un analyste objectif de verification humanitaire. "
        "Retournez uniquement du JSON valide."
    ),
    user_prompt_template=(
        "Tache de Verification de la Norme Humanitaire\n\n"
        "Criteres Sphere:\n<<CRITERIA>>\n\n"
        "Declaration d Aide:\n<<CLAIM>>\n\n"
        "Preuves a l Appui:\n<<EVIDENCE>>\n\n"
        "Facteurs de Contexte:\n<<CONTEXT>>\n\n"
        "Retournez le schema JSON exactement:\n" + _JSON_SCHEMA
    ),
)

_AR_PRIMARY = PromptTemplate(
    variant="primary",
    language="ar",
    version="1.0",
    system_prompt=(
        "\u0623\u0646\u062a \u0645\u062d\u0644\u0644 \u0645\u0648\u0636\u0648\u0639\u064a. \u0627\u0644\u0625\u062c\u0627\u0628\u0629 \u0628\u0640 JSON \u0641\u0642\u0637."
    ),
    user_prompt_template=(
        "\u0645\u0647\u0645\u0629 \u0627\u0644\u062a\u062d\u0642\u0642\n\n"
        "\u0645\u0639\u0627\u064a\u064a\u0631 \u0627\u0644\u0643\u0631\u0629:\n<<CRITERIA>>\n\n"
        "\u0645\u0632\u0639\u0645 \u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629:\n<<CLAIM>>\n\n"
        "\u0627\u0644\u0623\u062f\u0644\u0629:\n<<EVIDENCE>>\n\n"
        "\u0639\u0648\u0627\u0645\u0644 \u0627\u0644\u0633\u064a\u0627\u0642:\n<<CONTEXT>>\n\n"
        "\u0623\u0639\u062f \u0645\u062e\u0637\u0637 JSON:\n" + _JSON_SCHEMA
    ),
)


_REGISTRY: Dict[tuple, PromptTemplate] = {
    ("primary", "en"): _EN_PRIMARY,
    ("fallback", "en"): _EN_FALLBACK,
    ("primary", "es"): _ES_PRIMARY,
    ("primary", "fr"): _FR_PRIMARY,
    ("primary", "ar"): _AR_PRIMARY,
}


class PromptRegistry:
    def __init__(self) -> None:
        self._templates: Dict[tuple, PromptTemplate] = dict(_REGISTRY)

    def register(self, template: PromptTemplate) -> None:
        self._templates[(template.variant, template.language)] = template

    def get(self, variant: str, language: Optional[str]) -> tuple:
        lang = (language or _DEFAULT_LANGUAGE).lower().strip()
        t = self._templates.get((variant, lang))
        if t is not None:
            return t, lang, False
        en = self._templates.get((variant, _DEFAULT_LANGUAGE))
        if en is None:
            raise KeyError(f"No template for variant={variant!r}")
        return en, _DEFAULT_LANGUAGE, True

    def supported_languages(self, variant: str = "primary") -> List[str]:
        return sorted(l for (v, l) in self._templates if v == variant)


default_registry = PromptRegistry()
