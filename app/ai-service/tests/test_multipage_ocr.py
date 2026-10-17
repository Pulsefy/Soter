import io
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from PIL import Image

import main
import tasks
from schemas.ocr import OCRData, OCRFieldResult
from services.ocr import FieldMatch, OCRResult, OCRService
from services.providers import ProviderRegistry, OCRField, OCRResponse, ModelProvider


@pytest.fixture()
def client():
    return TestClient(main.app, follow_redirects=False)


def _make_png_bytes(width: int = 100, height: int = 100, color: str = "white") -> bytes:
    img = Image.new("RGB", (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class MockSequenceOCRProvider(ModelProvider):
    """Provider that yields a sequential OCRResponse for each page processed."""

    def __init__(self, responses: list[OCRResponse]):
        self._responses = list(responses)
        self._call_count = 0

    @property
    def name(self):
        return "mock_seq"

    def ocr_extract(self, image, *, language_hint=None):
        if self._call_count < len(self._responses):
            res = self._responses[self._call_count]
            self._call_count += 1
            return res
        self._call_count += 1
        return OCRResponse(
            fields={}, raw_text="", processing_time_ms=10, provider="mock_seq"
        )


class TestMultiPageOCRExtraction:
    """Core service-level testing for multi-page processing and aggregation."""

    def test_two_page_document_split_fields_combined_with_attribution(self):
        ocr = OCRService()
        p1_resp = OCRResponse(
            fields={"name": OCRField(value="Alice Smith", confidence=0.95)},
            raw_text="Full Name: Alice Smith",
            processing_time_ms=50,
            provider="mock_seq",
        )
        p2_resp = OCRResponse(
            fields={
                "id_number": OCRField(value="ID998877", confidence=0.88),
                "date_of_birth": OCRField(value="1985-05-20", confidence=0.82),
            },
            raw_text="ID Number: ID998877\nDOB: 1985-05-20",
            processing_time_ms=60,
            provider="mock_seq",
        )
        mock_provider = MockSequenceOCRProvider([p1_resp, p2_resp])
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("mock_seq", mock_provider)]
        ocr.registry = mock_registry

        p1_img = Image.new("RGB", (100, 100), color="white")
        p2_img = Image.new("RGB", (100, 100), color="white")

        res = ocr.process_document_pages(
            [p1_img, p2_img],
            document_id="doc-support-letter-01",
        )

        assert res.document_id == "doc-support-letter-01"
        assert res.page_count == 2
        assert len(res.fields) == 3

        # Page-level attribution checks
        assert "name" in res.fields
        assert res.fields["name"].value == "Alice Smith"
        assert res.fields["name"].confidence == 0.95
        assert res.fields["name"].page == 1

        assert "id_number" in res.fields
        assert res.fields["id_number"].value == "ID998877"
        assert res.fields["id_number"].confidence == 0.88
        assert res.fields["id_number"].page == 2

        assert "date_of_birth" in res.fields
        assert res.fields["date_of_birth"].value == "1985-05-20"
        assert res.fields["date_of_birth"].confidence == 0.82
        assert res.fields["date_of_birth"].page == 2

        # Raw text contains content from both pages with headers
        assert "--- Page 1 ---" in res.raw_text
        assert "Alice Smith" in res.raw_text
        assert "--- Page 2 ---" in res.raw_text
        assert "ID998877" in res.raw_text

        # No conflicts
        assert res.conflicts is None
        assert res.conflict_reasons is None

    def test_duplicate_fields_matching_values_chooses_higher_confidence(self):
        ocr = OCRService()
        p1_resp = OCRResponse(
            fields={"name": OCRField(value="John Doe", confidence=0.75)},
            raw_text="Name: John Doe",
            processing_time_ms=40,
            provider="mock_seq",
        )
        p2_resp = OCRResponse(
            fields={"name": OCRField(value="John Doe", confidence=0.96)},
            raw_text="Name: John Doe",
            processing_time_ms=45,
            provider="mock_seq",
        )
        mock_provider = MockSequenceOCRProvider([p1_resp, p2_resp])
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("mock_seq", mock_provider)]
        ocr.registry = mock_registry

        p1_img = Image.new("RGB", (100, 100), color="white")
        p2_img = Image.new("RGB", (100, 100), color="white")

        res = ocr.process_document_pages([p1_img, p2_img], document_id="doc-dup-01")

        assert len(res.fields) == 1
        assert res.fields["name"].value == "John Doe"
        assert res.fields["name"].confidence == 0.96
        assert res.fields["name"].page == 2
        assert res.conflicts is None

    def test_conflicting_fields_across_pages_recorded_and_flagged(self):
        ocr = OCRService()
        p1_resp = OCRResponse(
            fields={"name": OCRField(value="John Doe", confidence=0.80)},
            raw_text="Name: John Doe",
            processing_time_ms=40,
            provider="mock_seq",
        )
        p2_resp = OCRResponse(
            fields={"name": OCRField(value="Jane Doe", confidence=0.92)},
            raw_text="Name: Jane Doe",
            processing_time_ms=45,
            provider="mock_seq",
        )
        mock_provider = MockSequenceOCRProvider([p1_resp, p2_resp])
        mock_registry = MagicMock(spec=ProviderRegistry)
        mock_registry.resolve_ocr.return_value = [("mock_seq", mock_provider)]
        ocr.registry = mock_registry

        p1_img = Image.new("RGB", (100, 100), color="white")
        p2_img = Image.new("RGB", (100, 100), color="white")

        res = ocr.process_document_pages(
            [p1_img, p2_img], document_id="doc-conflict-01"
        )

        assert res.fields["name"].value == "Jane Doe"
        assert res.fields["name"].confidence == 0.92
        assert res.fields["name"].page == 2

        assert res.conflicts is not None
        assert "name" in res.conflicts
        assert len(res.conflicts["name"]) == 2
        pages_in_conflict = {f.page: f.value for f in res.conflicts["name"]}
        assert pages_in_conflict[1] == "John Doe"
        assert pages_in_conflict[2] == "Jane Doe"

        assert res.conflict_reasons is not None
        assert any("Conflicting values detected" in r for r in res.conflict_reasons)


