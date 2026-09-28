"""
Per-Key Rate Limiting Service for AI Service endpoints (Issue #991).

Enforces rate limits per API key with configurable per-endpoint overrides.
Returns HTTP 429 with standard rate-limit headers (Retry-After, X-RateLimit-*)
and standardized error envelopes when limits are exceeded.
"""

import collections
import logging
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse

import metrics
from config import settings
from schemas.errors import ErrorDetail, ErrorEnvelope

logger = logging.getLogger(__name__)

# Standard units in seconds
UNIT_SECONDS = {
    "s": 1,
    "sec": 1,
    "second": 1,
    "seconds": 1,
    "m": 60,
    "min": 60,
    "minute": 60,
    "minutes": 60,
    "h": 3600,
    "hr": 3600,
    "hour": 3600,
    "hours": 3600,
    "d": 86400,
    "day": 86400,
    "days": 86400,
}


def parse_rate_limit(limit_str: str) -> Tuple[int, int]:
    """
    Parse a rate limit string like '10/minute', '5/second', '100/hour'.

    Returns:
        Tuple[int, int]: (max_requests, window_seconds)
    """
    try:
        parts = limit_str.strip().lower().split("/")
        if len(parts) != 2:
            return 60, 60
        count = int(parts[0].strip())
        unit = parts[1].strip()
        window_seconds = UNIT_SECONDS.get(unit, 60)
        return count, window_seconds
    except Exception as exc:
        logger.warning(f"Failed to parse rate limit '{limit_str}': {exc}")
        return 60, 60


def extract_api_key(request: Request) -> str:
    """
    Extract caller identifier from request headers (x-api-key, Authorization)
    or fall back to client IP address.
    """
    # 1. Check X-API-Key (case-insensitive in FastAPI request headers)
    api_key = request.headers.get("x-api-key")
    if api_key:
        return api_key.strip()

    # 2. Check Authorization Bearer token
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    # 3. Fallback to client host or anonymous
    client_host = request.client.host if request.client else "anonymous"
    return f"anon:{client_host}"


@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int
    retry_after: int
    endpoint: str
    method: str
    api_key: str
    window_seconds: int


