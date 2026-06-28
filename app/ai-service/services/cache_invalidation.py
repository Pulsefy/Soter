"""
Cache invalidation helpers for AI service
"""

import logging
from typing import Optional
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
        if deleted > 0:
            logger.info(f"Invalidated {deleted} task status cache entries for task {task_id}")
        return deleted

    def invalidate_all_task_statuses(self) -> int:
        """
        Invalidate all task status caches.

        Returns:
            Number of keys deleted
        """
        pattern = "cache:ai:task_status:*"
        deleted = self.cache.delete_pattern(pattern)
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
        if deleted > 0:
            logger.info(f"Invalidated {deleted} artifact access cache entries for {artifact_id}")
        return deleted

    def invalidate_all(self) -> int:
        """
        Invalidate all AI service caches (nuclear option).

        Returns:
            Number of keys deleted
        """
        pattern = "cache:ai:*"
        deleted = self.cache.delete_pattern(pattern)
        logger.warning(f"Invalidated ALL AI cache entries ({deleted} keys)")
        return deleted


def get_invalidation_helper(cache_service: Optional[CacheService] = None) -> CacheInvalidationHelper:
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
