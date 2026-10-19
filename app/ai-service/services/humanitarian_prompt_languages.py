"""
Language support for humanitarian verification prompts.

Provides language resolution (explicit caller hint first, then lightweight
detection from the claim text) and the localized prompt text for each
supported language. The JSON output schema keys and enum values stay in
English in every language so downstream parsing is unchanged; only the
instructions and the free-text fields are localized.
"""

import re
from typing import Dict, List, Optional

DEFAULT_LANGUAGE = "en"

#: Languages with a registered, versioned prompt set.
SUPPORTED_LANGUAGES = ("en", "es", "fr", "pt", "ar")

_LANGUAGE_NAMES: Dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "ar": "Arabic",
}

# Common function words that are distinctive per Latin-script language.
_STOPWORDS: Dict[str, frozenset] = {
    "en": frozenset(
        "the and was were with for from that this have has been are their to of in on at by".split()
    ),
    "es": frozenset(
        "el la los las y fue fueron con para por que una un del al se su sus en de como no ni aunque hay lo más entre esta varias solo".split()
    ),
    "fr": frozenset(
        "le la les et était étaient avec pour par que une un des du au se son ses dans de ont est on été mais il aucun aucune plusieurs sans ce qui pas sont".split()
    ),
    "pt": frozenset(
        "o os as e foi foram com para por que uma um dos das do da ao se seu suas em de não são mas também nem há pelo pela".split()
    ),
}

# Characters that strongly suggest one Latin-script language over the others.
_CHAR_HINTS = (
    ("ñ", "es", 2),
    ("¿", "es", 2),
    ("¡", "es", 2),
    ("ã", "pt", 2),
    ("õ", "pt", 2),
    ("œ", "fr", 2),
)

_ARABIC_RE = re.compile(r"[؀-ۿ]")
_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def normalize_language(language: Optional[str]) -> Optional[str]:
    """Reduce a hint such as 'pt-BR' or 'FR_ca' to a supported code, else None."""
    if not language or not isinstance(language, str):
        return None
    code = re.split(r"[-_]", language.strip().lower())[0]
    return code if code in SUPPORTED_LANGUAGES else None


def detect_language(text: str) -> str:
    """Best-effort language detection for claim text; defaults to English."""
    if not text:
        return DEFAULT_LANGUAGE
    letters = [c for c in text if c.isalpha()]
    if letters:
        arabic = len(_ARABIC_RE.findall(text))
        if arabic / len(letters) > 0.3:
            return "ar"
    words = [w.lower() for w in _WORD_RE.findall(text)]
    if not words:
        return DEFAULT_LANGUAGE
    scores = {
        lang: sum(1 for w in words if w in stop) for lang, stop in _STOPWORDS.items()
    }
    for char, lang, weight in _CHAR_HINTS:
        if char in text.lower():
            scores[lang] += weight
    best = max(scores, key=lambda lang: (scores[lang], lang == DEFAULT_LANGUAGE))
    return best if scores[best] > 0 else DEFAULT_LANGUAGE


def resolve_language(text: str, language_hint: Optional[str] = None) -> str:
    """An explicit, supported hint wins; otherwise detect from the claim text."""
    return normalize_language(language_hint) or detect_language(text)


def language_name(language: str) -> str:
    return _LANGUAGE_NAMES.get(language, _LANGUAGE_NAMES[DEFAULT_LANGUAGE])


def primary_prompt_name(language: str) -> str:
    return (
        "humanitarian_primary"
        if language == DEFAULT_LANGUAGE
        else f"humanitarian_primary_{language}"
    )


def fallback_prompt_name(language: str) -> str:
    return (
        "humanitarian_fallback"
        if language == DEFAULT_LANGUAGE
        else f"humanitarian_fallback_{language}"
    )


# ---------------------------------------------------------------------------
# Localized prompt text (non-English). English text lives in humanitarian_prompt.
# ---------------------------------------------------------------------------

