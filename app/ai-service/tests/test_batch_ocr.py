import io
from unittest.mock import MagicMock, patch

import httpx
import metrics
import pytest
from PIL import Image

import main
import tasks
from config import settings


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture()
def client():
    from starlette.testclient import TestClient
    import api.v1.ocr as ocr_module
    ocr_module.limiter.reset()
    if hasattr(main.app.state, "limiter"):
        main.app.state.limiter.reset()
    c = TestClient(main.app, raise_server_exceptions=False)
    yield c


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _red_png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="red")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


BOUNDARY = "----SoterTestBoundary"


def _multipart_post(client, url, files=None, form_fields=None):
    """Build a raw multipart body to bypass the starlette TestClient
    multipart-stream bug (TypeError: sequence item 0: expected a bytes-like
    object, tuple found) by sending the encoded bytes directly via
    ``content=``.
    """
    body = b""

    if form_fields:
        for name, value in form_fields:
            body += f"--{BOUNDARY}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            body += value.encode() if isinstance(value, str) else value
            body += b"\r\n"

    if files:
        for name, filename, content, content_type in files:
            body += f"--{BOUNDARY}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
            body += f"Content-Type: {content_type}\r\n\r\n".encode()
            body += content
            body += b"\r\n"

    body += f"--{BOUNDARY}--\r\n".encode()

    return client.post(
        url,
        content=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
    )


class TestBatchOCREndpoint:
    """Tests for synchronous batch OCR processing."""

    def test_batch_ocr_success_with_all_documents(self, client):
        """Test batch processing with all successful documents."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.png", _red_png_bytes(), "image/png"),
            ],
            form_fields=[
                ("document_ids", "doc-001"),
                ("document_ids", "doc-002"),
            ],
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["total_documents"] == 2
        assert data["successful_documents"] == 2
        assert data["failed_documents"] == 0
        assert len(data["results"]) == 2
        assert data["results"][0]["document_id"] == "doc-001"
        assert data["results"][0]["success"] is True
        assert data["results"][1]["document_id"] == "doc-002"
        assert data["results"][1]["success"] is True
        assert "batch_id" in data
        assert data["total_processing_time_ms"] > 0

    def test_batch_ocr_mixed_success_and_failure(self, client):
        """Test batch processing with mixed success/failure documents."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.invalid", b"not-a-real-image", "image/png"),
                ("files", "doc3.png", _red_png_bytes(), "image/png"),
            ],
            form_fields=[
                ("document_ids", "doc-001"),
                ("document_ids", "doc-002"),
                ("document_ids", "doc-003"),
            ],
        )

        assert response.status_code == 400

    def test_batch_ocr_with_invalid_content_type(self, client):
        """Test batch processing rejects invalid content types."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "text/plain"),
            ],
        )

        assert response.status_code == 400
        data = response.json()
        assert "invalid_content_type" in str(data)

    def test_batch_ocr_with_empty_image(self, client):
        """Test batch processing rejects empty images."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", b"", "image/png"),
            ],
        )

        assert response.status_code == 400
        data = response.json()
        assert "empty_image" in str(data)

    def test_batch_ocr_no_documents(self, client):
        """Test batch endpoint rejects empty batch."""
        response = client.post("/v1/ai/ocr/batch")

        assert response.status_code == 400
        data = response.json()
        assert "no_documents" in str(data)

    def test_batch_ocr_auto_generates_document_ids(self, client):
        """Test batch endpoint auto-generates document IDs if not provided."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.png", _red_png_bytes(), "image/png"),
            ],
        )

        assert response.status_code == 200
        data = response.json()
        assert data["results"][0]["document_id"] == "doc-0"
        assert data["results"][1]["document_id"] == "doc-1"

    def test_batch_ocr_response_structure(self, client):
        """Test batch response has correct structure and fields."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
            ],
            form_fields=[("document_ids", "doc-001")],
        )

        assert response.status_code == 200
        data = response.json()

        assert "success" in data
        assert "batch_id" in data
        assert "total_documents" in data
        assert "successful_documents" in data
        assert "failed_documents" in data
        assert "results" in data
        assert "total_processing_time_ms" in data

        result = data["results"][0]
        assert "document_id" in result
        assert "success" in result
        assert "data" in result or result["success"] is False
        assert "processing_time_ms" in result


