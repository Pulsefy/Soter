from typing import Any, Optional


class AIServiceError(Exception):
    """Raised when a downstream AI/LLM call fails."""

    def __init__(self, message: str, code: str = "AI_SERVICE_ERROR", details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details
