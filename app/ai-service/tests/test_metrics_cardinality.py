"""
Tests for bounded Prometheus metric label cardinality (issue #988).

`metrics.py` introduces two label-bounding helpers:
  - `bounded_endpoint_label` maps a raw request path (which may embed an
    unbounded id) to its registered FastAPI route *template*.
  - `bounded_task_type` maps a client-influenced task type string to a
    fixed allowlist, bucketing anything else into "other".

These tests assert both helpers only ever produce values from a bounded
set, that hitting the same route with many distinct ids produces exactly
one `endpoint` label value (not one per id), and that a burst of requests
against id-bearing routes keeps `/ai/metrics`'s response size within the
documented bound. See METRICS_CARDINALITY.md for the full per-metric audit
this fix is based on.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import metrics
from main import app
from services.rate_limiter import rate_limiter


@pytest.fixture(autouse=True)
def reset_limiter():
    """Reset rate limiter state, and disable enforcement so a burst of
    distinct-id requests in these tests isn't itself rate-limited."""
    rate_limiter.reset()
    with patch("config.settings.rate_limit_enabled", False):
        yield
    rate_limiter.reset()


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    """Keep monitor_requests' throttling out of these tests' way."""
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


@pytest.fixture
def client():
    return TestClient(app)


# --- bounded_endpoint_label ---


def test_bounded_endpoint_label_resolves_parameterized_route_to_its_template():
    random_id = str(uuid.uuid4())
    assert (
        metrics.bounded_endpoint_label(f"/v1/ai/status/{random_id}")
        == "/v1/ai/status/{task_id}"
    )


def test_bounded_endpoint_label_is_stable_across_many_distinct_ids():
    templates = {
        metrics.bounded_endpoint_label(f"/v1/ai/status/{uuid.uuid4()}")
        for _ in range(50)
    }
    # 50 distinct ids must all resolve to exactly one label value.
    assert templates == {"/v1/ai/status/{task_id}"}


def test_bounded_endpoint_label_covers_every_parameterized_route():
    cases = {
        f"/v1/ai/status/{uuid.uuid4()}": "/v1/ai/status/{task_id}",
        f"/v1/ai/jobs/{uuid.uuid4()}": "/v1/ai/jobs/{task_id}",
        f"/v1/ai/task/{uuid.uuid4()}/cancel": "/v1/ai/task/{task_id}/cancel",
        f"/v1/ai/task/{uuid.uuid4()}/expire": "/v1/ai/task/{task_id}/expire",
        f"/v1/ai/dead-letter/{uuid.uuid4()}": "/v1/ai/dead-letter/{item_id}",
        f"/v1/ai/dead-letter/{uuid.uuid4()}/replay": "/v1/ai/dead-letter/{item_id}/replay",
        f"/v1/ai/verification-artifacts/{uuid.uuid4()}/access": "/v1/ai/verification-artifacts/{artifact_id}/access",
    }
    for raw_path, expected_template in cases.items():
        assert metrics.bounded_endpoint_label(raw_path) == expected_template


def test_bounded_endpoint_label_passes_through_literal_routes_unchanged():
    assert metrics.bounded_endpoint_label("/v1/ai/inference") == "/v1/ai/inference"
    assert metrics.bounded_endpoint_label("/health") == "/health"


def test_bounded_endpoint_label_falls_back_to_unmatched_for_unknown_paths():
    assert (
        metrics.bounded_endpoint_label("/this/route/does/not/exist")
        == metrics.UNMATCHED_ENDPOINT_LABEL
    )
    # An id-shaped garbage path must not leak into the label either.
    assert (
        metrics.bounded_endpoint_label(f"/nonexistent/{uuid.uuid4()}")
        == metrics.UNMATCHED_ENDPOINT_LABEL
    )


def test_bounded_endpoint_label_falls_back_before_bind_app():
    with patch.object(metrics, "_APP", None), patch.object(
        metrics, "_ROUTE_LABEL_PATTERNS", None
    ):
        assert (
            metrics.bounded_endpoint_label("/v1/ai/inference")
            == metrics.UNMATCHED_ENDPOINT_LABEL
        )


# --- bounded_task_type ---


@pytest.mark.parametrize(
    "known_type",
    [
        "inference",
        "ocr",
        "image_analysis",
        "model_inference",
        "humanitarian_verification",
        "batch_processing",
        "proof_of_life",
    ],
)
def test_bounded_task_type_passes_through_known_values(known_type):
    assert metrics.bounded_task_type(known_type) == known_type


def test_bounded_task_type_buckets_arbitrary_client_input():
    arbitrary = f"whatever-the-client-decided-to-send-{uuid.uuid4()}"
    assert metrics.bounded_task_type(arbitrary) == metrics.OTHER_TASK_TYPE_LABEL


def test_bounded_task_type_output_is_always_from_a_bounded_set():
    candidates = [
        "inference",
        "ocr",
        "",
        "x" * 500,
        str(uuid.uuid4()),
        "🎉 not a real task type",
        "'; DROP TABLE tasks; --",
    ]
    bounded_values = {metrics.bounded_task_type(c) for c in candidates}
    allowed = metrics._KNOWN_TASK_TYPES | {metrics.OTHER_TASK_TYPE_LABEL}
    assert bounded_values <= allowed


# --- End-to-end: request labels stay bounded across many ids ---


def test_request_count_label_is_bounded_across_many_distinct_task_ids(client):
    status_codes_seen = set()
    for _ in range(30):
        response = client.get(f"/v1/ai/status/{uuid.uuid4()}")
        status_codes_seen.add(response.status_code)

    # All 30 distinct-id requests must have landed on exactly one endpoint
    # label value for this route, not one label per id.
    total = sum(
        metrics.REQUEST_COUNT.labels(
            method="GET",
            endpoint="/v1/ai/status/{task_id}",
            http_status=code,
        )._value.get()
        for code in status_codes_seen
    )
    assert total >= 30


def test_metrics_endpoint_never_exposes_a_raw_id_as_a_label_value(client):
    marker_id = f"cardinality-marker-{uuid.uuid4()}"
    client.get(f"/v1/ai/status/{marker_id}")

    body = client.get("/ai/metrics").text
    assert marker_id not in body


# --- Response size bound (documented in METRICS_CARDINALITY.md) ---

MAX_METRICS_RESPONSE_BYTES = 256 * 1024


def test_metrics_endpoint_response_size_is_bounded(client):
    id_bearing_routes = [
        "/v1/ai/status/{}",
        "/v1/ai/jobs/{}",
        "/v1/ai/dead-letter/{}",
    ]
    for _ in range(40):
        for route in id_bearing_routes:
            client.get(route.format(uuid.uuid4()))

    response = client.get("/ai/metrics")

    assert response.status_code == 200
    assert len(response.content) < MAX_METRICS_RESPONSE_BYTES, (
        "a burst of requests against id-bearing routes must not grow "
        "/ai/metrics beyond the documented bound; if this fails, an "
        "unbounded label has likely been reintroduced"
    )
