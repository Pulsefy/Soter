"""
Prompt Registry module for versioning and resolving AI verification prompts.

Enforces prompt immutability and runtime observable versioning so results
can be deterministically traced to the exact prompt template that produced them.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class VerificationPrompt(ABC):
    """Abstract base class for versioned verification prompts."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique identifier for the prompt type."""
        pass

    @property
    @abstractmethod
    def version(self) -> str:
        """Version string for this prompt template."""
        pass

    @property
    def description(self) -> Optional[str]:
        return None

    @abstractmethod
    def build_prompt(
        self,
        aid_claim: str,
        supporting_evidence: List[str],
        context_factors: Dict[str, Any],
        language: Optional[str] = None,
    ) -> Dict[str, str]:
        pass


class PromptRegistry:
    """Central registry for managing, versioning, and resolving prompts."""

    def __init__(self) -> None:
        self._prompts: Dict[str, Dict[str, VerificationPrompt]] = {}
        self._active_versions: Dict[str, str] = {}

    def register(self, prompt: VerificationPrompt, set_active: bool = False) -> None:
        name = prompt.name
        version = prompt.version
        if name not in self._prompts:
            self._prompts[name] = {}
        if version in self._prompts[name]:
            raise ValueError(
                f"Prompt '{name}' version '{version}' is already registered. "
                "Prompts are immutable; register a new version instead."
            )
        self._prompts[name][version] = prompt
        logger.debug("Registered prompt name='%s' version='%s'", name, version)
        if set_active or name not in self._active_versions:
            self._active_versions[name] = version
            logger.debug("Set active version for prompt '%s' to '%s'", name, version)

    def get(self, name: str, version: Optional[str] = None) -> VerificationPrompt:
        if name not in self._prompts:
            raise ValueError(
                f"Unknown prompt name: '{name}'. Registered prompts: {list(self._prompts.keys())}"
            )
        target_version = version or self._active_versions.get(name)
        if not target_version:
            raise ValueError(f"No active version configured for prompt '{name}'")
        if target_version not in self._prompts[name]:
            available = sorted(list(self._prompts[name].keys()))
            raise ValueError(
                f"Prompt '{name}' has no version '{target_version}'. "
                f"Available versions: {available}"
            )
        return self._prompts[name][target_version]

    def set_active_version(self, name: str, version: str) -> None:
        if name not in self._prompts:
            raise ValueError(f"Unknown prompt name: '{name}'")
        if version not in self._prompts[name]:
            available = sorted(list(self._prompts[name].keys()))
            raise ValueError(
                f"Cannot set active version to '{version}' for prompt '{name}'. "
                f"Available versions: {available}"
            )
        self._active_versions[name] = version
        logger.info("Active version for prompt '%s' updated to '%s'", name, version)

    def get_active_version(self, name: str) -> str:
        if name not in self._active_versions:
            raise ValueError(f"Unknown prompt name or no active version for: '{name}'")
        return self._active_versions[name]

    def list_prompts(self) -> Dict[str, List[str]]:
        return {
            name: sorted(list(versions.keys()))
            for name, versions in self._prompts.items()
        }

    def list_versions(self, name: str) -> List[str]:
        if name not in self._prompts:
            return []
        return sorted(list(self._prompts[name].keys()))

    def has(self, name: str, version: Optional[str] = None) -> bool:
        if name not in self._prompts:
            return False
        if version is not None:
            return version in self._prompts[name]
        return True
