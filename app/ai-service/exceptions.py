from typing import Any, Optional


class AIServiceError(Exception):
    """Raised when a downstream AI/LLM call fails."""

    def __init__(self, message: str, code: str = "AI_SERVICE_ERROR", details: Optional[Any] = None):
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
