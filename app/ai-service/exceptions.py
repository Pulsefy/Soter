from typing import Any, List, Optional


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


class AllProvidersExhaustedError(AIServiceError):
    """Raised when every LLM provider in the fallback chain has been tried
    and none produced a successful response.

    Attributes:
        attempted_providers: Names of the providers that were tried (in
            attempt order).  Providers skipped due to an open circuit breaker
            are listed as well, prefixed with ``"(skipped) "``.
        per_provider_errors: Mapping of provider name → error description
            collected during the attempt loop.
    """

    def __init__(
        self,
        attempted_providers: List[str],
        per_provider_errors: Optional[List[str]] = None,
    ):
        self.attempted_providers = attempted_providers
        self.per_provider_errors = per_provider_errors or []
        detail_str = " | ".join(self.per_provider_errors) if self.per_provider_errors else "no providers available"
        message = (
            f"All LLM providers exhausted after trying "
            f"{attempted_providers}: {detail_str}"
        )
        super().__init__(
            message=message,
            code="ALL_PROVIDERS_EXHAUSTED",
            details={
                "attempted_providers": attempted_providers,
                "errors": self.per_provider_errors,
            },
        )


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
