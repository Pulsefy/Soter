"""
Tests for cache stampede prevention (single-flight suppression)
"""

import pytest
import asyncio
from unittest.mock import Mock, patch
from services.cache import (
    cached_response,
    _inflight_computations,
    _inflight_results,
    _inflight_errors,
)


@pytest.fixture(autouse=True)
def _clear_inflight_state():
    """Reset module-level single-flight tracking dicts between tests.

    ``_inflight_computations``, ``_inflight_results`` and
    ``_inflight_errors`` are module-level singletons in
    ``services.cache``.  Without explicit cleanup, stale entries from a
    previous test can trick the single-flight suppression logic into
    thinking a concurrent computation is already in flight, causing the
    wrapped function to never be called (call_count stays 0).
    """
    _inflight_computations.clear()
    _inflight_results.clear()
    _inflight_errors.clear()
    yield
    _inflight_computations.clear()
    _inflight_results.clear()
    _inflight_errors.clear()


class TestCacheStampedePrevention:
    def setup_method(self):
        # The in-flight single-flight state lives in module-level dicts shared
        # across the suite.  Reset it between tests so stale entries from a
        # previous test (whose cleanup task may have been cancelled when its
        # event loop closed) don't bleed into the next test.
        _inflight_computations.clear()
        _inflight_results.clear()
        _inflight_errors.clear()

    @pytest.mark.asyncio
    async def test_single_flight_suppression_async(self):
        """Test that concurrent cache misses result in only one upstream call"""
        # Create a mock cache service
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get = Mock(return_value=None)
        mock_cache._generate_key = Mock(return_value="test_key")
        mock_cache.set = Mock(return_value=True)

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            # Simulate slow computation
            await asyncio.sleep(0.1)
            return f"result_{arg1}"

        # Temporarily inject cache into function's closure
        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache

            # Launch multiple concurrent calls
            tasks = []
            for i in range(5):
                task = asyncio.create_task(test_func(arg1="value1"))
                tasks.append(task)

            # Wait for all tasks to complete
            results = await asyncio.gather(*tasks)

            # Verify only one call was made to the underlying function
            assert call_count == 1, f"Expected 1 call, got {call_count}"

            # All tasks should get the same result
            for result in results:
                assert result == "result_value1"

            # Verify cache.set was called exactly once
            assert mock_cache.set.call_count == 1

    @pytest.mark.asyncio
    async def test_single_flight_with_cache_hit(self):
        """Test that cache hits don't trigger single-flight logic"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = "cached_result"
        mock_cache._generate_key = Mock(return_value="test_key")

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{arg1}"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache

            # Launch multiple concurrent calls
            tasks = []
            for i in range(5):
                task = asyncio.create_task(test_func(arg1="value1"))
                tasks.append(task)

            results = await asyncio.gather(*tasks)

            # Function should not be called at all (cache hit)
            assert call_count == 0

            # All tasks should get cached result
            for result in results:
                assert result == "cached_result"

    @pytest.mark.asyncio
    async def test_single_flight_error_handling(self):
        """Test that failed computation doesn't block other requests permanently"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")
        mock_cache.set = Mock(return_value=True)

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ValueError("First call fails")
            return f"result_{arg1}_retry"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache

            # First call should fail
            with pytest.raises(ValueError, match="First call fails"):
                await test_func(arg1="value1")

            assert call_count == 1

            # Wait for error cleanup (errors are cleaned up faster)
            await asyncio.sleep(0.15)

            # Second call should retry and succeed
            result = await test_func(arg1="value1")
            assert call_count == 2
            assert result == "result_value1_retry"

    @pytest.mark.asyncio
    async def test_single_flight_cleanup(self):
        """Test that in-flight tracking is cleaned up after computation"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")
        mock_cache.set = Mock(return_value=True)

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{arg1}"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache

            # Make a call
            result1 = await test_func(arg1="value1")
            assert result1 == "result_value1"
            assert call_count == 1

            # Wait for cleanup
            await asyncio.sleep(1.1)

            # Reset mock to return cached value
            mock_cache.get.return_value = "cached_result"

            # Make another call - should hit cache now
            result2 = await test_func(arg1="value1")
            assert result2 == "cached_result"
            assert call_count == 1  # No additional call

    @pytest.mark.asyncio
    async def test_concurrent_different_keys(self):
        """Test that different cache keys don't interfere with each other"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None

        # Mock generate_key to return different keys for different args
        def mock_generate_key(prefix, *args, tags=None, **kwargs):
            arg_value = args[0] if args else kwargs.get("arg1", "default")
            return f"test_key_{arg_value}"

        mock_cache._generate_key = Mock(side_effect=mock_generate_key)
        mock_cache.set = Mock(return_value=True)

        # Use a list with a dictionary to work around nonlocal issues
        call_counts_container = [{"value1": 0, "value2": 0}]

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            call_counts_container[0][arg1] += 1
            await asyncio.sleep(0.05)
            return f"result_{arg1}"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache

            # Launch concurrent calls for different keys
            tasks = [
                asyncio.create_task(test_func(arg1="value1")),
                asyncio.create_task(test_func(arg1="value2")),
                asyncio.create_task(test_func(arg1="value1")),
                asyncio.create_task(test_func(arg1="value2")),
            ]

            results = await asyncio.gather(*tasks)

            # Each unique key should have only one call
            assert call_counts_container[0]["value1"] == 1
            assert call_counts_container[0]["value2"] == 1

            # Verify results
            assert results[0] == "result_value1"
            assert results[1] == "result_value2"
            assert results[2] == "result_value1"
            assert results[3] == "result_value2"
