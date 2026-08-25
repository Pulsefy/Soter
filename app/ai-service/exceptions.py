from typing import Any, Optional


class AIServiceError(Exception):
    """Raised when a downstream AI/LLM call fails."""

    def __init__(
        self,
        message: str,
        code: str = "AI_SERVICE_ERROR",
        details: Optional[Any] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class LoadShedError(Exception):
    """Raised when the service must reject work due to overload."""

    def __init__(
        self,
        reason: str,
        message: str,
        details: Optional[Any] = None,
    ):
        self.reason = reason
        self.message = message
        self.details = details or {}
        super().__init__(message)


class AllProvidersExhaustedError(Exception):
    """Raised when every provider in the fallback list has been tried and failed.

    This is a distinct, documented error so callers can differentiate between
    a single provider failure and a total loss of LLM availability.

    Attributes:
        providers_tried: Ordered list of provider names that were attempted.
        errors: Per-attempt error strings (same order as providers_tried, but
            may contain multiple entries per provider when prompt variants are
            retried).
    """

    def __init__(
        self,
        providers_tried: Optional[list] = None,
        errors: Optional[list] = None,
        message: Optional[str] = None,
    ):
        self.providers_tried: list = providers_tried or []
        self.errors: list = errors or []
        if message is None:
            message = (
                f"All LLM providers exhausted ({', '.join(self.providers_tried) or 'none'}). "
                "Errors: " + " | ".join(self.errors)
            )
        self.message = message
        super().__init__(message)