class RateLimiterService:
    """
    Thread-safe sliding window rate limiter supporting in-memory storage
    and Redis-backed distributed storage.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Storage: key -> collections.deque of float timestamps
        self._in_memory_records: Dict[str, collections.deque] = collections.defaultdict(
            collections.deque
        )
        self._dynamic_overrides: Dict[str, str] = {}

    def set_endpoint_override(self, endpoint: str, limit_str: str) -> None:
        """Register or update an endpoint rate limit override dynamically."""
        with self._lock:
            self._dynamic_overrides[endpoint] = limit_str

    def clear_endpoint_overrides(self) -> None:
        """Clear dynamic endpoint overrides."""
        with self._lock:
            self._dynamic_overrides.clear()

    def reset(self) -> None:
        """Clear all in-memory rate limit records (useful for testing)."""
        with self._lock:
            self._in_memory_records.clear()
            self._dynamic_overrides.clear()

    def resolve_limit(self, endpoint: str) -> Tuple[int, int]:
        """
        Resolve the limit and window_seconds for a given endpoint path.
        Checks dynamic overrides, then settings overrides, then default limit.
        """
        normalized_path = endpoint.rstrip("/") if len(endpoint) > 1 else endpoint

        # 1. Dynamic overrides
        if endpoint in self._dynamic_overrides:
            return parse_rate_limit(self._dynamic_overrides[endpoint])
        if normalized_path in self._dynamic_overrides:
            return parse_rate_limit(self._dynamic_overrides[normalized_path])

        # 2. Configured overrides
        overrides = getattr(settings, "rate_limit_endpoint_overrides", {}) or {}
        if endpoint in overrides:
            return parse_rate_limit(overrides[endpoint])
        if normalized_path in overrides:
            return parse_rate_limit(overrides[normalized_path])

        # 3. Default per-key limit
        default_limit = getattr(settings, "rate_limit_per_key_default", "60/minute")
        return parse_rate_limit(default_limit)

    def check(self, request: Request) -> RateLimitResult:
        """
        Evaluate rate limit for the incoming request using a sliding window algorithm.
        """
        path = request.url.path
        method = request.method
        api_key = extract_api_key(request)
        limit, window_seconds = self.resolve_limit(path)

        enabled = getattr(settings, "rate_limit_enabled", True)
        if not enabled:
            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=limit,
                reset_seconds=0,
                retry_after=0,
                endpoint=path,
                method=method,
                api_key=api_key,
                window_seconds=window_seconds,
            )

        now = time.time()
        window_start = now - window_seconds
        storage_key = f"{api_key}:{path}:{method}"

        # Try Redis sliding window if Redis is available and configured
        redis_result = self._check_redis(
            storage_key, limit, window_seconds, now, window_start, path, method, api_key
        )
        if redis_result is not None:
            return redis_result

        # In-memory sliding window
        with self._lock:
            records = self._in_memory_records[storage_key]

            # Prune timestamps outside current window
            while records and records[0] <= window_start:
                records.popleft()

            current_count = len(records)

            if current_count >= limit:
                earliest = records[0]
                retry_after = max(1, int(math.ceil(earliest + window_seconds - now)))
                reset_seconds = retry_after
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_seconds=reset_seconds,
                    retry_after=retry_after,
                    endpoint=path,
                    method=method,
                    api_key=api_key,
                    window_seconds=window_seconds,
                )

            # Record this request
            records.append(now)
            remaining = max(0, limit - current_count - 1)
            earliest = records[0]
            reset_seconds = max(1, int(math.ceil(earliest + window_seconds - now)))

            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_seconds=reset_seconds,
                retry_after=0,
                endpoint=path,
                method=method,
                api_key=api_key,
                window_seconds=window_seconds,
            )

    def _check_redis(
        self,
        storage_key: str,
        limit: int,
        window_seconds: int,
        now: float,
        window_start: float,
        path: str,
        method: str,
        api_key: str,
    ) -> Optional[RateLimitResult]:
        """Attempt to check rate limit in Redis if available."""
        if getattr(settings, "app_env", "") == "test":
            # In test environment, keep in-memory for exact deterministic control
            return None

        try:
            import redis

            client = redis.from_url(
                settings.redis_url,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
            )
            rkey = f"ratelimit:{storage_key}"

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
                return RateLimitResult(
                    allowed=False,
                    limit=limit,
                    remaining=0,
                    reset_seconds=retry_after,
                    retry_after=retry_after,
                    endpoint=path,
                    method=method,
                    api_key=api_key,
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

            return RateLimitResult(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_seconds=reset_seconds,
                retry_after=0,
                endpoint=path,
                method=method,
                api_key=api_key,
                window_seconds=window_seconds,
            )
        except Exception:
            # Fallback gracefully to in-memory on any Redis error
            return None


# Global service instance
rate_limiter = RateLimiterService()


def build_rate_limit_response(result: RateLimitResult) -> JSONResponse:
    """
    Build standardized HTTP 429 response with rate limit headers and ErrorEnvelope.
    """
    metrics.record_rate_limit_exceeded(result.endpoint, result.method)

    headers = {
        "Retry-After": str(result.retry_after),
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": str(result.reset_seconds),
    }

    return JSONResponse(
        status_code=429,
        headers=headers,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="RATE_LIMIT_EXCEEDED",
                message="Rate limit exceeded for API key. Please retry after the specified duration.",
                details={
                    "limit": result.limit,
                    "remaining": 0,
                    "retry_after": result.retry_after,
                    "reset_seconds": result.reset_seconds,
                    "window_seconds": result.window_seconds,
                    "endpoint": result.endpoint,
                },
            )
        ).model_dump(),
    )


def evaluate_rate_limit(request: Request) -> Optional[JSONResponse]:
    """
    Evaluate per-key rate limit for a request.
    Returns JSONResponse (429) if limit is exceeded, or None if request is allowed.
    Attaches RateLimitResult to request.state.rate_limit_result when allowed.
    """
    result = rate_limiter.check(request)
    if not result.allowed:
        return build_rate_limit_response(result)

    # Store result on request state so downstream middleware or headers can access it
    request.state.rate_limit_result = result
    return None
