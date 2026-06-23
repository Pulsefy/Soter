from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Optional

import httpx
import pytesseract
from PIL import Image

from config import settings
from services.provider_interface import LLMProvider, OCRProvider
from services.provider_types import FieldMatch, OCRResult
from services.preprocessing import ImagePreprocessor
from services.test_provider import TestProvider
from services.ocr import FieldDetector
from exceptions import AIServiceError
import metrics

logger = logging.getLogger(__name__)


class ReferenceOCRProvider(OCRProvider):
    name = "reference-ocr"

    def __init__(self):
        self.preprocessor = ImagePreprocessor()
        self.field_detector = FieldDetector()
        self.test_provider = TestProvider()

    def process_image(self, image: Image.Image) -> OCRResult:
        if settings.test_provider_mode:
            response = self.test_provider.get_response(
                "ocr", {"image_size": str(image.size)}
            )
            fields: Dict[str, FieldMatch] = {}
            for name, fdata in response.get("fields", {}).items():
                fields[name] = FieldMatch(
                    value=fdata["value"], confidence=fdata["confidence"]
                )
            return OCRResult(
                fields=fields,
                raw_text=response.get("raw_text", ""),
                processing_time_ms=response.get("processing_time_ms", 0),
            )

        start_time = time.time()
        preprocessed = self.preprocessor.preprocess(
            image, threshold_method="otsu", denoise=True
        )

        if preprocessed.size[0] == 0 or preprocessed.size[1] == 0:
            return OCRResult(fields={}, raw_text="", processing_time_ms=0)

        tesseract_data = self._run_tesseract(preprocessed)
        raw_text = tesseract_data.get("text", "")
        if isinstance(raw_text, list):
            raw_text = " ".join(str(t) for t in raw_text if t)
        raw_text = str(raw_text) if raw_text else ""

        fields = self.field_detector.detect_fields(raw_text)
        for field_name, field_match in fields.items():
            field_chars = self._extract_field_chars(tesseract_data, field_match.value)
            field_match.confidence = self.field_detector.aggregate_confidence(
                field_chars
            )

        latency = time.time() - start_time
        metrics.PIPELINE_STEP_LATENCY.labels(step_name="ocr").observe(latency)

        return OCRResult(
            fields=fields,
            raw_text=raw_text,
            processing_time_ms=int(latency * 1000),
        )

    def is_configured(self) -> bool:
        return settings.test_provider_mode or True

    def _run_tesseract(self, image: Image.Image) -> dict:
        config = "--psm 6 --oem 3"
        return pytesseract.image_to_data(
            image, config=config, output_type=pytesseract.Output.DICT
        )

    def _extract_field_chars(
        self, tesseract_data: dict, field_value: str
    ) -> list[float]:
        confidences = []
        texts = tesseract_data.get("text", [])
        confs = tesseract_data.get("conf", [])

        if isinstance(texts, str):
            texts = [texts]
        if isinstance(confs, (int, float)):
            confs = [confs]

        for i, text in enumerate(texts):
            if field_value.lower() in str(text).lower():
                if i < len(confs):
                    try:
                        conf = float(confs[i])
                        if conf > 0:
                            confidences.append(conf / 100.0)
                    except (ValueError, TypeError):
                        pass

        return confidences if confidences else [0.8]


class ReferenceLLMProvider(LLMProvider):
    name = "reference-llm"

    def __init__(self):
        self.test_provider = TestProvider()

    def send_chat_completion(
        self,
        provider: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if provider == "test" or settings.test_provider_mode:
            return self._call_test(model, system_prompt, user_prompt)
        if provider == "openai":
            return self._call_openai(model, system_prompt, user_prompt, timeout)
        if provider == "groq":
            return self._call_groq(model, system_prompt, user_prompt, timeout)
        raise ValueError(f"Unsupported provider: {provider}")

    def is_configured(self, provider: str) -> bool:
        if provider == "test":
            return settings.test_provider_mode
        if provider == "openai":
            return bool(settings.openai_api_key)
        if provider == "groq":
            return bool(settings.groq_api_key)
        return False

    def _call_openai(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if not settings.openai_api_key:
            raise RuntimeError("OpenAI API key is not configured")
        return self._call_chat_completion_api(
            base_url="https://api.openai.com/v1/chat/completions",
            api_key=settings.openai_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    def _call_groq(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if not settings.groq_api_key:
            raise RuntimeError("Groq API key is not configured")
        return self._call_chat_completion_api(
            base_url="https://api.groq.com/openai/v1/chat/completions",
            api_key=settings.groq_api_key,
            model=model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout=timeout,
        )

    def _call_chat_completion_api(
        self,
        base_url: str,
        api_key: str,
        model: str,
        system_prompt: str,
        user_prompt: str,
        timeout: Optional[float] = None,
    ) -> str:
        if settings.ai_deterministic_mode:
            logger.info("Deterministic AI mode enabled: returning stable response")
            return self._get_deterministic_response(model, system_prompt, user_prompt)

        payload = {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        req_timeout = timeout if timeout is not None else float(settings.llm_timeout_seconds)
        provider_name = "openai" if "openai" in base_url else "groq"

        try:
            with httpx.Client(timeout=req_timeout) as client:
                response = client.post(base_url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            logger.error("LLM provider %s request timed out after %s seconds", provider_name, req_timeout)
            raise AIServiceError(
                message=f"LLM request timed out after {req_timeout}s",
                code="AI_TIMEOUT",
                details={"provider": provider_name, "timeout_seconds": req_timeout},
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.error("LLM provider %s returned status %s: %s", provider_name, exc.response.status_code, exc.response.text)
            raise AIServiceError(
                message=f"LLM request failed with status {exc.response.status_code}",
                code="AI_PROVIDER_ERROR",
                details={"provider": provider_name, "status_code": exc.response.status_code},
            ) from exc
        except Exception as exc:
            logger.error("LLM provider %s connection or unexpected error: %s", provider_name, str(exc))
            raise AIServiceError(
                message=f"LLM connection error: {str(exc)}",
                code="AI_CONNECTION_ERROR",
                details={"provider": provider_name},
            ) from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected LLM response format: {data}") from exc

        if not content:
            raise RuntimeError("LLM returned empty content")

        return str(content)

    def _call_test(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        response = self.test_provider.get_response(
            endpoint="humanitarian",
            request_data={
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            },
        )
        return json.dumps(response, separators=(",", ":"), sort_keys=True)

    def _get_deterministic_response(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        stable_response = {
            "verdict": "credible",
            "confidence": 0.74,
            "summary": "Deterministic verification output for testing",
        }
        return json.dumps(stable_response, separators=(",", ":"), sort_keys=True)