LOCALIZED_TEXT: Dict[str, Dict[str, str]] = {
    "es": {
        "primary_system": (
            "Eres un analista objetivo de verificación humanitaria. "
            "Evalúa las solicitudes de ayuda únicamente a partir de la evidencia y el contexto proporcionados. "
            "Aplica un Estándar Humanitario basado en los criterios Sphere. "
            "No infieras hechos que no estén presentes de forma explícita. "
            "Devuelve únicamente JSON válido."
        ),
        "primary_intro": (
            "Tarea de verificación según el Estándar Humanitario\n\n"
            "Evalúa si la solicitud de ayuda es creíble, parcialmente creíble, no concluyente o no creíble. "
            "Tu análisis debe corresponder a los criterios del Manual Sphere y explicar la incertidumbre."
        ),
        "criteria": "Criterios Sphere",
        "claim": "Solicitud de ayuda",
        "evidence": "Evidencia de apoyo",
        "context": "Factores de contexto (del backend)",
        "schema_intro": "Esquema JSON de salida exacto",
        "lang_note": (
            "Escribe los campos de texto libre (summary, reason, risk_flags, missing_information, "
            "recommended_next_steps) en español. Conserva las claves JSON y los valores de verdict y status en inglés."
        ),
        "no_evidence": "- No se proporcionó evidencia de apoyo",
        "no_context": "- No se proporcionaron factores de contexto",
        "fallback_system": (
            "Verificas solicitudes de ayuda humanitaria de forma conservadora. "
            "Usa solo los datos suministrados. Devuelve únicamente JSON estricto."
        ),
        "fallback_title": "Verificación humanitaria de respaldo",
        "fallback_claim": "Solicitud",
        "fallback_evidence": "Evidencia",
        "fallback_context": "Contexto",
        "fallback_respond": "Responde solo con JSON",
        "water_supply_sanitation_hygiene": (
            "El acceso mínimo diario al agua es suficiente y equitativo.|"
            "Las instalaciones sanitarias son seguras, accesibles y culturalmente apropiadas.|"
            "El apoyo de higiene (jabón, higiene menstrual, lavado de manos) está disponible de forma constante."
        ),
        "food_security_nutrition": (
            "La asistencia alimentaria es adecuada en cantidad, calidad y valor nutricional.|"
            "La distribución es regular, imparcial y llega a los grupos vulnerables.|"
            "El apoyo nutricional atiende a niños, mujeres embarazadas y lactantes."
        ),
        "shelter_settlement": (
            "El refugio ofrece seguridad, privacidad, protección contra el clima y dignidad.|"
            "La planificación del asentamiento reduce el hacinamiento y los riesgos sanitarios.|"
            "Los materiales y el diseño del refugio se ajustan al contexto local y a las necesidades de inclusión."
        ),
        "health": (
            "Los servicios de salud esenciales son accesibles sin discriminación.|"
            "Existen medidas de prevención de enfermedades y preparación ante brotes.|"
            "Las vías de derivación y la continuidad de la atención funcionan."
        ),
        "protection_inclusion_accountability": (
            "La asistencia es imparcial y minimiza los riesgos de protección.|"
            "Las personas afectadas pueden dar su opinión y presentar quejas de forma segura.|"
            "Los datos y la toma de decisiones incluyen edad, género, discapacidad y contexto de riesgo."
        ),
    },
    "fr": {
        "primary_system": (
            "Vous êtes un analyste objectif de vérification humanitaire. "
            "Évaluez les demandes d'aide uniquement à partir des preuves et du contexte fournis. "
            "Appliquez une Norme humanitaire fondée sur les critères Sphère. "
            "Ne déduisez pas de faits qui ne sont pas explicitement présents. "
            "Retournez uniquement du JSON valide."
        ),
        "primary_intro": (
            "Tâche de vérification selon la Norme humanitaire\n\n"
            "Évaluez si la demande d'aide est crédible, partiellement crédible, non concluante ou non crédible. "
            "Votre analyse doit correspondre aux critères du Manuel Sphère et expliquer l'incertitude."
        ),
        "criteria": "Critères Sphère",
        "claim": "Demande d'aide",
        "evidence": "Preuves à l'appui",
        "context": "Facteurs de contexte (du backend)",
        "schema_intro": "Schéma JSON de sortie exact",
        "lang_note": (
            "Rédigez les champs de texte libre (summary, reason, risk_flags, missing_information, "
            "recommended_next_steps) en français. Conservez les clés JSON et les valeurs de verdict et status en anglais."
        ),
        "no_evidence": "- Aucune preuve à l'appui fournie",
        "no_context": "- Aucun facteur de contexte fourni",
        "fallback_system": (
            "Vous vérifiez les demandes d'aide humanitaire de façon prudente. "
            "Utilisez uniquement les données fournies. Retournez uniquement du JSON strict."
        ),
        "fallback_title": "Vérification humanitaire de repli",
        "fallback_claim": "Demande",
        "fallback_evidence": "Preuves",
        "fallback_context": "Contexte",
        "fallback_respond": "Répondez uniquement en JSON",
        "water_supply_sanitation_hygiene": (
            "L'accès minimal quotidien à l'eau est suffisant et équitable.|"
            "Les installations sanitaires sont sûres, accessibles et culturellement appropriées.|"
            "Le soutien en hygiène (savon, hygiène menstruelle, lavage des mains) est disponible de manière constante."
        ),
        "food_security_nutrition": (
            "L'aide alimentaire est adéquate en quantité, en qualité et en valeur nutritionnelle.|"
            "La distribution est régulière, impartiale et atteint les groupes vulnérables.|"
            "Le soutien nutritionnel cible les enfants, les femmes enceintes et allaitantes."
        ),
        "shelter_settlement": (
            "L'abri offre sécurité, intimité, protection contre les intempéries et dignité.|"
            "La planification du site réduit la surpopulation et les risques sanitaires.|"
            "Les matériaux et la conception de l'abri correspondent au contexte local et aux besoins d'inclusion."
        ),
        "health": (
            "Les services de santé essentiels sont accessibles sans discrimination.|"
            "La prévention des maladies et la préparation aux épidémies sont en place.|"
            "Les mécanismes de référencement et la continuité des soins fonctionnent."
        ),
        "protection_inclusion_accountability": (
            "L'assistance est impartiale et réduit au minimum les risques de protection.|"
            "Les personnes affectées peuvent donner leur avis et déposer des plaintes en toute sécurité.|"
            "Les données et la prise de décision tiennent compte de l'âge, du genre, du handicap et des risques."
        ),
    },
    "pt": {
        "primary_system": (
            "Você é um analista objetivo de verificação humanitária. "
            "Avalie os pedidos de ajuda apenas com base nas evidências e no contexto fornecidos. "
            "Aplique um Padrão Humanitário fundamentado nos critérios Sphere. "
            "Não infira fatos que não estejam explicitamente presentes. "
            "Retorne somente JSON válido."
        ),
        "primary_intro": (
            "Tarefa de verificação segundo o Padrão Humanitário\n\n"
            "Avalie se o pedido de ajuda é credível, parcialmente credível, inconclusivo ou não credível. "
            "Sua análise deve corresponder aos critérios do Manual Sphere e explicar a incerteza."
        ),
        "criteria": "Critérios Sphere",
        "claim": "Pedido de ajuda",
        "evidence": "Evidências de apoio",
        "context": "Fatores de contexto (do backend)",
        "schema_intro": "Esquema JSON de saída exato",
        "lang_note": (
            "Escreva os campos de texto livre (summary, reason, risk_flags, missing_information, "
            "recommended_next_steps) em português. Mantenha as chaves JSON e os valores de verdict e status em inglês."
        ),
        "no_evidence": "- Nenhuma evidência de apoio fornecida",
        "no_context": "- Nenhum fator de contexto fornecido",
        "fallback_system": (
            "Você verifica pedidos de ajuda humanitária de forma conservadora. "
            "Use apenas os dados fornecidos. Retorne somente JSON estrito."
        ),
        "fallback_title": "Verificação humanitária de contingência",
        "fallback_claim": "Pedido",
        "fallback_evidence": "Evidências",
        "fallback_context": "Contexto",
        "fallback_respond": "Responda somente com JSON",
        "water_supply_sanitation_hygiene": (
            "O acesso mínimo diário à água é suficiente e equitativo.|"
            "As instalações sanitárias são seguras, acessíveis e culturalmente apropriadas.|"
            "O apoio de higiene (sabão, higiene menstrual, lavagem das mãos) está disponível de forma consistente."
        ),
        "food_security_nutrition": (
            "A assistência alimentar é adequada em quantidade, qualidade e valor nutricional.|"
            "A distribuição é regular, imparcial e alcança os grupos vulneráveis.|"
            "O apoio nutricional atende crianças, gestantes e lactantes."
        ),
        "shelter_settlement": (
            "O abrigo oferece segurança, privacidade, proteção contra o clima e dignidade.|"
            "O planejamento do assentamento reduz a superlotação e os riscos à saúde.|"
            "Os materiais e o projeto do abrigo se alinham ao contexto local e às necessidades de inclusão."
        ),
        "health": (
            "Os serviços de saúde essenciais são acessíveis sem discriminação.|"
            "A prevenção de doenças e a preparação para surtos estão em vigor.|"
            "Os fluxos de encaminhamento e a continuidade do cuidado funcionam."
        ),
        "protection_inclusion_accountability": (
            "A assistência é imparcial e minimiza os riscos de proteção.|"
            "As pessoas afetadas podem dar feedback e apresentar queixas com segurança.|"
            "Os dados e a tomada de decisão incluem idade, gênero, deficiência e contexto de risco."
        ),
    },
    "ar": {
        "primary_system": (
            "أنت محلل موضوعي للتحقق الإنساني. "
            "قيّم طلبات المساعدة اعتماداً على الأدلة والسياق المقدَّمين فقط. "
            "طبّق معياراً إنسانياً قائماً على معايير سفير (Sphere). "
            "لا تستنتج وقائع غير مذكورة صراحةً. "
            "أعد JSON صالحاً فقط."
        ),
        "primary_intro": (
            "مهمة التحقق وفق المعيار الإنساني\n\n"
            "قيّم ما إذا كان طلب المساعدة موثوقاً أو موثوقاً جزئياً أو غير حاسم أو غير موثوق. "
            "يجب أن يستند تحليلك إلى معايير دليل سفير وأن يوضح مواطن عدم اليقين."
        ),
        "criteria": "معايير سفير",
        "claim": "طلب المساعدة",
        "evidence": "الأدلة الداعمة",
        "context": "عوامل السياق (من الخادم)",
        "schema_intro": "مخطط JSON المطلوب بدقة",
        "lang_note": (
            "اكتب الحقول النصية الحرة (summary, reason, risk_flags, missing_information, "
            "recommended_next_steps) باللغة العربية. أبقِ مفاتيح JSON وقيم verdict وstatus بالإنجليزية."
        ),
        "no_evidence": "- لم تُقدَّم أدلة داعمة",
        "no_context": "- لم تُقدَّم عوامل سياق",
        "fallback_system": (
            "تتحقق من طلبات المساعدة الإنسانية بحذر. "
            "استخدم المدخلات المقدَّمة فقط. أعد JSON صارماً فقط."
        ),
        "fallback_title": "تحقق إنساني احتياطي",
        "fallback_claim": "الطلب",
        "fallback_evidence": "الأدلة",
        "fallback_context": "السياق",
        "fallback_respond": "أجب بصيغة JSON فقط",
        "water_supply_sanitation_hygiene": (
            "الحصول اليومي الأدنى على المياه كافٍ وعادل.|"
            "مرافق الصرف الصحي آمنة وسهلة الوصول ومناسبة ثقافياً.|"
            "دعم النظافة (الصابون، النظافة الشهرية، غسل اليدين) متوفر باستمرار."
        ),
        "food_security_nutrition": (
            "المساعدة الغذائية كافية كمّاً ونوعاً وقيمة غذائية.|"
            "التوزيع منتظم ونزيه ويصل إلى الفئات الضعيفة.|"
            "الدعم الغذائي يراعي الأطفال والحوامل والمرضعات."
        ),
        "shelter_settlement": (
            "المأوى يوفر الأمان والخصوصية والحماية من الطقس والكرامة.|"
            "تخطيط الموقع يقلل الاكتظاظ والمخاطر الصحية.|"
            "مواد المأوى وتصميمه تتناسب مع السياق المحلي واحتياجات الإدماج."
        ),
        "health": (
            "الخدمات الصحية الأساسية متاحة دون تمييز.|"
            "الوقاية من الأمراض والاستعداد للفاشيات قائمان.|"
            "مسارات الإحالة واستمرارية الرعاية تعمل."
        ),
        "protection_inclusion_accountability": (
            "المساعدة نزيهة وتقلل مخاطر الحماية إلى الحد الأدنى.|"
            "يمكن للمتضررين تقديم ملاحظاتهم وشكاواهم بأمان.|"
            "تشمل البيانات واتخاذ القرار العمر والجنس والإعاقة وسياق المخاطر."
        ),
    },
}

_CRITERIA_SECTIONS = (
    "water_supply_sanitation_hygiene",
    "food_security_nutrition",
    "shelter_settlement",
    "health",
    "protection_inclusion_accountability",
)


def localized_criteria(language: str) -> Optional[Dict[str, List[str]]]:
    """Sphere criteria translated for `language`; None for English."""
    pack = LOCALIZED_TEXT.get(language)
    if not pack:
        return None
    return {section: pack[section].split("|") for section in _CRITERIA_SECTIONS}
