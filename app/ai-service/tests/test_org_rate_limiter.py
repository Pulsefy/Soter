"""
Tests for Per-Organization Rate Limiting (Issue #1200).

Tests verify that:
1. Organization-level rate limits enforce a shared ceiling across all API keys
2. Multiple keys from the same organization count against the shared budget
3. Different organizations have independent rate limits
4. Organization limit exceeded returns distinct error from per-key limit exceeded
5. Requests are properly counted toward organization budgets
6. Rate limits can be configured per organization tier
"""

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import app
from services.org_rate_limiter import (
    ApiKeyOrgMapping,
    OrganizationRateLimiterService,
    api_key_org_mapping,
    org_rate_limiter,
)
from services.rate_limiter import rate_limiter


@pytest.fixture(autouse=True)
def reset_org_limiter():
    """Reset organization rate limiter state before and after each test."""
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()
    rate_limiter.reset()
    yield
    org_rate_limiter.reset()
    org_rate_limiter.clear_organization_tiers()
    api_key_org_mapping.clear_mapping()
    rate_limiter.reset()


@pytest.fixture(autouse=True)
def mock_tasks():
    """Mock tasks.create_task to avoid needing Redis/Celery broker in tests."""
    with patch("tasks.create_task", return_value="test-task-123"), patch(
        "metrics.check_system_resources", return_value=True
    ):
        yield


@pytest.fixture
def client():
    return TestClient(app)


# ============================================================================
# Tests for ApiKeyOrgMapping
# ============================================================================


class TestApiKeyOrgMapping:
    """Test the API key to organization mapping service."""

    def test_set_and_get_mapping(self):
        """Test basic mapping operations."""
        mapping = ApiKeyOrgMapping()

        mapping.set_mapping("key-001", "org-acme")
        assert mapping.get_org_id("key-001") == "org-acme"

        mapping.set_mapping("key-002", "org-acme")
        assert mapping.get_org_id("key-002") == "org-acme"

        mapping.set_mapping("key-003", "org-widgets")
        assert mapping.get_org_id("key-003") == "org-widgets"

    def test_unmapped_key_returns_none(self):
        """Test that unmapped keys return None."""
        mapping = ApiKeyOrgMapping()
        assert mapping.get_org_id("unknown-key") is None

    def test_batch_mapping(self):
        """Test setting multiple mappings at once."""
        mapping = ApiKeyOrgMapping()
        batch = {
            "key-001": "org-alpha",
            "key-002": "org-alpha",
            "key-003": "org-beta",
        }
        mapping.set_batch_mapping(batch)

        assert mapping.get_org_id("key-001") == "org-alpha"
        assert mapping.get_org_id("key-002") == "org-alpha"
        assert mapping.get_org_id("key-003") == "org-beta"

    def test_clear_mapping(self):
        """Test clearing all mappings."""
        mapping = ApiKeyOrgMapping()
        mapping.set_mapping("key-001", "org-acme")
        assert mapping.get_org_id("key-001") == "org-acme"

        mapping.clear_mapping()
        assert mapping.get_org_id("key-001") is None


# ============================================================================
# Tests for OrganizationRateLimiterService
# ============================================================================


