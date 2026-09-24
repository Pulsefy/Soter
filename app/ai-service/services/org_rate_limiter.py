"""
Per-Organization Rate Limiting Service (Issue #1200).

Enforces organization-level rate limits independently of per-key limits.
Organizations can hold multiple API keys; requests from any key belonging
to an organization count against that organization's shared budget.

When an organization exceeds its limit, a distinct error response is returned
from the per-key rate limit exceeded response, allowing clients to distinguish
between key-level and org-level throttling.
"""

import collections
import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse

import metrics
from config import settings
from schemas.errors import ErrorDetail, ErrorEnvelope

logger = logging.getLogger(__name__)


@dataclass
class OrganizationRateLimitResult:
    """Result of checking an organization's rate limit."""

    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int
    retry_after: int
    organization_id: str
    window_seconds: int
    limit_type: str = "organization"  # Distinguishes from per-key limits


class ApiKeyOrgMapping:
    """
    Maps API keys to organization IDs with optional caching.

    This service provides the lookup mechanism to determine which organization
    owns a given API key. In production, this would query a database or
    external service; for now, it uses a configurable mapping.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Map: api_key -> organization_id
        self._mapping: Dict[str, str] = {}

    def set_mapping(self, api_key: str, org_id: str) -> None:
        """Register an API key to organization mapping."""
        with self._lock:
            self._mapping[api_key] = org_id

    def get_org_id(self, api_key: str) -> Optional[str]:
        """
        Get the organization ID for a given API key.

        Returns:
            Organization ID if found, None if the key is not mapped to any org
        """
        with self._lock:
            return self._mapping.get(api_key)

    def clear_mapping(self) -> None:
        """Clear all mappings (useful for testing)."""
        with self._lock:
            self._mapping.clear()

    def set_batch_mapping(self, mapping: Dict[str, str]) -> None:
        """Set multiple API key to organization mappings at once."""
        with self._lock:
            self._mapping.update(mapping)


class OrganizationRateLimiterService:
    """
    Thread-safe per-organization sliding window rate limiter.

    Enforces a shared rate limit across all API keys belonging to an organization.
    Organizations without explicit tier configuration are not rate-limited at the
    org level (bypassed), allowing gradual adoption.
    """

    def __init__(self, api_key_org_mapping: ApiKeyOrgMapping):
        self._lock = threading.Lock()
        # Storage: org_id -> collections.deque of float timestamps
        self._in_memory_records: Dict[str, collections.deque] = (
            collections.defaultdict(collections.deque)
        )
        self._api_key_org_mapping = api_key_org_mapping
        # Organization ID -> (limit, window_seconds)
        self._org_tier_cache: Dict[str, Tuple[int, int]] = {}

    def set_organization_tier(
        self, org_id: str, limit_str: str
    ) -> None:
        """
        Register or update an organization's rate limit tier.

        Args:
            org_id: Organization identifier
            limit_str: Rate limit string, e.g. "100/minute"
        """
        from services.rate_limiter import parse_rate_limit

        limit, window_seconds = parse_rate_limit(limit_str)
        with self._lock:
            self._org_tier_cache[org_id] = (limit, window_seconds)

    def get_organization_tier(self, org_id: str) -> Optional[Tuple[int, int]]:
        """
        Get the rate limit tier for an organization.

        Returns:
            Tuple of (limit, window_seconds) if org has a configured tier, None otherwise
        """
        with self._lock:
            return self._org_tier_cache.get(org_id)

    def clear_organization_tiers(self) -> None:
        """Clear all organization tier configurations (useful for testing)."""
        with self._lock:
            self._org_tier_cache.clear()

    def check(self, api_key: str) -> Optional[OrganizationRateLimitResult]:
        """
        Check if the organization (via api_key) has exceeded its rate limit.

        Args:
            api_key: The API key from the request

        Returns:
            OrganizationRateLimitResult if org is rate-limited by org ceiling,
            None if check passed or org has no configured tier.
        """
        # Look up organization for this API key
        org_id = self._api_key_org_mapping.get_org_id(api_key)
        if not org_id:
            # API key not mapped to any org, skip org-level limiting
            return None

        # Get organization's tier configuration
        tier = self.get_organization_tier(org_id)
        if not tier:
            # Organization has no configured rate limit tier
            return None

        limit, window_seconds = tier

        # Check if org-level rate limit is enabled globally
        org_limiting_enabled = getattr(settings, "org_rate_limit_enabled", True)
        if not org_limiting_enabled:
            return None

        now = time.time()
        window_start = now - window_seconds

        # Try Redis sliding window if available
        redis_result = self._check_redis_org(
            org_id, limit, window_seconds, now, window_start
        )
        if redis_result is not None:
            return redis_result

        # In-memory sliding window
        with self._lock:
            records = self._in_memory_records[org_id]

            # Prune timestamps outside current window
            while records and records[0] <= window_start:
                records.popleft()

            current_count = len(records)

            if current_count >= limit:
                earliest = records[0]
                retry_after = max(1, int(math.ceil(earliest + window_seconds - now)))
                reset_seconds = retry_after
                return OrganizationRateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_seconds=reset_seconds,
                    retry_after=retry_after,
                    organization_id=org_id,
                    window_seconds=window_seconds,
                )

            # Record this request
            records.append(now)
            remaining = max(0, limit - current_count - 1)
            earliest = records[0]
            reset_seconds = max(1, int(math.ceil(earliest + window_seconds - now)))

            return OrganizationRateLimitResult(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_seconds=reset_seconds,
                retry_after=0,
                organization_id=org_id,
                window_seconds=window_seconds,
            )

    def _check_redis_org(
        self,
        org_id: str,
        limit: int,
        window_seconds: int,
        now: float,
        window_start: float,
    ) -> Optional[OrganizationRateLimitResult]:
        """Attempt to check organization rate limit in Redis if available."""
        if getattr(settings, "app_env", "") == "test":
            return None

        try:
            import redis

            client = redis.from_url(
                settings.redis_url,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
            )
            rkey = f"ratelimit:org:{org_id}"

            # Pipeline sliding window check and record
            pipe = client.pipeline()
            pipe.zremrangebyscore(rkey, 0, window_start)
            pipe.zcard(rkey)
            pipe.zrange(rkey, 0, 0, withscores=True)
            results = pipe.execute()

            current_count = results[1]
            oldest_entries = results[2]

            if current_count >= limit:
                earliest = oldest_entries[0][1] if oldest_entries else window_start
                retry_after = max(1, int(math.ceil(earliest + window_seconds - now)))
                return OrganizationRateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_seconds=retry_after,
                    retry_after=retry_after,
                    organization_id=org_id,
                    window_seconds=window_seconds,
                )

            # Add current timestamp to sorted set
            pipe = client.pipeline()
            pipe.zadd(rkey, {str(now): now})
            pipe.expire(rkey, window_seconds + 5)
            pipe.execute()

            earliest = oldest_entries[0][1] if oldest_entries else now
            reset_seconds = max(1, int(math.ceil(earliest + window_seconds - now)))
            remaining = max(0, limit - current_count - 1)

            return OrganizationRateLimitResult(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_seconds=reset_seconds,
                retry_after=0,
                organization_id=org_id,
                window_seconds=window_seconds,
            )
        except Exception:
            # Fallback gracefully to in-memory on any Redis error
            return None

    def reset(self) -> None:
        """Clear all organization-level rate limit records (useful for testing)."""
        with self._lock:
            self._in_memory_records.clear()


# Global instances
api_key_org_mapping = ApiKeyOrgMapping()
org_rate_limiter = OrganizationRateLimiterService(api_key_org_mapping)


def build_organization_rate_limit_response(
    result: OrganizationRateLimitResult,
) -> JSONResponse:
    """
    Build standardized HTTP 429 response for organization rate limit exceeded.

    This is distinct from per-key rate limit exceeded, allowing clients to
    handle organization-level throttling differently if needed.
    """
    metrics.record_org_rate_limit_exceeded(result.organization_id)

    headers = {
        "Retry-After": str(result.retry_after),
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": str(result.reset_seconds),
        "X-RateLimit-LimitType": "organization",
    }

    return JSONResponse(
        status_code=429,
        headers=headers,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="ORGANIZATION_RATE_LIMIT_EXCEEDED",
                message="Organization rate limit exceeded. Please retry after the specified duration.",
                details={
                    "limit": result.limit,
                    "remaining": 0,
                    "retry_after": result.retry_after,
                    "reset_seconds": result.reset_seconds,
                    "window_seconds": result.window_seconds,
                    "organization_id": result.organization_id,
                    "limit_type": "organization",
                },
            )
        ).model_dump(),
    )


def evaluate_org_rate_limit(request: Request) -> Optional[JSONResponse]:
    """
    Evaluate per-organization rate limit for a request.

    Returns JSONResponse (429) if organization limit is exceeded,
    or None if the organization is within limits or has no configured tier.

    This check runs after per-key rate limiting, so an organization-level
    rejection will only occur if per-key limits already passed.
    """
    from services.rate_limiter import extract_api_key

    api_key = extract_api_key(request)
    result = org_rate_limiter.check(api_key)

    if result is None:
        # Organization has no tier or is not mapped
        return None

    if not result.allowed:
        return build_organization_rate_limit_response(result)

    # Store result on request state so downstream can access it
    request.state.org_rate_limit_result = result
    return None
