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


class ProviderOutputError(AIServiceError):
    """Raised when a provider returns output that cannot be parsed or does not
    match the expected schema, even after bounded repair attempts.

    Distinct from transport-level failures (timeouts, HTTP errors) so callers
    can decide whether to retry with a different provider or surface a
    structured degraded-output result.

    Attributes:
        raw_content: The raw string returned by the provider.
        attempts: Number of parse/repair attempts made before giving up.
    """

    def __init__(
        self,
        message: str,
        raw_content: str = "",
        attempts: int = 1,
        details: Optional[Any] = None,
    ) -> None:
        super().__init__(
            message=message,
            code="PROVIDER_OUTPUT_ERROR",
            details=details,
        )
        self.raw_content = raw_content
        self.attempts = attempts

    def __str__(self) -> str:
        return f"[{self.code}] {self.message} (attempts={self.attempts})"


class ProviderRefusalError(AIServiceError):
    """Raised when a provider explicitly refuses to fulfil the request.

    Content-policy refusals, safety filter trips, and "I cannot help with
    that" prose responses are all surfaced through this class rather than
    appearing as opaque parse failures.

    Attributes:
        raw_content: The raw refusal text returned by the provider.
        refusal_reason: Short machine-readable reason extracted from the
            response, e.g. ``"content_policy"`` or ``"safety_filter"``.
    """

    def __init__(
        self,
        message: str,
        raw_content: str = "",
        refusal_reason: str = "unknown",
        details: Optional[Any] = None,
    ) -> None:
        super().__init__(
            message=message,
            code="PROVIDER_REFUSAL",
            details=details,
        )
        self.raw_content = raw_content
        self.refusal_reason = refusal_reason

    def __str__(self) -> str:
        return f"[{self.code}] {self.message} (reason={self.refusal_reason})"