class TestOrganizationRateLimiterService:
    """Test the organization-level rate limiting service."""

    def test_unmapped_api_key_passes_check(self):
        """Test that unmapped API keys bypass organization limiting."""
        org_limiter = OrganizationRateLimiterService(api_key_org_mapping)
        org_limiter.set_organization_tier("org-001", "5/minute")

        # Key not mapped to any org should return None (no org-level limit)
        result = org_limiter.check("unmapped-key")
        assert result is None

    def test_org_without_tier_passes_check(self):
        """Test that organizations without configured tier bypass limiting."""
        org_limiter = OrganizationRateLimiterService(api_key_org_mapping)
        mapping = ApiKeyOrgMapping()

        org_limiter_with_mapping = OrganizationRateLimiterService(mapping)
        mapping.set_mapping("key-001", "org-no-tier")

        # Org has no tier configured
        result = org_limiter_with_mapping.check("key-001")
        assert result is None

    def test_single_key_respects_org_limit(self):
        """Test that a single API key from an org respects org-level limit."""
        mapping = ApiKeyOrgMapping()
        org_limiter = OrganizationRateLimiterService(mapping)

        mapping.set_mapping("key-001", "org-test")
        org_limiter.set_organization_tier("org-test", "3/minute")

        # Org tier allows 3 requests per minute
        result1 = org_limiter.check("key-001")
        assert result1.allowed is True
        assert result1.limit == 3
        assert result1.remaining == 2

        result2 = org_limiter.check("key-001")
        assert result2.allowed is True
        assert result2.remaining == 1

        result3 = org_limiter.check("key-001")
        assert result3.allowed is True
        assert result3.remaining == 0

        # 4th request exceeds org limit
        result4 = org_limiter.check("key-001")
        assert result4.allowed is False
        assert result4.limit == 3
        assert result4.remaining == 0

    def test_multiple_keys_same_org_share_budget(self):
        """Test that multiple keys from same org share a budget (the key requirement)."""
        mapping = ApiKeyOrgMapping()
        org_limiter = OrganizationRateLimiterService(mapping)

        # Two keys from org-acme
        mapping.set_mapping("key-acme-001", "org-acme")
        mapping.set_mapping("key-acme-002", "org-acme")
        org_limiter.set_organization_tier("org-acme", "5/minute")

        # Key 1 uses 3 of 5 requests
        for _ in range(3):
            result = org_limiter.check("key-acme-001")
            assert result.allowed is True

        # Key 2 uses 2 of remaining 2 requests
        for _ in range(2):
            result = org_limiter.check("key-acme-002")
            assert result.allowed is True

        # Next request from either key should be rejected
        result_key1 = org_limiter.check("key-acme-001")
        assert result_key1.allowed is False
        assert result_key1.organization_id == "org-acme"

        result_key2 = org_limiter.check("key-acme-002")
        assert result_key2.allowed is False
        assert result_key2.organization_id == "org-acme"

    def test_different_orgs_have_independent_limits(self):
        """Test that different organizations have independent rate limits."""
        mapping = ApiKeyOrgMapping()
        org_limiter = OrganizationRateLimiterService(mapping)

        # Set up two organizations with different limits
        mapping.set_mapping("key-org-a", "org-alpha")
        mapping.set_mapping("key-org-b", "org-beta")
        org_limiter.set_organization_tier("org-alpha", "2/minute")
        org_limiter.set_organization_tier("org-beta", "5/minute")

        # Org Alpha: exhaust 2-request limit
        for _ in range(2):
            result = org_limiter.check("key-org-a")
            assert result.allowed is True

        result_a_3 = org_limiter.check("key-org-a")
        assert result_a_3.allowed is False

        # Org Beta: can still make requests (has 5/minute)
        for _ in range(5):
            result = org_limiter.check("key-org-b")
            assert result.allowed is True

        result_b_6 = org_limiter.check("key-org-b")
        assert result_b_6.allowed is False

    def test_result_contains_organization_id(self):
        """Test that results include the organization ID."""
        mapping = ApiKeyOrgMapping()
        org_limiter = OrganizationRateLimiterService(mapping)

        mapping.set_mapping("key-test", "org-example")
        org_limiter.set_organization_tier("org-example", "1/minute")

        result = org_limiter.check("key-test")
        assert result.organization_id == "org-example"
        assert result.limit_type == "organization"

    def test_set_organization_tier(self):
        """Test setting and retrieving organization tiers."""
        org_limiter = OrganizationRateLimiterService(api_key_org_mapping)

        org_limiter.set_organization_tier("org-001", "100/minute")
        tier = org_limiter.get_organization_tier("org-001")
        assert tier == (100, 60)

        org_limiter.set_organization_tier("org-002", "50/hour")
        tier = org_limiter.get_organization_tier("org-002")
        assert tier == (50, 3600)

    def test_reset_clears_records(self):
        """Test that reset clears all in-memory records."""
        mapping = ApiKeyOrgMapping()
        org_limiter = OrganizationRateLimiterService(mapping)

        mapping.set_mapping("key-001", "org-test")
        org_limiter.set_organization_tier("org-test", "3/minute")

        # Make some requests
        org_limiter.check("key-001")
        org_limiter.check("key-001")

        # Reset
        org_limiter.reset()

        # Should be able to make 3 more requests
        for _ in range(3):
            result = org_limiter.check("key-001")
            assert result.allowed is True