class TestBatchOCRJobEndpoint:
    """Tests for asynchronous batch OCR job processing."""

    def test_queue_batch_ocr_job_success(self, client, monkeypatch):
        """Test queuing batch OCR job returns accepted status."""
        captured = {}

        def fake_create_task(task_type, payload):
            captured["task_type"] = task_type
            captured["payload"] = payload
            return "batch-ocr-job-123"

        monkeypatch.setattr(tasks, "create_task", fake_create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.png", _red_png_bytes(), "image/png"),
            ],
            form_fields=[
                ("document_ids", "doc-001"),
                ("document_ids", "doc-002"),
            ],
        )

        assert response.status_code == 202
        data = response.json()
        assert data["success"] is True
        assert data["batch_job_id"] == "batch-ocr-job-123"
        assert data["document_count"] == 2
        assert data["status"] == "pending"
        assert data["status_url"] == "/v1/ai/jobs/batch-ocr-job-123"
        assert captured["task_type"] == "batch_ocr"
        assert len(captured["payload"]["documents"]) == 2

    def test_queue_batch_ocr_job_document_encoding(self, client, monkeypatch):
        """Test batch job request encodes documents correctly."""
        captured = {}

        def fake_create_task(task_type, payload):
            captured["payload"] = payload
            return "batch-ocr-job-123"

        monkeypatch.setattr(tasks, "create_task", fake_create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
            ],
            form_fields=[("document_ids", "doc-001")],
        )

        assert response.status_code == 202
        payload = captured["payload"]
        assert "documents" in payload
        assert len(payload["documents"]) == 1
        doc = payload["documents"][0]
        assert doc["document_id"] == "doc-001"
        assert "image_base64" in doc
        assert doc["content_type"] == "image/png"
        assert doc["filename"] == "doc1.png"

    def test_queue_batch_ocr_job_no_documents(self, client, monkeypatch):
        """Test batch job endpoint rejects empty batch."""
        create_task = MagicMock()
        monkeypatch.setattr(tasks, "create_task", create_task)

        response = client.post("/v1/ai/ocr/batch/jobs")

        assert response.status_code == 400
        create_task.assert_not_called()

    def test_queue_batch_ocr_job_invalid_content_type(self, client, monkeypatch):
        """Test batch job endpoint rejects invalid content types."""
        create_task = MagicMock()
        monkeypatch.setattr(tasks, "create_task", create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.txt", b"not an image", "text/plain"),
            ],
        )

        assert response.status_code == 400
        create_task.assert_not_called()

    def test_queue_batch_ocr_job_invalid_image(self, client, monkeypatch):
        """Test batch job endpoint validates image integrity."""
        create_task = MagicMock()
        monkeypatch.setattr(tasks, "create_task", create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.png", b"not-a-real-image", "image/png"),
            ],
        )

        assert response.status_code == 400
        create_task.assert_not_called()

    def test_queue_batch_ocr_job_empty_file(self, client, monkeypatch):
        """Test batch job endpoint rejects empty files."""
        create_task = MagicMock()
        monkeypatch.setattr(tasks, "create_task", create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.png", b"", "image/png"),
            ],
        )

        assert response.status_code == 400
        create_task.assert_not_called()

    def test_queue_batch_ocr_job_response_structure(self, client, monkeypatch):
        """Test batch job response has correct structure."""

        def fake_create_task(task_type, payload):
            return "batch-ocr-job-456"

        monkeypatch.setattr(tasks, "create_task", fake_create_task)

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch/jobs",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.png", _red_png_bytes(), "image/png"),
            ],
        )

        assert response.status_code == 202
        data = response.json()

        assert "success" in data
        assert "batch_job_id" in data
        assert "document_count" in data
        assert "status" in data
        assert "message" in data
        assert "status_url" in data

        assert data["success"] is True
        assert data["document_count"] == 2
        assert data["status"] == "pending"
        assert "batch-ocr-job-456" in data["status_url"]


class TestBatchOCRValidation:
    """Tests for batch OCR request validation and error handling."""

    def test_batch_ocr_mismatched_document_ids_count(self, client):
        """Test batch handling when document_ids count doesn't match files."""
        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=[
                ("files", "doc1.png", _png_bytes(), "image/png"),
                ("files", "doc2.png", _red_png_bytes(), "image/png"),
            ],
            form_fields=[
                ("document_ids", "doc-001"),
            ],
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_documents"] == 2
        assert data["results"][0]["document_id"] == "doc-001"
        assert data["results"][1]["document_id"] == "doc-1"

    def test_batch_ocr_with_supported_image_formats(self, client):
        """Test batch endpoint accepts all supported image formats."""
        for fmt, mime_type in [
            ("PNG", "image/png"),
            ("JPEG", "image/jpeg"),
            ("BMP", "image/bmp"),
        ]:
            img = Image.new("RGB", (32, 32), color="white")
            buf = io.BytesIO()
            img.save(buf, format=fmt)
            img_bytes = buf.getvalue()

            response = _multipart_post(
                client,
                "/v1/ai/ocr/batch",
                files=[
                    ("files", f"doc.{fmt.lower()}", img_bytes, mime_type),
                ],
            )

            assert response.status_code == 200
            assert response.json()["successful_documents"] == 1

    def test_batch_ocr_large_batch(self, client):
        """Test batch endpoint handles multiple documents efficiently."""
        files = []
        form_fields = []

        for i in range(5):
            files.append(("files", f"doc{i}.png", _png_bytes(), "image/png"))
            form_fields.append(("document_ids", f"doc-{i:03d}"))

        response = _multipart_post(
            client,
            "/v1/ai/ocr/batch",
            files=files,
            form_fields=form_fields,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_documents"] == 5
        assert data["successful_documents"] == 5
        assert len(data["results"]) == 5

        for i, result in enumerate(data["results"]):
            assert result["document_id"] == f"doc-{i:03d}"
            assert result["success"] is True