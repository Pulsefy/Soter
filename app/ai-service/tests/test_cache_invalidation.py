"""
Tests for cache invalidation helpers.
"""

from unittest.mock import Mock, patch

import pytest

import metrics
from services.cache import CacheService
from services.cache_invalidation import CacheInvalidationHelper, get_invalidation_helper


@pytest.fixture
def mock_cache():
    cache = Mock(spec=CacheService)
    cache.delete_pattern.return_value = 2
    return cache


@pytest.fixture
def helper(mock_cache):
    return CacheInvalidationHelper(mock_cache)


@pytest.fixture(autouse=True)
def reset_invalidation_metric():
    """CACHE_INVALIDATION_TOTAL is a module-level Counter; snapshot per-test."""
    yield


def _counter_value(reason: str) -> float:
    return metrics.CACHE_INVALIDATION_TOTAL.labels(reason=reason)._value.get()


class TestCacheInvalidationHelper:
    def test_invalidate_task_status_uses_task_id_pattern(self, helper, mock_cache):
        helper.invalidate_task_status("task-1")

        mock_cache.delete_pattern.assert_called_once_with(
            "cache:ai:task_status:*task-1*"
        )

    def test_invalidate_artifact_access_uses_artifact_id_pattern(
        self, helper, mock_cache
    ):
        helper.invalidate_artifact_access("artifact-1")

        mock_cache.delete_pattern.assert_called_once_with(
            "cache:ai:artifact_access:*artifact-1*"
        )

    def test_invalidate_verification_by_artifact_targets_artifact_tag(
        self, helper, mock_cache
    ):
        helper.invalidate_verification_by_artifact("artifact-1")

        mock_cache.delete_pattern.assert_called_once_with(
            "cache:ai:humanitarian_verification:*artifact_tag=*artifact-1*"
        )

    def test_invalidate_verification_by_artifact_returns_deleted_count(
        self, helper, mock_cache
    ):
        mock_cache.delete_pattern.return_value = 5

        assert helper.invalidate_verification_by_artifact("artifact-1") == 5

    def test_invalidate_verification_by_model_version_targets_sanitized_model_version(
        self, helper, mock_cache
    ):
        helper.invalidate_verification_by_model_version("openai", "gpt-4o-mini")

        mock_cache.delete_pattern.assert_called_once_with(
            "cache:ai:humanitarian_verification:*model_version=openai_gpt-4o-mini*"
        )

    def test_invalidate_all_targets_every_ai_cache_entry(self, helper, mock_cache):
        helper.invalidate_all()

        mock_cache.delete_pattern.assert_called_once_with("cache:ai:*")

    def test_invalidate_verification_by_artifact_records_metric(
        self, helper, mock_cache
    ):
        before = _counter_value("artifact_updated")

        helper.invalidate_verification_by_artifact("artifact-1")

        assert _counter_value("artifact_updated") == before + 1

    def test_invalidate_verification_by_model_version_records_metric(
        self, helper, mock_cache
    ):
        before = _counter_value("model_version_changed")

        helper.invalidate_verification_by_model_version("openai", "gpt-4o-mini")

        assert _counter_value("model_version_changed") == before + 1

    def test_invalidate_artifact_access_records_metric(self, helper, mock_cache):
        before = _counter_value("artifact_access")

        helper.invalidate_artifact_access("artifact-1")

        assert _counter_value("artifact_access") == before + 1

    def test_invalidate_task_status_records_metric(self, helper, mock_cache):
        before = _counter_value("task_status")

        helper.invalidate_task_status("task-1")

        assert _counter_value("task_status") == before + 1

    def test_invalidate_all_records_metric(self, helper, mock_cache):
        before = _counter_value("all")

        helper.invalidate_all()

        assert _counter_value("all") == before + 1


class TestGetInvalidationHelper:
    def test_returns_helper_wrapping_provided_cache_service(self, mock_cache):
        helper = get_invalidation_helper(mock_cache)

        assert isinstance(helper, CacheInvalidationHelper)
        assert helper.cache is mock_cache

    def test_raises_when_no_cache_available_on_app_state(self):
        with patch("main.app") as mock_app:
            mock_app.state = Mock(spec=[])

            with pytest.raises(RuntimeError):
                get_invalidation_helper()
