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


class ProviderExhaustedError(AIServiceError):
    """Raised when every candidate provider has been tried and none succeeded.

    Distinct from a generic :class:`AIServiceError` so callers (and operators
    reading logs/traces) can tell a total fallback-exhaustion failure apart
    from a single transient provider error. ``details`` carries the ordered
    list of per-provider failures so the exhaustion is fully diagnosable.
    """

    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, code="AI_PROVIDERS_EXHAUSTED", details=details)


class MalformedProviderOutputError(AIServiceError):
    """Raised when a provider's response is not valid JSON, or does not match
    the expected schema, after every bounded repair attempt is exhausted.

    Distinct from a transport-level failure (timeout, connection error, 5xx):
    the provider answered successfully, but its content could not be used.
    Callers should not treat this the same as a network problem when deciding
    whether to penalize a provider's circuit breaker.
    """

    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, code="AI_MALFORMED_OUTPUT", details=details)


class ProviderRefusalError(AIServiceError):
    """Raised when a provider's response is detected as an explicit refusal
    to answer, rather than an attempt at the requested output (malformed or
    otherwise). Surfaced as its own outcome so callers can distinguish "the
    model declined" from "the model tried and failed to format its answer".
    """

    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message, code="AI_PROVIDER_REFUSAL", details=details)


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
