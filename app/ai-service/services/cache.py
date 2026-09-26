"""
Redis-based caching service for AI task responses.
Provides response caching for safe read operations with configurable TTL.
"""

import json
import hashlib
import logging
import asyncio
from typing import Optional, Any, Callable, Dict, List
from functools import wraps
import redis
from config import Settings
import metrics

logger = logging.getLogger(__name__)


class CacheService:
    """
    Redis-based cache service with automatic serialization and TTL support.
    """

    def __init__(self, settings: Settings):
        """
        Initialize the cache service with Redis connection.

        Args:
            settings: Application settings containing Redis configuration
        """
        self.settings = settings
        self.enabled = True

        try:
            # Parse Redis URL
            self.client = redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            # Test connection
            self.client.ping()
            logger.info("Cache service initialized successfully")
        except Exception as e:
            logger.warning(f"Cache service disabled due to Redis error: {e}")
            self.enabled = False
            self.client = None

    def _generate_key(
        self,
        prefix: str,
        *args: Any,
        tags: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> str:
        """
        Generate a deterministic cache key from function arguments.

        Args:
            prefix: Namespace prefix for the key
            *args: Positional arguments
            tags: Optional named values (e.g. artifact_id, model_version) to embed
                literally in the key, in addition to the arguments hash, so that
                CacheInvalidationHelper can target entries by that value via a
                Redis glob pattern rather than needing the full argument hash.
            **kwargs: Keyword arguments

        Returns:
            Cache key combining any literal tags with a SHA256 hash of the inputs
        """
        # Sort kwargs for consistent key generation
        sorted_kwargs = sorted(kwargs.items())

        # Create a deterministic string representation
        key_data = {
            "args": args,
            "kwargs": sorted_kwargs,
        }

        # Hash the serialized data
        key_str = json.dumps(key_data, sort_keys=True, default=str)
        key_hash = hashlib.sha256(key_str.encode()).hexdigest()

        tag_segment = ""
        if tags:
            sanitized = [
                f"{name}={self._sanitize_tag_value(value)}"
                for name, value in sorted(tags.items())
                if value not in (None, "")
            ]
            if sanitized:
                tag_segment = ":" + ":".join(sanitized)

        return f"cache:ai:{prefix}{tag_segment}:{key_hash}"

    @staticmethod
    def _sanitize_tag_value(value: Any) -> str:
        """
        Strip Redis glob-special and separator characters from a tag value so it
        remains safely matchable with SCAN MATCH patterns.
        """
        text = str(value)
        for ch in ("*", "?", "[", "]", ":"):
            text = text.replace(ch, "_")
        return text

    def get(self, key: str) -> Optional[Any]:
        """
        Retrieve a value from cache.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found/expired
        """
        if not self.enabled or not self.client:
            return None

        try:
            raw = self.client.get(key)
            if raw is None:
                return None

            return json.loads(raw)
        except Exception as e:
            logger.warning(f"Cache GET failed for key {key}: {e}")
            return None

    def set(self, key: str, value: Any, ttl_seconds: int) -> bool:
        """
        Store a value in cache with TTL.

        Args:
            key: Cache key
            value: Value to cache (must be JSON-serializable)
            ttl_seconds: Time-to-live in seconds

        Returns:
            True if successful, False otherwise
        """
        if not self.enabled or not self.client:
            return False

        try:
            serialized = json.dumps(value, default=str)
            self.client.setex(key, ttl_seconds, serialized)
            logger.debug(f"Cached key {key} with TTL {ttl_seconds}s")
            return True
        except Exception as e:
            logger.warning(f"Cache SET failed for key {key}: {e}")
            return False

    def delete(self, key: str) -> bool:
        """
        Delete a key from cache.

        Args:
            key: Cache key to delete

        Returns:
            True if successful, False otherwise
        """
        if not self.enabled or not self.client:
            return False

        try:
            self.client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Cache DELETE failed for key {key}: {e}")
            return False

    def delete_pattern(self, pattern: str) -> int:
        """
        Delete all keys matching a pattern using SCAN (non-blocking).

        Args:
            pattern: Redis glob pattern (e.g., "cache:ai:task:*")

        Returns:
            Number of keys deleted
        """
        if not self.enabled or not self.client:
            return 0

        try:
            keys = []
            for key in self.client.scan_iter(match=pattern, count=100):
                keys.append(key)

            if keys:
                deleted = self.client.delete(*keys)
                logger.info(f"Deleted {deleted} keys matching pattern {pattern}")
                return deleted
            return 0
        except Exception as e:
            logger.warning(f"Cache DELETE_PATTERN failed for {pattern}: {e}")
            return 0


# Module-level dictionary to track in-flight computations for single-flight suppression
_inflight_computations: Dict[str, asyncio.Event] = {}
_inflight_results: Dict[str, Any] = {}
_inflight_errors: Dict[str, Exception] = {}
_inflight_lock = asyncio.Lock()


async def _cleanup_inflight(cache_key: str, delay_seconds: float = 1.0):
    """
    Clean up in-flight computation tracking after a delay.

    Args:
        cache_key: The cache key to clean up
        delay_seconds: How long to wait before cleaning up (to allow waiting
            requests to get results)
    """
    await asyncio.sleep(delay_seconds)
    async with _inflight_lock:
        _inflight_computations.pop(cache_key, None)
        _inflight_results.pop(cache_key, None)
        _inflight_errors.pop(cache_key, None)


def cached_response(
    prefix: str,
    ttl_seconds: int,
    key_tags: Optional[List[str]] = None,
    content_hash_arg: Optional[str] = None,
    content_key_exclude_tags: List[str] = ("artifact_tag",),
):
    """
    Decorator to cache function responses based on normalized inputs.
    Implements single-flight suppression to prevent cache stampedes.

    Args:
        prefix: Cache key namespace prefix
        ttl_seconds: Time-to-live for cached responses
        key_tags: Names of keyword arguments (e.g. "artifact_id", "model_version")
            whose values should also be embedded literally in the cache key, so
            CacheInvalidationHelper can target them by that value instead of
            needing the full argument hash. Values are still part of the hashed
            inputs regardless of whether they're listed here.
        content_hash_arg: Optionally, the name of a keyword argument carrying a
            content hash (e.g. a SHA-256 of re-uploaded evidence bytes). When set
            and non-empty, the decorator writes a SECOND cache entry keyed by the
            content hash (alongside the primary, identity-keyed entry) and looks
            it up when the primary key misses -- so identical evidence under a
            new artifact ID reuses a previously computed result instead of
            triggering another upstream call. The content-hash key is built from
            every input EXCEPT the tags listed in ``content_key_exclude_tags``
            (default ``("artifact_tag",)``), so it deliberately ignores artifact
            identity.
        content_key_exclude_tags: ``key_tags`` whose values must NOT be embedded
            in (or hashed into) the content-hash key. Defaults to
            ``("artifact_tag",)`` so re-uploads under a new artifact ID produce
            the same content key.

    Example:
        @cached_response(prefix="task_status", ttl_seconds=30)
        async def get_task_status(task_id: str):
            return await fetch_task_status(task_id)

        @cached_response(
            prefix="humanitarian_verification",
            ttl_seconds=120,
            key_tags=["model_version", "artifact_tag"],
            content_hash_arg="content_hash",
        )
        async def verify(
            aid_claim: str,
            artifact_tag: str,
            content_hash: str,
            model_version: str,
        ):
            ...
    """

    def decorator(func: Callable):
        def _resolve_tags(kwargs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            if not key_tags:
                return None
            return {
                name: kwargs.get(name)
                for name in key_tags
                if kwargs.get(name) is not None
            }

        def _resolve_keys(
            cache: CacheService, args: tuple, kwargs: Dict[str, Any]
        ) -> tuple:
            """Return ``(primary_cache_key, content_cache_key_or_None)``.

            The primary key is unchanged (identity-tagged). The content key is
            only produced when ``content_hash_arg`` is configured AND resolves to
            a non-empty value; it is built from the same inputs but excludes the
            ``content_key_exclude_tags`` tags/kwargs (i.e. artifact identity) and
            embeds the content hash as a literal tag so pattern invalidation can
            target it.
            """
            primary_kwargs = kwargs
            if content_hash_arg is not None:
                primary_kwargs = {
                    k: v for k, v in kwargs.items() if k != content_hash_arg
                }

            cache_key = cache._generate_key(
                prefix, *args, tags=_resolve_tags(kwargs), **primary_kwargs
            )

            content_cache_key = None
            content_hash = kwargs.get(content_hash_arg) if content_hash_arg else None
            if content_hash:
                content_kwargs = {
                    k: v
                    for k, v in primary_kwargs.items()
                    if k not in content_key_exclude_tags
                }
                content_tags = {
                    name: value
                    for name, value in (_resolve_tags(kwargs) or {}).items()
                    if name not in content_key_exclude_tags
                }
                content_tags[content_hash_arg] = content_hash
                content_cache_key = cache._generate_key(
                    prefix, *args, tags=content_tags, **content_kwargs
                )

            return cache_key, content_cache_key

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Get or create cache service instance
            from main import app

            cache: CacheService = getattr(app.state, "cache", None)
            if not cache or not cache.enabled:
                # Cache not available, execute function directly
                return await func(*args, **kwargs)

            # Generate cache keys (primary identity-keyed, plus a content-hash
            # alias when a content hash is supplied)
            cache_key, content_cache_key = _resolve_keys(cache, args, kwargs)

            # Try to retrieve from cache: primary key first, then content hash
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_value

            if content_cache_key is not None:
                content_value = cache.get(content_cache_key)
                if content_value is not None:
                    logger.debug(f"Cache HIT (content hash): {content_cache_key}")
                    # Backfill the identity-keyed entry so the next identical
                    # artifact-id request hits the primary path directly.
                    cache.set(cache_key, content_value, ttl_seconds)
                    return content_value

            logger.debug(f"Cache MISS: {cache_key}")

            # Single-flight suppression logic. Keyed on the content-hash key when
            # present so identical evidence re-uploaded under a different
            # artifact ID coalesces onto one upstream computation.
            flight_key = content_cache_key or cache_key

            async with _inflight_lock:
                event = _inflight_computations.get(flight_key)
                if event:
                    if event.is_set():
                        # Computation already completed
                        if flight_key in _inflight_results:
                            logger.debug(
                                f"Returning already computed result for key: {flight_key}"
                            )
                            result = _inflight_results[flight_key]
                            if content_cache_key is not None:
                                cache.set(cache_key, result, ttl_seconds)
                            return result
                        elif flight_key in _inflight_errors:
                            logger.debug(
                                f"Raising already recorded error for key: {flight_key}"
                            )
                            raise _inflight_errors[flight_key]
                    else:
                        # Computation in progress, wait for it
                        metrics.SINGLE_FLIGHT_SUPPRESSED.labels(prefix=prefix).inc()
                        logger.debug(f"Single-flight suppressed for key: {flight_key}")
                        is_computing = False
                else:
                    # We're the first request, create an event for others to wait on
                    event = asyncio.Event()
                    _inflight_computations[flight_key] = event
                    is_computing = True
                    logger.debug(f"Created new event for key: {flight_key}")

            if is_computing:
                # We need to compute the value
                try:
                    logger.debug(f"Computing value for key: {cache_key}")
                    result = await func(*args, **kwargs)

                    # Store the result temporarily for waiting requests
                    async with _inflight_lock:
                        _inflight_results[flight_key] = result
                        metrics.SINGLE_FLIGHT_COMPLETED.labels(prefix=prefix).inc()

                    # Cache the result for future requests under BOTH keys
                    cache.set(cache_key, result, ttl_seconds)
                    if content_cache_key is not None:
                        cache.set(content_cache_key, result, ttl_seconds)

                    # Signal all waiting requests and schedule cleanup
                    event.set()
                    asyncio.create_task(_cleanup_inflight(flight_key))

                    return result

                except Exception as e:
                    async with _inflight_lock:
                        _inflight_errors[flight_key] = e
                        metrics.SINGLE_FLIGHT_FAILED.labels(prefix=prefix).inc()
                    # Still signal waiting requests (they'll get the error)
                    event.set()
                    # Don't store error for future requests - allow retry
                    asyncio.create_task(
                        _cleanup_inflight(flight_key, delay_seconds=0.1)
                    )
                    raise
            else:
                # We're waiting for the computation to complete
                logger.debug(f"Waiting for event on key: {flight_key}")
                await event.wait()
                logger.debug(f"Event completed for key: {flight_key}")

                # After event is set, check for result or error
                if flight_key in _inflight_results:
                    result = _inflight_results[flight_key]
                    if content_cache_key is not None:
                        cache.set(cache_key, result, ttl_seconds)
                    return result
                elif flight_key in _inflight_errors:
                    raise _inflight_errors[flight_key]
                else:
                    # This shouldn't happen, but fall back to direct computation
                    logger.warning(f"No result found after event for key: {flight_key}")
                    result = await func(*args, **kwargs)
                    cache.set(cache_key, result, ttl_seconds)
                    if content_cache_key is not None:
                        cache.set(content_cache_key, result, ttl_seconds)
                    return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            # Get or create cache service instance
            from main import app

            cache: CacheService = getattr(app.state, "cache", None)
            if not cache or not cache.enabled:
                # Cache not available, execute function directly
                return func(*args, **kwargs)

            cache_key, content_cache_key = _resolve_keys(cache, args, kwargs)

            # Try to retrieve from cache: primary key first, then content hash
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_value

            if content_cache_key is not None:
                content_value = cache.get(content_cache_key)
                if content_value is not None:
                    logger.debug(f"Cache HIT (content hash): {content_cache_key}")
                    cache.set(cache_key, content_value, ttl_seconds)
                    return content_value

            logger.debug(f"Cache MISS: {cache_key}")

            # Execute function and cache result
            result = func(*args, **kwargs)

            # Cache the result under BOTH keys
            cache.set(cache_key, result, ttl_seconds)
            if content_cache_key is not None:
                cache.set(content_cache_key, result, ttl_seconds)

            return result

        # Return appropriate wrapper based on function type
        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator
