"""
Tests for the multi-page OCR endpoint (POST /v1/ai/ocr/multi-page).

Acceptance criteria:
- A request can group multiple page images under one logical document id.
- The response combines extracted fields across pages, with page-level
  attribution (each field carries the page it was sourced from).
- Tests cover a two-page document with fields split across pages.
"""

import io
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import metrics
from services.ocr import OCRResult
from services.ocr import FieldMatch
from api.v1.ocr import limiter as ocr_limiter


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture(autouse=True)
def reset_rate_limits():
    ocr_limiter.reset()
    yield


@pytest.fixture()
def client():
    return TestClient(main.app, follow_redirects=False)


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _ocr_result(fields: dict) -> OCRResult:
    """Build a minimal OCRResult from a plain {name: (value, confidence)} dict."""
    return OCRResult(
        fields={
            name: FieldMatch(value=val, confidence=conf)
            for name, (val, conf) in fields.items()
        },
        raw_text=" ".join(f"{n}: {v}" for n, (v, _) in fields.items()),
        processing_time_ms=10,
        provider="test",
    )


# ---------------------------------------------------------------------------
# Happy path: two pages, fields split across pages
# ---------------------------------------------------------------------------


def test_multipage_ocr_combines_fields_from_two_pages(client):
    """Fields found only on page 1 and only on page 2 appear in the merged result."""
    page1_result = _ocr_result({"name": ("John Doe", 0.95)})
    page2_result = _ocr_result({"date_of_birth": ("15/03/1988", 0.90)})
    call_count = {"n": 0}

    def fake_process_image(self, image, language_hint=None):
        call_count["n"] += 1
        return page1_result if call_count["n"] == 1 else page2_result

    with patch(
        "services.ocr.OCRService.process_image", new=fake_process_image
    ):
        response = client.post(
            "/v1/ai/ocr/multi-page",
            data={"logical_document_id": "doc-001"},
            files=[
                ("pages", ("page1.png", _png_bytes(), "image/png")),
                ("pages", ("page2.png", _png_bytes(), "image/png")),
            ],
        )

    assert response.status_code == 200, response.text
    data = response.json()
    result = data["result"]

    assert result["logical_document_id"] == "doc-001"
    assert result["page_count"] == 2
    # Field from page 1
    assert "name" in result["fields"]
    assert result["fields"]["name"]["value"] == "John Doe"
    assert result["fields"]["name"]["page"] == 1
    # Field from page 2
    assert "date_of_birth" in result["fields"]
    assert result["fields"]["date_of_birth"]["value"] == "15/03/1988"
    assert result["fields"]["date_of_birth"]["page"] == 2


def test_multipage_ocr_retains_page_attribution_in_raw_text(client):
    """raw_text_by_page is keyed by 1-based page number."""
    page1_result = _ocr_result({"name": ("Jane Smith", 0.88)})
    page2_result = _ocr_result({"id_number": ("A1B2C3D4", 0.92)})
    call_count = {"n": 0}

    def fake_process_image(self, image, language_hint=None):
        call_count["n"] += 1
        return page1_result if call_count["n"] == 1 else page2_result

    with patch("services.ocr.OCRService.process_image", new=fake_process_image):
        response = client.post(
            "/v1/ai/ocr/multi-page",
            data={"logical_document_id": "doc-002"},
            files=[
                ("pages", ("p1.png", _png_bytes(), "image/png")),
                ("pages", ("p2.png", _png_bytes(), "image/png")),
            ],
        )

    assert response.status_code == 200
    result = response.json()["result"]
    assert "1" in result["raw_text_by_page"]
    assert "2" in result["raw_text_by_page"]
    assert "Jane Smith" in result["raw_text_by_page"]["1"]
    assert "A1B2C3D4" in result["raw_text_by_page"]["2"]


def test_multipage_ocr_highest_confidence_wins_for_duplicate_field(client):
    """When the same field appears on two pages the higher-confidence value is kept."""
    page1_result = _ocr_result({"name": ("Jon Doe", 0.70)})   # lower confidence
    page2_result = _ocr_result({"name": ("John Doe", 0.95)})  # higher confidence
    call_count = {"n": 0}

    def fake_process_image(self, image, language_hint=None):
        call_count["n"] += 1
        return page1_result if call_count["n"] == 1 else page2_result

    with patch("services.ocr.OCRService.process_image", new=fake_process_image):
        response = client.post(
            "/v1/ai/ocr/multi-page",
            data={"logical_document_id": "doc-003"},
            files=[
                ("pages", ("p1.png", _png_bytes(), "image/png")),
                ("pages", ("p2.png", _png_bytes(), "image/png")),
            ],
        )

    assert response.status_code == 200
    field = response.json()["result"]["fields"]["name"]
    assert field["value"] == "John Doe"
    assert field["confidence"] == 0.95
    # Attributed to page 2 since that page had higher confidence
    assert field["page"] == 2


def test_multipage_ocr_single_page_works(client):
    """A single page is a valid degenerate case."""
    page1_result = _ocr_result({"name": ("Alice", 0.80), "id_number": ("Z9Y8X7", 0.85)})

    def fake_process_image(self, image, language_hint=None):
        return page1_result

    with patch("services.ocr.OCRService.process_image", new=fake_process_image):
        response = client.post(
            "/v1/ai/ocr/multi-page",
            data={"logical_document_id": "single-doc"},
            files=[("pages", ("only.png", _png_bytes(), "image/png"))],
        )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["page_count"] == 1
    assert result["fields"]["name"]["page"] == 1
    assert result["fields"]["id_number"]["page"] == 1


# ---------------------------------------------------------------------------
# Validation errors
# ---------------------------------------------------------------------------


def test_multipage_ocr_rejects_empty_pages_list(client):
    response = client.post(
        "/v1/ai/ocr/multi-page",
        data={"logical_document_id": "doc-x"},
    )
    # FastAPI treats a missing required File field as a validation error (422)
    assert response.status_code in (400, 422)


def test_multipage_ocr_rejects_invalid_image(client):
    response = client.post(
        "/v1/ai/ocr/multi-page",
        data={"logical_document_id": "doc-bad"},
        files=[("pages", ("bad.png", b"not-an-image", "image/png"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_image"


def test_multipage_ocr_rejects_invalid_content_type(client):
    response = client.post(
        "/v1/ai/ocr/multi-page",
        data={"logical_document_id": "doc-type"},
        files=[("pages", ("file.txt", _png_bytes(), "text/plain"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_content_type"


def test_multipage_ocr_rejects_empty_logical_document_id(client):
    response = client.post(
        "/v1/ai/ocr/multi-page",
        data={"logical_document_id": "   "},
        files=[("pages", ("p.png", _png_bytes(), "image/png"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "missing_logical_document_id"


# ---------------------------------------------------------------------------
# Response envelope
# ---------------------------------------------------------------------------


def test_multipage_ocr_returns_confidence_in_envelope(client):
    """The ResultEnvelope confidence field is populated from the merged fields."""
    page_result = _ocr_result({"name": ("Test User", 0.80)})

    def fake_process_image(self, image, language_hint=None):
        return page_result

    with patch("services.ocr.OCRService.process_image", new=fake_process_image):
        response = client.post(
            "/v1/ai/ocr/multi-page",
            data={"logical_document_id": "conf-doc"},
            files=[("pages", ("p.png", _png_bytes(), "image/png"))],
        )

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] is not None
    assert 0.0 <= body["confidence"] <= 1.0