class TestMultiPageOCREndpoints:
    """HTTP endpoint testing for /v1/ai/ocr, /v1/ai/ocr/multi-page, and /ai/ocr/multi-page."""

    @pytest.fixture(autouse=True)
    def reset_limits(self):
        from api.v1.ocr import limiter as v1_limiter
        from api.routes import limiter as legacy_limiter

        v1_limiter.reset()
        legacy_limiter.reset()

    def test_v1_ocr_multipage_request_returns_combined_fields_with_attribution(
        self, client
    ):
        p1_png = _make_png_bytes(color="white")
        p2_png = _make_png_bytes(color="blue")

        fake_res = {
            "success": True,
            "data": {
                "document_id": "doc-claim-777",
                "page_count": 2,
                "fields": {
                    "name": {"value": "Maria Garcia", "confidence": 0.94, "page": 1},
                    "id_number": {"value": "MG123456", "confidence": 0.89, "page": 2},
                },
                "raw_text": "--- Page 1 ---\nName: Maria Garcia\n\n--- Page 2 ---\nID: MG123456",
                "processing_time_ms": 110,
                "confidence": 0.915,
                "confidence_band": "high",
                "needs_review": False,
                "pages": [
                    {
                        "page": 1,
                        "raw_text": "Name: Maria Garcia",
                        "fields": {
                            "name": {
                                "value": "Maria Garcia",
                                "confidence": 0.94,
                                "page": 1,
                            }
                        },
                        "confidence": 0.94,
                    },
                    {
                        "page": 2,
                        "raw_text": "ID: MG123456",
                        "fields": {
                            "id_number": {
                                "value": "MG123456",
                                "confidence": 0.89,
                                "page": 2,
                            }
                        },
                        "confidence": 0.89,
                    },
                ],
            },
            "confidence": 0.915,
            "confidence_band": "high",
            "needs_review": False,
            "review_reasons": None,
            "processing_time_ms": 110,
            "anchor_metadata": None,
        }

        with patch(
            "api.v1.ocr.run_multipage_ocr_from_bytes", return_value=fake_res
        ) as mock_multi:
            response = client.post(
                "/v1/ai/ocr",
                files=[
                    ("pages", ("page1.png", p1_png, "image/png")),
                    ("pages", ("page2.png", p2_png, "image/png")),
                ],
                data={"document_id": "doc-claim-777"},
            )

        assert response.status_code == 200
        body = response.json()
        assert "result" in body
        data = body["result"]
        assert data["document_id"] == "doc-claim-777"
        assert data["page_count"] == 2
        assert data["fields"]["name"]["value"] == "Maria Garcia"
        assert data["fields"]["name"]["page"] == 1
        assert data["fields"]["id_number"]["value"] == "MG123456"
        assert data["fields"]["id_number"]["page"] == 2
        assert len(data["pages"]) == 2

        mock_multi.assert_called_once()
        assert mock_multi.call_args[1]["document_id"] == "doc-claim-777"
        assert len(mock_multi.call_args[0][0]) == 2

    def test_dedicated_multipage_endpoint_returns_combined_response(self, client):
        p1_png = _make_png_bytes(color="white")
        p2_png = _make_png_bytes(color="green")

        fake_res = {
            "success": True,
            "data": {
                "document_id": "booklet-99",
                "page_count": 2,
                "fields": {
                    "name": {"value": "Samuel Doe", "confidence": 0.95, "page": 1},
                },
                "raw_text": "Page 1 and Page 2 text",
                "processing_time_ms": 90,
                "confidence": 0.95,
                "confidence_band": "high",
                "needs_review": False,
            },
            "confidence": 0.95,
            "confidence_band": "high",
            "needs_review": False,
            "review_reasons": None,
            "processing_time_ms": 90,
            "anchor_metadata": None,
        }

        with patch("api.v1.ocr.run_multipage_ocr_from_bytes", return_value=fake_res):
            response = client.post(
                "/v1/ai/ocr/multi-page",
                files=[
                    ("pages", ("p1.png", p1_png, "image/png")),
                    ("pages", ("p2.png", p2_png, "image/png")),
                ],
                data={"document_id": "booklet-99"},
            )

        assert response.status_code == 200
        data = response.json()["result"]
        assert data["document_id"] == "booklet-99"
        assert data["fields"]["name"]["page"] == 1

    def test_legacy_multipage_endpoint_returns_ocr_response(self, client):
        p1_png = _make_png_bytes()
        p2_png = _make_png_bytes()

        fake_result = MagicMock()
        fake_result.fields = {
            "name": FieldMatch(value="Legacy Test", confidence=0.90, page=1)
        }
        fake_result.raw_text = "Legacy Test"
        fake_result.processing_time_ms = 40
        fake_result.document_id = "leg-1"
        fake_result.page_count = 2
        fake_result.conflicts = None
        fake_result.pages = []

        with patch(
            "api.routes.ocr_service.process_document_pages", return_value=fake_result
        ):
            response = client.post(
                "/ai/ocr/multi-page",
                files=[
                    ("pages", ("p1.png", p1_png, "image/png")),
                    ("pages", ("p2.png", p2_png, "image/png")),
                ],
                data={"document_id": "leg-1"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["fields"]["name"]["value"] == "Legacy Test"
        assert data["data"]["fields"]["name"]["page"] == 1

    def test_conflict_detection_enforces_needs_review(self, client):
        p1_png = _make_png_bytes()
        p2_png = _make_png_bytes()

        fake_res = {
            "success": True,
            "data": {
                "document_id": "doc-conflict-test",
                "page_count": 2,
                "fields": {
                    "name": {"value": "Jane Doe", "confidence": 0.90, "page": 2},
                },
                "raw_text": "Page 1 vs Page 2",
                "processing_time_ms": 100,
                "confidence": 0.85,
                "confidence_band": "high",
                "needs_review": True,
                "conflicts": {
                    "name": [
                        {"value": "John Doe", "confidence": 0.80, "page": 1},
                        {"value": "Jane Doe", "confidence": 0.90, "page": 2},
                    ]
                },
            },
            "confidence": 0.85,
            "confidence_band": "high",
            "needs_review": True,
            "review_reasons": [
                "Conflicting values detected across pages for field 'name'"
            ],
            "processing_time_ms": 100,
            "anchor_metadata": None,
        }

        with patch("api.v1.ocr.run_multipage_ocr_from_bytes", return_value=fake_res):
            response = client.post(
                "/v1/ai/ocr/multi-page",
                files=[
                    ("pages", ("p1.png", p1_png, "image/png")),
                    ("pages", ("p2.png", p2_png, "image/png")),
                ],
            )

        assert response.status_code == 200
        res = response.json()
        assert res["result"]["needs_review"] is True
        assert "conflicts" in res["result"]
        assert "name" in res["result"]["conflicts"]
        assert len(res["result"]["conflicts"]["name"]) == 2
        assert "Conflicting values detected" in res["reasons"][0]


class TestValidationAndErrorHandling:
    """Validation checks for document_id, page formats, corrupted images, and empty uploads."""

    @pytest.fixture(autouse=True)
    def reset_limits(self):
        from api.v1.ocr import limiter

        limiter.reset()

    def test_invalid_document_id_returns_400(self, client):
        response = client.post(
            "/v1/ai/ocr",
            files=[
                ("pages", ("p1.png", _make_png_bytes(), "image/png")),
                ("pages", ("p2.png", _make_png_bytes(), "image/png")),
            ],
            data={"document_id": "invalid/document id with spaces!"},
        )
        assert response.status_code == 400
        assert "invalid_document_id" in response.json()["error"]["message"]

    def test_empty_page_image_returns_400(self, client):
        response = client.post(
            "/v1/ai/ocr",
            files=[
                ("pages", ("p1.png", _make_png_bytes(), "image/png")),
                ("pages", ("p2.png", b"", "image/png")),
            ],
        )
        assert response.status_code == 400
        assert "empty_image" in response.json()["error"]["message"]

    def test_corrupted_page_image_returns_400(self, client):
        response = client.post(
            "/v1/ai/ocr",
            files=[
                ("pages", ("p1.png", _make_png_bytes(), "image/png")),
                ("pages", ("p2.png", b"not-a-valid-image-bytes", "image/png")),
            ],
        )
        assert response.status_code == 400
        assert "invalid_image" in response.json()["error"]["message"]

    def test_unsupported_content_type_returns_400(self, client):
        response = client.post(
            "/v1/ai/ocr",
            files=[
                ("pages", ("p1.png", _make_png_bytes(), "image/png")),
                ("pages", ("p2.txt", b"plain text", "text/plain")),
            ],
        )
        assert response.status_code == 400
        assert "invalid_content_type" in response.json()["error"]["message"]

    def test_no_image_or_pages_returns_422(self, client):
        response = client.post("/v1/ai/ocr")
        assert response.status_code == 422


class TestAsyncMultiPageJobs:
    """Async queuing and worker execution for multi-page documents."""

    def test_queue_multipage_ocr_job(self, client, monkeypatch):
        created_tasks = []

        def fake_create_task(task_type, payload):
            created_tasks.append((task_type, payload))
            return "ocr-task-multi-123"

        monkeypatch.setattr(tasks, "create_task", fake_create_task)

        response = client.post(
            "/v1/ai/ocr/jobs",
            files=[
                ("pages", ("p1.png", _make_png_bytes(), "image/png")),
                ("pages", ("p2.png", _make_png_bytes(), "image/png")),
            ],
            data={"document_id": "doc-async-01"},
        )

        assert response.status_code == 202
        data = response.json()
        assert data["success"] is True
        assert data["task_id"] == "ocr-task-multi-123"
        assert len(created_tasks) == 1
        assert created_tasks[0][0] == "ocr"
        assert "pages_base64" in created_tasks[0][1]
        assert len(created_tasks[0][1]["pages_base64"]) == 2
        assert created_tasks[0][1]["document_id"] == "doc-async-01"

    def test_task_process_ocr_handles_pages_base64(self, monkeypatch):
        fake_result = {
            "success": True,
            "data": {
                "document_id": "doc-worker-01",
                "page_count": 2,
                "fields": {
                    "name": {"value": "Worker Test", "confidence": 0.9, "page": 1}
                },
            },
        }

        mock_run = MagicMock(return_value=fake_result)
        monkeypatch.setattr(tasks, "run_multipage_ocr_from_base64", mock_run)

        payload = {
            "pages_base64": ["b64-page1", "b64-page2"],
            "document_id": "doc-worker-01",
            "anchor_metadata": None,
            "language_hint": "eng",
            "document_type": "id_card",
        }

        outcome = tasks._process_ocr(payload)
        assert outcome["type"] == "ocr"
        assert outcome["status"] == "success"
        assert outcome["result"] == fake_result
        mock_run.assert_called_once()
        assert mock_run.call_args[0][0] == ["b64-page1", "b64-page2"]
        assert mock_run.call_args[1]["document_id"] == "doc-worker-01"
