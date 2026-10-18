"""
Tests for Per-Key Rate Limiting on Inference and AI Endpoints (Issue #991).
"""

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import metrics
from config import settings
from main import app
from services.rate_limiter import (
    RateLimiterService,
    extract_api_key,
    parse_rate_limit,
    rate_limiter,
)


@pytest.fixture(autouse=True)
def reset_limiter():
    """Reset rate limiter state before and after each test."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()


@pytest.fixture(autouse=True)
def mock_tasks():
    """Mock tasks.create_task to avoid needing Redis/Celery broker in rate limit tests."""
    with patch("tasks.create_task", return_value="test-task-123"), patch(
        "metrics.check_system_resources", return_value=True
    ):
        yield


@pytest.fixture
def client():
    return TestClient(app)


def test_parse_rate_limit():
    assert parse_rate_limit("10/minute") == (10, 60)
    assert parse_rate_limit("5/second") == (5, 1)
    assert parse_rate_limit("100/hour") == (100, 3600)
    assert parse_rate_limit("1000/day") == (1000, 86400)
    assert parse_rate_limit("invalid") == (60, 60)
    assert parse_rate_limit("10/unknown") == (10, 60)


def test_extract_api_key():
    class DummyRequest:
        def __init__(self, headers=None, client_host="127.0.0.1"):
            self.headers = headers or {}
            self.client = type("Client", (), {"host": client_host})()

    # X-API-Key header
    req1 = DummyRequest(headers={"x-api-key": "key-123"})
    assert extract_api_key(req1) == "key-123"

    # Authorization Bearer header
    req2 = DummyRequest(headers={"authorization": "Bearer token-456"})
    assert extract_api_key(req2) == "token-456"

    # Anonymous fallback
    req3 = DummyRequest(headers={}, client_host="192.168.1.50")
    assert extract_api_key(req3) == "anon:192.168.1.50"


def test_per_key_isolation(client, monkeypatch):
    """Test that limits are enforced per API key and one caller does not starve another."""
    monkeypatch.setattr(settings, "test_provider_mode", True)
    rate_limiter.set_endpoint_override("/v1/ai/inference", "3/minute")

    headers_key_a = {"X-API-Key": "caller-alpha"}
    headers_key_b = {"X-API-Key": "caller-beta"}

    payload = {
        "type": "inference",
        "data": {"query": "test"},
    }

    # Caller Alpha makes 3 successful requests
    for i in range(3):
        res = client.post("/v1/ai/inference", json=payload, headers=headers_key_a)
        assert res.status_code == 200, f"Request {i+1} for Key A should succeed"
        assert res.headers.get("X-RateLimit-Limit") == "3"
        assert res.headers.get("X-RateLimit-Remaining") == str(2 - i)

    # Caller Alpha makes 4th request -> 429 Too Many Requests
    res_a_4 = client.post("/v1/ai/inference", json=payload, headers=headers_key_a)
    assert res_a_4.status_code == 429
    assert res_a_4.headers.get("Retry-After") is not None
    assert res_a_4.headers.get("X-RateLimit-Limit") == "3"
    assert res_a_4.headers.get("X-RateLimit-Remaining") == "0"
    assert res_a_4.headers.get("X-RateLimit-Reset") is not None

    envelope = res_a_4.json()
    assert "error" in envelope
    assert envelope["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    assert envelope["error"]["details"]["limit"] == 3
    assert envelope["error"]["details"]["endpoint"] == "/v1/ai/inference"

    # Caller Beta makes 1st request -> must succeed (isolation verified)
    res_b_1 = client.post("/v1/ai/inference", json=payload, headers=headers_key_b)
    assert res_b_1.status_code == 200
    assert res_b_1.headers.get("X-RateLimit-Limit") == "3"
    assert res_b_1.headers.get("X-RateLimit-Remaining") == "2"


def test_per_endpoint_overrides(client, monkeypatch):
    """Test that configured per-endpoint overrides are respected."""
    monkeypatch.setattr(settings, "test_provider_mode", True)
    monkeypatch.setattr(settings, "rate_limit_per_key_default", "10/minute")
    rate_limiter.set_endpoint_override("/v1/ai/inference", "2/minute")
    rate_limiter.set_endpoint_override("/v1/ai/anonymize", "5/minute")

    headers = {"X-API-Key": "caller-gamma"}

    # /v1/ai/inference has limit 2/minute
    res1 = client.post("/v1/ai/inference", json={"type": "inference"}, headers=headers)
    assert res1.status_code == 200
    res2 = client.post("/v1/ai/inference", json={"type": "inference"}, headers=headers)
    assert res2.status_code == 200
    res3 = client.post("/v1/ai/inference", json={"type": "inference"}, headers=headers)
    assert res3.status_code == 429
    assert res3.headers.get("X-RateLimit-Limit") == "2"

    # /v1/ai/anonymize has limit 5/minute and separate budget
    anon_payload = {"text": "John Doe in New York"}
    res_anon_1 = client.post("/v1/ai/anonymize", json=anon_payload, headers=headers)
    assert res_anon_1.status_code == 200
    assert res_anon_1.headers.get("X-RateLimit-Limit") == "5"


def test_interaction_with_load_shedder_composition(client, monkeypatch):
    """
    Test that per-key rate limiting composes with the load shedder without double-rejecting.
    - Rate-limited requests are blocked before reaching the load shedder.
    - Non-rate-limited requests under system overload are shed with 503.
    """
    monkeypatch.setattr(settings, "test_provider_mode", True)
    rate_limiter.set_endpoint_override("/v1/ai/inference", "2/minute")

    headers_bad = {"X-API-Key": "abusive-client"}
    headers_good = {"X-API-Key": "good-client"}
    payload = {"type": "inference"}

    # Abusive client consumes quota (2 requests)
    client.post("/v1/ai/inference", json=payload, headers=headers_bad)
    client.post("/v1/ai/inference", json=payload, headers=headers_bad)

    # Abusive client 3rd request -> rejected at 429 (never hits load shedder)
    res_bad = client.post("/v1/ai/inference", json=payload, headers=headers_bad)
    assert res_bad.status_code == 429
    assert res_bad.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    # Now simulate load shedding condition (memory overload)
    with patch("services.load_shedder.check_memory_pressure", return_value="memory"):
        # Abusive client still gets 429 (rate limiter stops it first)
        res_bad_again = client.post(
            "/v1/ai/inference", json=payload, headers=headers_bad
        )
        assert res_bad_again.status_code == 429

        # Good client (not rate limited) reaches load shedder and gets 503
        res_good = client.post("/v1/ai/inference", json=payload, headers=headers_good)
        assert res_good.status_code == 503
        assert res_good.json()["error"]["code"] == "SERVICE_OVERLOADED"
        assert res_good.headers.get("Retry-After") == "30"


def test_metrics_recorded_on_rate_limit_exceeded(client, monkeypatch):
    """Test that RATE_LIMIT_EXCEEDED_TOTAL is incremented with endpoint labels."""
    monkeypatch.setattr(settings, "test_provider_mode", True)
    rate_limiter.set_endpoint_override("/v1/ai/inference", "1/minute")

    headers = {"X-API-Key": "metric-test-key"}
    payload = {"type": "inference"}

    before_429_count = metrics.RATE_LIMIT_EXCEEDED_TOTAL.labels(
        endpoint="/v1/ai/inference", method="POST"
    )._value.get()

    # 1st request -> 200
    res1 = client.post("/v1/ai/inference", json=payload, headers=headers)
    assert res1.status_code == 200

    # 2nd request -> 429
    res2 = client.post("/v1/ai/inference", json=payload, headers=headers)
    assert res2.status_code == 429

    after_429_count = metrics.RATE_LIMIT_EXCEEDED_TOTAL.labels(
        endpoint="/v1/ai/inference", method="POST"
    )._value.get()

    assert after_429_count == before_429_count + 1


def test_never_throttle_paths_bypassed(client):
    """Test that health, docs, root, and metrics are never throttled."""
    rate_limiter.set_endpoint_override("/health", "1/minute")

    # Send multiple requests to /health
    for _ in range(5):
        res = client.get("/health")
        assert res.status_code == 200

    # Send multiple requests to /ai/metrics
    for _ in range(5):
        res = client.get("/ai/metrics")
        assert res.status_code == 200


def test_rate_limiting_disabled(client, monkeypatch):
    """Test that requests pass through without 429 when rate limiting is disabled."""
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    rate_limiter.set_endpoint_override("/v1/ai/inference", "1/minute")

    headers = {"X-API-Key": "disabled-test-key"}
    payload = {"type": "inference"}

    for _ in range(4):
        res = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res.status_code == 200


# ============================================================================
# Backward Compatibility Tests (Organization Rate Limiting)
# ============================================================================
# These tests verify that the new organization-level rate limiting does not
# interfere with existing per-key rate limiting behavior.


def test_backward_compat_unmapped_keys_unaffected(client, monkeypatch):
    """
    Test that unmapped API keys (not in organization mappings) are completely
    unaffected by organization-level limiting.

    This ensures backward compatibility: existing keys continue to work exactly
    as before, subject only to per-key limits.
    """
    from services.org_rate_limiter import org_rate_limiter, api_key_org_mapping

    monkeypatch.setattr(settings, "test_provider_mode", True)
    monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

    # Set up org limit (but don't map this key)
    org_rate_limiter.set_organization_tier("org-test", "2/minute")
    # key-unmapped is intentionally NOT mapped to any org

    # Set very generous per-key limit
    rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

    headers = {"X-API-Key": "key-unmapped"}
    payload = {"type": "inference", "data": {"query": "test"}}

    # Should be able to make many requests (org limiting doesn't apply)
    for i in range(10):
        res = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res.status_code == 200, f"Request {i+1} should succeed for unmapped key"

    # Clean up
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()


def test_backward_compat_per_key_still_enforced(client, monkeypatch):
    """
    Test that per-key rate limits are still enforced even when organization
    limits are enabled.

    This ensures the two levels of limiting work together correctly.
    """
    from services.org_rate_limiter import org_rate_limiter, api_key_org_mapping

    monkeypatch.setattr(settings, "test_provider_mode", True)
    monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

    # Map key to org with high limit
    api_key_org_mapping.set_mapping("key-test", "org-high-limit")
    org_rate_limiter.set_organization_tier("org-high-limit", "100/minute")

    # But set per-key limit low
    rate_limiter.set_endpoint_override("/v1/ai/inference", "2/minute")

    headers = {"X-API-Key": "key-test"}
    payload = {"type": "inference", "data": {"query": "test"}}

    # 2 requests succeed (per-key limit)
    for i in range(2):
        res = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res.status_code == 200

    # 3rd request fails due to per-key limit (not org limit)
    res = client.post("/v1/ai/inference", json=payload, headers=headers)
    assert res.status_code == 429

    # Verify it's per-key error, not org error
    error = res.json()
    assert error["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    assert "endpoint" in error["error"]["details"]
    assert "organization_id" not in error["error"]["details"]

    # Clean up
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()


def test_backward_compat_org_limiting_disabled_by_default(client, monkeypatch):
    """
    Test that organization limiting is disabled by default, preserving
    existing behavior.

    When ORG_RATE_LIMIT_ENABLED is false (or not set), organization limits
    should not be enforced.
    """
    from services.org_rate_limiter import org_rate_limiter, api_key_org_mapping

    monkeypatch.setattr(settings, "test_provider_mode", True)
    monkeypatch.setattr(settings, "org_rate_limit_enabled", False)

    # Configure org limits
    org_rate_limiter.set_organization_tier("org-test", "2/minute")
    api_key_org_mapping.set_mapping("key-test", "org-test")

    # Set generous per-key limit
    rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

    headers = {"X-API-Key": "key-test"}
    payload = {"type": "inference", "data": {"query": "test"}}

    # Should be able to make more than 2 requests (org limit is disabled)
    for i in range(5):
        res = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res.status_code == 200

    # Clean up
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()


def test_backward_compat_no_org_config_no_behavior_change(client, monkeypatch):
    """
    Test that when no organization configuration is present, behavior is
    identical to before the feature was added.

    This is the most common case in production: with empty org_rate_limit_tiers
    and api_key_to_org_mapping.
    """
    from services.org_rate_limiter import org_rate_limiter, api_key_org_mapping

    monkeypatch.setattr(settings, "test_provider_mode", True)
    monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

    # Don't configure any org limits or mappings (empty)
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()

    # Set per-key limit
    rate_limiter.set_endpoint_override("/v1/ai/inference", "3/minute")

    headers = {"X-API-Key": "any-key"}
    payload = {"type": "inference", "data": {"query": "test"}}

    # Per-key limits should work exactly as before
    for i in range(3):
        res = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res.status_code == 200

    # 4th request hits per-key limit
    res = client.post("/v1/ai/inference", json=payload, headers=headers)
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    # Clean up
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()
