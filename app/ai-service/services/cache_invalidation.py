"""
Cache invalidation helpers for AI service
"""

import logging
from typing import Optional
import metrics
from services.cache import CacheService

logger = logging.getLogger(__name__)


class CacheInvalidationHelper:
    """
    Helper class for invalidating specific cache patterns.
    Provides convenient methods for common invalidation scenarios.
    """

    def __init__(self, cache_service: CacheService):
        self.cache = cache_service

    def invalidate_task_status(self, task_id: str) -> int:
        """
        Invalidate cache for a specific task status.

        Args:
            task_id: The task ID to invalidate

        Returns:
            Number of keys deleted
        """
        pattern = f"cache:ai:task_status:*{task_id}*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="task_status").inc()
        if deleted > 0:
            logger.info(
                f"Invalidated {deleted} task status cache entries for task {task_id}"
            )
        return deleted

    def invalidate_all_task_statuses(self) -> int:
        """
        Invalidate all task status caches.

        Returns:
            Number of keys deleted
        """
        pattern = "cache:ai:task_status:*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="task_status").inc()
        if deleted > 0:
            logger.info(f"Invalidated {deleted} task status cache entries")
        return deleted

    def invalidate_artifact_access(self, artifact_id: str) -> int:
        """
        Invalidate cache for artifact access checks.

        Args:
            artifact_id: The artifact ID to invalidate

        Returns:
            Number of keys deleted
        """
        pattern = f"cache:ai:artifact_access:*{artifact_id}*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="artifact_access").inc()
        if deleted > 0:
            logger.info(
                f"Invalidated {deleted} artifact access cache entries for {artifact_id}"
            )
        return deleted

    def invalidate_verification_by_artifact(self, artifact_id: str) -> int:
        """
        Invalidate cached AI verification responses that referenced a given
        evidence artifact, e.g. after the artifact's content has been updated.

        Relies on the artifact ID being embedded literally in the cache key
        (see `artifact_tag` in api/v1/humanitarian.py) rather than only being
        part of the hashed inputs, so it can be matched without knowing the
        exact hash of every request that referenced it.

        Args:
            artifact_id: The evidence artifact ID that changed

        Returns:
            Number of keys deleted
        """
        pattern = f"cache:ai:humanitarian_verification:*artifact_tag=*{artifact_id}*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="artifact_updated").inc()
        if deleted > 0:
            logger.info(
                f"Invalidated {deleted} verification cache entries for artifact {artifact_id}"
            )
        return deleted

    def invalidate_verification_by_model_version(
        self, provider: str, model: str
    ) -> int:
        """
        Invalidate cached AI verification responses produced by a specific
        provider/model pairing, e.g. after upgrading the configured model.

        Args:
            provider: The LLM provider (e.g. "openai", "groq")
            model: The model identifier (e.g. "gpt-4o-mini")

        Returns:
            Number of keys deleted
        """
        model_version = CacheService._sanitize_tag_value(f"{provider}:{model}")
        pattern = f"cache:ai:humanitarian_verification:*model_version={model_version}*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="model_version_changed").inc()
        if deleted > 0:
            logger.info(
                f"Invalidated {deleted} verification cache entries for model version {provider}:{model}"
            )
        return deleted

    def invalidate_all(self) -> int:
        """
        Invalidate all AI service caches (nuclear option).

        Returns:
            Number of keys deleted
        """
        pattern = "cache:ai:*"
        deleted = self.cache.delete_pattern(pattern)
        metrics.CACHE_INVALIDATION_TOTAL.labels(reason="all").inc()
        logger.warning(f"Invalidated ALL AI cache entries ({deleted} keys)")
        return deleted


def get_invalidation_helper(
    cache_service: Optional[CacheService] = None,
) -> CacheInvalidationHelper:
    """
    Get a cache invalidation helper instance.

    Args:
        cache_service: Optional CacheService instance. If not provided,
                      will attempt to get from app.state.cache

    Returns:
        CacheInvalidationHelper instance
    """
    if cache_service is None:
        from main import app

        cache_service = getattr(app.state, "cache", None)
        if cache_service is None:
            raise RuntimeError("Cache service not available")

    return CacheInvalidationHelper(cache_service)
