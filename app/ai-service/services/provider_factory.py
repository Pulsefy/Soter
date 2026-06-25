from services.provider_reference import ReferenceLLMProvider, ReferenceOCRProvider
from services.provider_interface import LLMProvider, OCRProvider


def get_ocr_provider() -> OCRProvider:
    return ReferenceOCRProvider()


def get_llm_provider() -> LLMProvider:
    return ReferenceLLMProvider()
