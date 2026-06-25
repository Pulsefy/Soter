from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional
from PIL import Image

from services.provider_types import OCRResult


class OCRProvider(ABC):
    """Abstract provider contract for OCR execution."""

    name: str = "ocr"

    @abstractmethod
    def process_image(self, image: Image.Image) -> OCRResult:
        raise NotImplementedError

    @abstractmethod
    def is_configured(self) -> bool:
        raise NotImplementedError


class LLMProvider(ABC):
    """Abstract provider contract for LLM chat completion execution."""

    name: str = "llm"

    @abstractmethod
    def send_chat_completion(
        self,
        provider: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def is_configured(self, provider: str) -> bool:
        raise NotImplementedError
