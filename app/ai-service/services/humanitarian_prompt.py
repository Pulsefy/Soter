"""
Prompt registry with explicit versioning for humanitarian aid claim verification.

This module replaces inline prompt building with a versioned registry so every
result can be traced to the exact prompt (name + version) that produced it.

Key design
----------
* Prompts are addressed by **name** + **version** through ``PromptRegistry``.
* Each ``PromptVersion`` is immutable once registered.  Changing behaviour
  requires registering a new version rather than editing in place.
* The *active* version per prompt name is configurable via
  ``settings.humanitarian_prompt_active_versions``.
* ``registry.build_prompt(...)`` returns the prompt text *alongside* the
  ``name``/``version``/``content_hash`` metadata that the caller must record
  on the result envelope.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

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


PromptBuilder = Callable[..., Dict[str, str]]


@dataclass(frozen=True)
class PromptVersion:
    """An immutable prompt version registered in the registry.

    ``builder`` is a callable that accepts the dynamic inputs (aid_claim,
    supporting_evidence, context_factors) and returns the final
    ``{"system": ..., "user": ...}`` dict.  Keeping builder logic here –
    instead of pre-rendered template strings – preserves the ability to
    format structured inputs (lists, dicts) deterministically while still
    pinning the *semantics* via ``version`` and ``content_hash``.
    """

    name: str
    version: str
    description: str
    builder: PromptBuilder = field(repr=False)

    def content_hash(self, **kwargs: Any) -> str:
        """SHA256 hex digest of the rendered prompt.

        Used by tests to assert that the recorded version truly matches the
        prompt text that was sent to the model.
        """
        rendered = self.builder(**kwargs)
        payload = f"system={rendered['system']}\nuser={rendered['user']}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def build(self, **kwargs: Any) -> Dict[str, str]:
        """Render the prompt for the given inputs."""
        return self.builder(**kwargs)


class PromptRegistry:
    """Registry of named, versioned humanitarian verification prompts.

    Usage
    -----
    >>> registry = PromptRegistry()
    >>> pv = registry.resolve("humanitarian_primary", version="1.0")
    >>> prompt = pv.build(aid_claim=..., supporting_evidence=[...], context_factors={})
    """

    def __init__(self, active_versions: Optional[Dict[str, str]] = None) -> None:
        self._prompts: Dict[str, Dict[str, PromptVersion]] = {}
        self._active_versions: Dict[str, str] = dict(active_versions or {})
        self._register_defaults()

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, prompt_version: PromptVersion) -> None:
        """Register a prompt version.

        Raises ``ValueError`` if the same name + version is re-registered.
        This enforces the "no edit-in-place" contract – changing a prompt
        means registering a new version string.
        """
        versions = self._prompts.setdefault(prompt_version.name, {})
        if prompt_version.version in versions:
            raise ValueError(
                f"Prompt '{prompt_version.name}' version '{prompt_version.version}' "
                "is already registered. Publish a new version instead of mutating "
                "an existing one."
            )
        versions[prompt_version.version] = prompt_version

    def set_active_version(self, name: str, version: str) -> None:
        """Configure which version is currently active for a prompt name."""
        if name not in self._prompts or version not in self._prompts[name]:
            raise ValueError(
                f"Cannot set active version: prompt '{name}' version "
                f"'{version}' is not registered."
            )
        self._active_versions[name] = version

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def list_versions(self, name: str) -> List[str]:
        """Return all registered versions for *name*, sorted ascending."""
        if name not in self._prompts:
            return []
        return sorted(self._prompts[name].keys())

    def get_active_version(self, name: str) -> str:
        """Return the currently active version string for *name*.

        Falls back to the latest registered version when no explicit active
        version has been configured.
        """
        if name in self._active_versions:
            return self._active_versions[name]
        versions = self.list_versions(name)
        if not versions:
            raise ValueError(f"No versions registered for prompt '{name}'")
        return versions[-1]

    def resolve(self, name: str, version: Optional[str] = None) -> PromptVersion:
        """Resolve a :class:`PromptVersion` by name and (optional) version.

        When ``version`` is ``None`` the currently active version for
        *name* is used (see :meth:`get_active_version`).
        """
        if name not in self._prompts:
            raise ValueError(f"Unknown prompt name: '{name}'")
        resolved_version = version if version is not None else self.get_active_version(name)
        versions = self._prompts[name]
        if resolved_version not in versions:
            raise ValueError(
                f"Prompt '{name}' has no version '{resolved_version}'. "
                f"Available: {', '.join(versions)}"
            )
        return versions[resolved_version]

    def build_prompt(
        self,
        name: str,
        version: Optional[str] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Convenience: resolve + build + attach metadata.

        Returns a dict with keys ``system``, ``user``, ``prompt_name``,
        ``prompt_version``, ``prompt_content_hash``.  The caller records the
        metadata fields on the result envelope.
        """
        pv = self.resolve(name, version)
        rendered = pv.build(**kwargs)
        return {
            "system": rendered["system"],
            "user": rendered["user"],
            "prompt_name": pv.name,
            "prompt_version": pv.version,
            "prompt_content_hash": pv.content_hash(**kwargs),
        }

    # ------------------------------------------------------------------
    # Default prompt library (baseline versions)
    # ------------------------------------------------------------------

    def _register_defaults(self) -> None:
        """Register the built-in prompt versions.

        Each distinct semantic prompt is registered as a separate immutable
        version.  ``1.0`` is the original behaviour extracted from the
        pre-registry ``HumanitarianPromptEngine``.
        """
        self.register(
            PromptVersion(
                name="humanitarian_primary",
                version="1.0",
                description=(
                    "Primary Sphere-criteria grounded verification prompt. "
                    "Full system persona, Sphere Handbook sections, and JSON schema."
                ),
                builder=self._builder_primary_v1,
            )
        )
        self.register(
            PromptVersion(
                name="humanitarian_fallback",
                version="1.0",
                description=(
                    "Compact fallback prompt used when the primary prompt's "
                    "provider call fails.  Minimal instructions, strict JSON."
                ),
                builder=self._builder_fallback_v1,
            )
        )

    # ------------------------------------------------------------------
    # Prompt builders (one per registered version; do NOT mutate)
    # ------------------------------------------------------------------

    @staticmethod
    def _builder_primary_v1(
        *,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        **_: Any,
    ) -> Dict[str, str]:
        """Original primary prompt – pinned permanently as version 1.0."""
        criteria_text = _format_sphere_criteria()
        evidence_text = _format_evidence(supporting_evidence)
        context_text = _format_context_factors(context_factors)

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

    @staticmethod
    def _builder_fallback_v1(
        *,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        **_: Any,
    ) -> Dict[str, str]:
        """Original fallback prompt – pinned permanently as version 1.0."""
        evidence_text = _format_evidence(supporting_evidence)
        context_text = _format_context_factors(context_factors)

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
# Shared formatting helpers (pure; identical behaviour across versions)
# ---------------------------------------------------------------------------


def _format_sphere_criteria() -> str:
    lines: List[str] = []
    for section, items in SPHERE_HANDBOOK_CRITERIA.items():
        lines.append(f"- {section}:")
        for item in items:
            lines.append(f"  * {item}")
    return "\n".join(lines)


def _format_evidence(supporting_evidence: List[str]) -> str:
    if not supporting_evidence:
        return "- No supporting evidence provided"
    return "\n".join(f"- {entry}" for entry in supporting_evidence)


def _format_context_factors(context_factors: Dict[str, Any]) -> str:
    if not context_factors:
        return "- No context factors provided"
    lines: List[str] = []
    for key in sorted(context_factors.keys()):
        value = context_factors[key]
        lines.append(f"- {key}: {value}")
    return "\n".join(lines)