# ============================================================================
# Integration Tests (End-to-End with FastAPI)
# ============================================================================


class TestOrgRateLimitIntegration:
    """Integration tests for organization rate limiting with actual HTTP requests."""

    def test_org_limit_exceeded_distinct_error(self, client, monkeypatch):
        """Test that organization limit exceeded returns distinct error from per-key limit."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        # Set up test configuration
        org_limiter.set_organization_tier("org-test", "2/minute")
        api_key_org_mapping.set_mapping("key-org-test", "org-test")
        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

        headers = {"X-API-Key": "key-org-test"}
        payload = {"type": "inference", "data": {"query": "test"}}

        # First 2 requests succeed (org limit is 2/minute)
        res1 = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res1.status_code == 200

        res2 = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res2.status_code == 200

        # 3rd request should hit organization limit
        res3 = client.post("/v1/ai/inference", json=payload, headers=headers)
        assert res3.status_code == 429

        # Verify the error is organization-specific
        envelope = res3.json()
        assert envelope["error"]["code"] == "ORGANIZATION_RATE_LIMIT_EXCEEDED"
        assert envelope["error"]["details"]["organization_id"] == "org-test"
        assert envelope["error"]["details"]["limit_type"] == "organization"

        # Verify distinct header
        assert res3.headers.get("X-RateLimit-LimitType") == "organization"

    def test_multiple_keys_one_org_shared_budget(self, client, monkeypatch):
        """Test that multiple keys from one org share budget (main requirement)."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        # Configure org with 4 request/minute limit
        org_limiter.set_organization_tier("org-multi", "4/minute")
        api_key_org_mapping.set_mapping("key-multi-001", "org-multi")
        api_key_org_mapping.set_mapping("key-multi-002", "org-multi")
        api_key_org_mapping.set_mapping("key-multi-003", "org-multi")

        # Set per-key limits high so they don't interfere
        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

        payload = {"type": "inference", "data": {"query": "test"}}

        # Key 1: 2 requests
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-multi-001"}
        )
        assert res.status_code == 200
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-multi-001"}
        )
        assert res.status_code == 200

        # Key 2: 2 requests
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-multi-002"}
        )
        assert res.status_code == 200
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-multi-002"}
        )
        assert res.status_code == 200

        # Org has used 4 of 4 requests. Key 3 should be rejected
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-multi-003"}
        )
        assert res.status_code == 429

        envelope = res.json()
        assert envelope["error"]["code"] == "ORGANIZATION_RATE_LIMIT_EXCEEDED"

    def test_org_limit_does_not_affect_unmapped_keys(self, client, monkeypatch):
        """Test that unmapped keys are not affected by organization limits."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        # Set organization limit
        org_limiter.set_organization_tier("org-exclusive", "2/minute")
        api_key_org_mapping.set_mapping("key-org-exclusive", "org-exclusive")

        # Set generous per-key limit
        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

        payload = {"type": "inference", "data": {"query": "test"}}

        # Mapped key: can make 2 requests
        for i in range(2):
            res = client.post(
                "/v1/ai/inference",
                json=payload,
                headers={"X-API-Key": "key-org-exclusive"},
            )
            assert res.status_code == 200

        # Mapped key: 3rd request blocked by org limit
        res = client.post(
            "/v1/ai/inference",
            json=payload,
            headers={"X-API-Key": "key-org-exclusive"},
        )
        assert res.status_code == 429

        # Unmapped key: should NOT be affected by org limit
        for i in range(10):
            res = client.post(
                "/v1/ai/inference",
                json=payload,
                headers={"X-API-Key": "key-unmapped"},
            )
            assert res.status_code == 200

    def test_different_orgs_independent_limits(self, client, monkeypatch):
        """Test that different organizations have independent rate limits."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        # Org Alpha: 2 requests/minute
        org_limiter.set_organization_tier("org-alpha", "2/minute")
        api_key_org_mapping.set_mapping("key-alpha", "org-alpha")

        # Org Beta: 3 requests/minute
        org_limiter.set_organization_tier("org-beta", "3/minute")
        api_key_org_mapping.set_mapping("key-beta", "org-beta")

        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")
        payload = {"type": "inference", "data": {"query": "test"}}

        # Org Alpha exhausts limit
        for i in range(2):
            res = client.post(
                "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-alpha"}
            )
            assert res.status_code == 200

        res_alpha_3 = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-alpha"}
        )
        assert res_alpha_3.status_code == 429

        # Org Beta can still make requests (has 3/minute)
        for i in range(3):
            res = client.post(
                "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-beta"}
            )
            assert res.status_code == 200

        res_beta_4 = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-beta"}
        )
        assert res_beta_4.status_code == 429

    def test_org_limit_disabled_bypasses_checks(self, client, monkeypatch):
        """Test that disabling org limits bypasses organization-level checks."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", False)

        org_limiter.set_organization_tier("org-disabled", "1/minute")
        api_key_org_mapping.set_mapping("key-disabled", "org-disabled")
        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

        payload = {"type": "inference", "data": {"query": "test"}}

        # Should be able to make multiple requests despite org limit being 1/minute
        for i in range(5):
            res = client.post(
                "/v1/ai/inference",
                json=payload,
                headers={"X-API-Key": "key-disabled"},
            )
            assert res.status_code == 200

    def test_per_key_limit_enforced_independently(self, client, monkeypatch):
        """Test that per-key limits are still enforced independently of org limits."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        # Set org limit high
        org_limiter.set_organization_tier("org-test", "100/minute")
        api_key_org_mapping.set_mapping("key-per-key-test", "org-test")

        # Set per-key limit low
        rate_limiter.set_endpoint_override("/v1/ai/inference", "2/minute")

        payload = {"type": "inference", "data": {"query": "test"}}

        # 2 successful requests (per-key limit)
        for i in range(2):
            res = client.post(
                "/v1/ai/inference",
                json=payload,
                headers={"X-API-Key": "key-per-key-test"},
            )
            assert res.status_code == 200

        # 3rd request blocked by per-key limit
        res = client.post(
            "/v1/ai/inference",
            json=payload,
            headers={"X-API-Key": "key-per-key-test"},
        )
        assert res.status_code == 429

        # Should be per-key error, not organization error
        envelope = res.json()
        assert envelope["error"]["code"] == "RATE_LIMIT_EXCEEDED"

    def test_org_error_response_headers(self, client, monkeypatch):
        """Test that organization limit exceeded response includes proper headers."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "org_rate_limit_enabled", True)

        org_limiter.set_organization_tier("org-headers", "1/minute")
        api_key_org_mapping.set_mapping("key-headers", "org-headers")
        rate_limiter.set_endpoint_override("/v1/ai/inference", "100/minute")

        payload = {"type": "inference", "data": {"query": "test"}}

        # Make 1 request (succeeds)
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-headers"}
        )
        assert res.status_code == 200

        # Make 2nd request (should be rejected)
        res = client.post(
            "/v1/ai/inference", json=payload, headers={"X-API-Key": "key-headers"}
        )
        assert res.status_code == 429

        # Verify headers
        assert res.headers.get("Retry-After") is not None
        assert res.headers.get("X-RateLimit-Limit") == "1"
        assert res.headers.get("X-RateLimit-Remaining") == "0"
        assert res.headers.get("X-RateLimit-Reset") is not None
        assert res.headers.get("X-RateLimit-LimitType") == "organization"
