"""
Redis-based caching service for AI task responses.
Provides response caching for safe read operations with configurable TTL.
"""

import json
import hashlib
import logging
from typing import Optional, Any, Callable
from functools import wraps
import redis
from config import Settings

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

    def _generate_key(self, prefix: str, *args: Any, **kwargs: Any) -> str:
        """
        Generate a deterministic cache key from function arguments.

        Args:
            prefix: Namespace prefix for the key
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            SHA256 hash-based cache key
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

        return f"cache:ai:{prefix}:{key_hash}"

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


def cached_response(prefix: str, ttl_seconds: int):
    """
    Decorator to cache function responses based on normalized inputs.

    Args:
        prefix: Cache key namespace prefix
        ttl_seconds: Time-to-live for cached responses

    Example:
        @cached_response(prefix="task_status", ttl_seconds=30)
        async def get_task_status(task_id: str):
            return await fetch_task_status(task_id)
    """

    def decorator(func: Callable):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Get or create cache service instance
            from main import app

            cache: CacheService = getattr(app.state, "cache", None)
            if not cache or not cache.enabled:
                # Cache not available, execute function directly
                return await func(*args, **kwargs)

            # Generate cache key
            cache_key = cache._generate_key(prefix, *args, **kwargs)

            # Try to retrieve from cache
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_value

            logger.debug(f"Cache MISS: {cache_key}")

            # Execute function and cache result
            result = await func(*args, **kwargs)

            # Cache the result
            cache.set(cache_key, result, ttl_seconds)

            return result

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            # Get or create cache service instance
            from main import app

            cache: CacheService = getattr(app.state, "cache", None)
            if not cache or not cache.enabled:
                # Cache not available, execute function directly
                return func(*args, **kwargs)

            # Generate cache key
            cache_key = cache._generate_key(prefix, *args, **kwargs)

            # Try to retrieve from cache
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache HIT: {cache_key}")
                return cached_value

            logger.debug(f"Cache MISS: {cache_key}")

            # Execute function and cache result
            result = func(*args, **kwargs)

            # Cache the result
            cache.set(cache_key, result, ttl_seconds)

            return result

        # Return appropriate wrapper based on function type
        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator
