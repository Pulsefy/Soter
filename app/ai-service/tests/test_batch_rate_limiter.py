"""
Tests for proportional rate limiting on batch endpoints (Batch OCR).
Covers:
- Large batch correctly consuming more rate-limit budget than a single-item request.
- Batch requests rejected with 429 when batch size exceeds remaining limit.
- Subsequent requests rejected after a large batch exhausts the budget.
- Organization-level proportional rate limiting for batch endpoints.
"""

import io
from unittest.mock import patch

import metrics
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
import tasks
from config import settings
from services.org_rate_limiter import api_key_org_mapping, org_rate_limiter
from services.rate_limiter import rate_limiter


def _png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def reset_limiters():
    """Reset rate limiter and org limiter states before and after each test."""
    rate_limiter.reset()
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()
    yield
    rate_limiter.reset()
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()


@pytest.fixture(autouse=True)
def mock_tasks():
    """Mock Celery task creation and healthy resources to avoid connection delays."""
    with patch("tasks.create_task", return_value="ocr-task-123"), patch.object(
        metrics, "check_system_resources", return_value=True
    ):
        yield


@pytest.fixture
def client():
    return TestClient(main.app, follow_redirects=False)


def test_rate_limiter_service_check_cost_unit():
    """Unit test for RateLimiterService check with cost parameter."""
    class DummyRequest:
        def __init__(self, path="/test", headers=None):
            self.url = type("URL", (), {"path": path})()
            self.method = "POST"
            self.headers = headers or {"x-api-key": "test-key"}
            self.client = type("Client", (), {"host": "127.0.0.1"})()

    rate_limiter.set_endpoint_override("/test", "5/minute")
    req = DummyRequest()

    # Cost 3 out of 5
    res1 = rate_limiter.check(req, cost=3)
    assert res1.allowed is True
    assert res1.remaining == 2
    assert res1.limit == 5

    # Cost 2 out of 2 remaining -> remaining 0
    res2 = rate_limiter.check(req, cost=2)
    assert res2.allowed is True
    assert res2.remaining == 0

    # Next cost 1 -> rejected
    res3 = rate_limiter.check(req, cost=1)
    assert res3.allowed is False
    assert res3.retry_after > 0


def test_single_document_batch_consumes_one_unit(client):
    """A batch request with a single document consumes 1 request budget."""
    rate_limiter.set_endpoint_override("/v1/ai/ocr/batch", "5/minute")
    headers = {"X-API-Key": "caller-batch-single"}

    files = [("files", ("doc-1.png", _png_bytes(), "image/png"))]
    res = client.post("/v1/ai/ocr/batch", files=files, headers=headers)
    assert res.status_code == 202
    assert res.headers.get("X-RateLimit-Limit") == "5"
    assert res.headers.get("X-RateLimit-Remaining") == "4"


def test_large_batch_consumes_proportional_budget(client):
    """
    Submitting a batch of 4 documents consumes 4 units against a 5/minute limit.
    Only 1 unit remains, so a subsequent 2-document batch is rejected with 429,
    exhausting the 5-unit limit when counted. Any subsequent request is throttled.
    """
    rate_limiter.set_endpoint_override("/v1/ai/ocr/batch", "5/minute")
    headers = {"X-API-Key": "caller-batch-proportional"}

    # Batch of 4 documents
    four_files = [
        ("files", (f"doc-{i}.png", _png_bytes(), "image/png"))
        for i in range(4)
    ]
    res1 = client.post("/v1/ai/ocr/batch", files=four_files, headers=headers)
    assert res1.status_code == 202
    assert res1.headers.get("X-RateLimit-Limit") == "5"
    assert res1.headers.get("X-RateLimit-Remaining") == "1"

    # Now attempt a batch of 2 documents -> rejected with 429 because cost exceeds available capacity
    two_files = [
        ("files", (f"doc-sub-{i}.png", _png_bytes(), "image/png"))
        for i in range(2)
    ]
    res2 = client.post("/v1/ai/ocr/batch", files=two_files, headers=headers)
    assert res2.status_code == 429
    assert res2.headers.get("Retry-After") is not None
    envelope = res2.json()
    assert envelope["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    # Any subsequent request is throttled since the limit is fully saturated
    single_file = [("files", ("doc-final.png", _png_bytes(), "image/png"))]
    res3 = client.post("/v1/ai/ocr/batch", files=single_file, headers=headers)
    assert res3.status_code == 429
    assert res3.headers.get("X-RateLimit-Remaining") == "0"


def test_oversized_batch_exceeding_total_limit_rejected(client):
    """A batch that contains more items than the total configured limit is rejected."""
    rate_limiter.set_endpoint_override("/v1/ai/ocr/batch", "3/minute")
    headers = {"X-API-Key": "caller-batch-oversized"}

    # Batch of 4 items with limit of 3
    four_files = [
        ("files", (f"doc-{i}.png", _png_bytes(), "image/png"))
        for i in range(4)
    ]
    res = client.post("/v1/ai/ocr/batch", files=four_files, headers=headers)
    assert res.status_code == 429
    envelope = res.json()
    assert envelope["error"]["code"] == "RATE_LIMIT_EXCEEDED"


def test_org_rate_limiter_proportional_batch_consumption(client):
    """Per-organization rate limits also consume budget proportionally to batch size."""
    # Org limit 5/minute across keys
    org_rate_limiter.set_organization_tier("org-batch-test", "5/minute")
    api_key_org_mapping.set_mapping("key-member-1", "org-batch-test")
    api_key_org_mapping.set_mapping("key-member-2", "org-batch-test")
    # Set per-key limit high so org limit is the constraint
    rate_limiter.set_endpoint_override("/v1/ai/ocr/batch", "100/minute")

    # Member 1 submits 3 documents
    three_files = [
        ("files", (f"doc-{i}.png", _png_bytes(), "image/png"))
        for i in range(3)
    ]
    res1 = client.post("/v1/ai/ocr/batch", files=three_files, headers={"X-API-Key": "key-member-1"})
    assert res1.status_code == 202

    # Member 2 submits 3 documents -> total would be 6 > org limit 5 -> 429
    res2 = client.post("/v1/ai/ocr/batch", files=three_files, headers={"X-API-Key": "key-member-2"})
    assert res2.status_code == 429
    envelope = res2.json()
    assert envelope["error"]["code"] == "ORGANIZATION_RATE_LIMIT_EXCEEDED"
    assert envelope["error"]["details"]["organization_id"] == "org-batch-test"
