"""Offline verification wrapper used by the golden-set accuracy harness."""

import json
import os
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.providers import FixtureProvider
from services.humanitarian_prompt import HumanitarianPromptEngine

VERDICT_TO_LABEL = {
    "credible": "approve",
    "not_credible": "reject",
    "inconclusive": "ambiguous",
}


class DeterministicVerificationProvider:
    """Runs the verification flow against the fixture provider, no network needed."""

    def __init__(self) -> None:
        self._provider = FixtureProvider()
        self._prompt_engine = HumanitarianPromptEngine()

    def predict(
        self,
        aid_claim: str,
        supporting_evidence: Optional[List[str]] = None,
        context_factors: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Predict the label for a claim and return it with the raw verdict."""
        evidence = supporting_evidence or []
        context = context_factors or {}
        prompts = [
            self._prompt_engine.build_primary_prompt(
                aid_claim=aid_claim,
                supporting_evidence=evidence,
                context_factors=context,
            ),
            self._prompt_engine.build_fallback_prompt(
                aid_claim=aid_claim,
                supporting_evidence=evidence,
                context_factors=context,
            ),
        ]
        response = None
        for prompt in prompts:
            try:
                response = self._provider.llm_chat(
                    system_prompt=prompt["system"],
                    user_prompt=prompt["user"],
                )
                break
            except Exception:
                continue
        if response is None:
            raise RuntimeError("deterministic provider failed for all prompt variants")
        parsed = json.loads(response.content)
        verdict = parsed.get("verdict")
        if verdict not in VERDICT_TO_LABEL:
            raise ValueError(
                f"unexpected verdict from deterministic provider: {verdict}"
            )
        return {
            "verdict": verdict,
            "confidence": parsed.get("confidence"),
            "summary": parsed.get("summary"),
            "label": VERDICT_TO_LABEL[verdict],
        }
