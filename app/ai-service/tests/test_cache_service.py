"""
Tests for the cache service
"""

import pytest
from unittest.mock import Mock, patch
from services.cache import CacheService, cached_response
from config import Settings


@pytest.fixture
def mock_settings():
    """Create mock settings for testing"""
    settings = Mock(spec=Settings)
    settings.redis_url = "redis://localhost:6379/0"
    settings.cache_ttl_task_status = 30
    return settings


@pytest.fixture
def cache_service_with_mock_redis(mock_settings):
    """Create a cache service with mocked Redis client"""
    with patch("services.cache.redis") as mock_redis:
        # Mock successful Redis connection
        mock_client = Mock()
        mock_client.ping.return_value = True
        mock_redis.from_url.return_value = mock_client

        cache = CacheService(mock_settings)
        cache.client = mock_client
        return cache


class TestCacheService:
    def test_cache_service_initialization_success(self, mock_settings):
        """Test that cache service initializes successfully with valid Redis"""
        with patch("services.cache.redis") as mock_redis:
            mock_client = Mock()
            mock_client.ping.return_value = True
            mock_redis.from_url.return_value = mock_client

            cache = CacheService(mock_settings)

            assert cache.enabled is True
            assert cache.client is not None
            mock_client.ping.assert_called_once()

    def test_cache_service_initialization_failure(self, mock_settings):
        """Test that cache service handles Redis connection failure gracefully"""
        with patch("services.cache.redis") as mock_redis:
            mock_redis.from_url.side_effect = Exception("Connection refused")

            cache = CacheService(mock_settings)

            assert cache.enabled is False
            assert cache.client is None

    def test_generate_key_deterministic(self, cache_service_with_mock_redis):
        """Test that cache key generation is deterministic"""
        cache = cache_service_with_mock_redis

        key1 = cache._generate_key("test", "arg1", kwarg1="value1")
        key2 = cache._generate_key("test", "arg1", kwarg1="value1")

        assert key1 == key2
        assert key1.startswith("cache:ai:test:")

    def test_generate_key_different_args(self, cache_service_with_mock_redis):
        """Test that different args generate different keys"""
        cache = cache_service_with_mock_redis

        key1 = cache._generate_key("test", "arg1", kwarg1="value1")
        key2 = cache._generate_key("test", "arg2", kwarg1="value1")

        assert key1 != key2

    def test_get_cache_hit(self, cache_service_with_mock_redis):
        """Test successful cache retrieval"""
        cache = cache_service_with_mock_redis
        cache.client.get.return_value = '{"result": "test_value"}'

        result = cache.get("test_key")

        assert result == {"result": "test_value"}
        cache.client.get.assert_called_once_with("test_key")

    def test_get_cache_miss(self, cache_service_with_mock_redis):
        """Test cache miss returns None"""
        cache = cache_service_with_mock_redis
        cache.client.get.return_value = None

        result = cache.get("test_key")

        assert result is None

    def test_get_handles_errors(self, cache_service_with_mock_redis):
        """Test that get() handles Redis errors gracefully"""
        cache = cache_service_with_mock_redis
        cache.client.get.side_effect = Exception("Redis error")

        result = cache.get("test_key")

        assert result is None

    def test_set_cache(self, cache_service_with_mock_redis):
        """Test successful cache storage"""
        cache = cache_service_with_mock_redis

        result = cache.set("test_key", {"data": "value"}, 300)

        assert result is True
        cache.client.setex.assert_called_once()
        call_args = cache.client.setex.call_args[0]
        assert call_args[0] == "test_key"
        assert call_args[1] == 300
        assert '"data": "value"' in call_args[2]

    def test_set_handles_errors(self, cache_service_with_mock_redis):
        """Test that set() handles Redis errors gracefully"""
        cache = cache_service_with_mock_redis
        cache.client.setex.side_effect = Exception("Redis error")

        result = cache.set("test_key", {"data": "value"}, 300)

        assert result is False

    def test_delete_cache(self, cache_service_with_mock_redis):
        """Test cache key deletion"""
        cache = cache_service_with_mock_redis

        result = cache.delete("test_key")

        assert result is True
        cache.client.delete.assert_called_once_with("test_key")

    def test_delete_pattern(self, cache_service_with_mock_redis):
        """Test pattern-based cache deletion"""
        cache = cache_service_with_mock_redis
        cache.client.scan_iter.return_value = ["key1", "key2", "key3"]
        cache.client.delete.return_value = 3

        result = cache.delete_pattern("cache:ai:*")

        assert result == 3
        cache.client.scan_iter.assert_called_once_with(match="cache:ai:*", count=100)
        cache.client.delete.assert_called_once_with("key1", "key2", "key3")

    def test_cache_disabled_get(self, mock_settings):
        """Test that get() returns None when cache is disabled"""
        cache = CacheService.__new__(CacheService)
        cache.enabled = False
        cache.client = None

        result = cache.get("test_key")

        assert result is None

    def test_cache_disabled_set(self, mock_settings):
        """Test that set() returns False when cache is disabled"""
        cache = CacheService.__new__(CacheService)
        cache.enabled = False
        cache.client = None

        result = cache.set("test_key", {"data": "value"}, 300)

        assert result is False

    def test_generate_key_embeds_tags_literally(self, cache_service_with_mock_redis):
        """Tags should appear in the key so pattern-based invalidation can target them"""
        cache = cache_service_with_mock_redis

        key = cache._generate_key(
            "humanitarian_verification",
            aid_claim="claim",
            tags={
                "artifact_tag": "artifact-123",
                "model_version": "openai:gpt-4o-mini",
            },
        )

        assert "artifact_tag=artifact-123" in key
        assert (
            "model_version=openai:gpt-4o-mini" not in key
        )  # colon is a tag separator, must be sanitized
        assert "model_version=openai_gpt-4o-mini" in key
        assert key.startswith("cache:ai:humanitarian_verification:")

    def test_generate_key_tags_change_key_even_with_same_hash_inputs(
        self, cache_service_with_mock_redis
    ):
        """Two calls with identical hashed args but different tags must not collide"""
        cache = cache_service_with_mock_redis

        key1 = cache._generate_key("test", tags={"artifact_tag": "artifact-a"})
        key2 = cache._generate_key("test", tags={"artifact_tag": "artifact-b"})

        assert key1 != key2

    def test_generate_key_omits_empty_or_none_tags(self, cache_service_with_mock_redis):
        """Tags with no value shouldn't add noise to the key"""
        cache = cache_service_with_mock_redis

        key = cache._generate_key(
            "test", tags={"artifact_tag": "", "model_version": None}
        )

        assert key == cache._generate_key("test", tags=None)

    def test_generate_key_without_tags_is_unchanged(
        self, cache_service_with_mock_redis
    ):
        """Backward compatibility: no tags means the same key shape as before"""
        cache = cache_service_with_mock_redis

        key = cache._generate_key("task_status", "task-1")

        assert key.startswith("cache:ai:task_status:")
        assert key.count(":") == 3  # cache:ai:task_status:<hash>

    def test_sanitize_tag_value_strips_glob_special_characters(self):
        assert CacheService._sanitize_tag_value("a*b?c[d]e:f") == "a_b_c_d_e_f"


class TestCachedResponseDecorator:
    @pytest.mark.asyncio
    async def test_cached_response_async_function_cache_miss(self):
        """Test async function with cache miss"""
        # Create a mock cache service directly
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{arg1}"

        # Temporarily inject cache into function's closure
        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            result = await test_func(arg1="value1")

        assert result == "result_value1"
        assert call_count == 1
        mock_cache.get.assert_called_once()
        mock_cache.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_cached_response_async_function_cache_hit(self):
        """Test async function with cache hit"""
        # Create a mock cache service directly
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

        # Temporarily inject cache into function's closure
        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            result = await test_func("value1")

        assert result == "cached_result"
        assert call_count == 0  # Function not called
        mock_cache.get.assert_called_once()
        mock_cache.set.assert_not_called()

    def test_cached_response_sync_function(self):
        """Test sync function caching"""
        # Create a mock cache service directly
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{arg1}"

        # Temporarily inject cache into function's closure
        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            result = test_func("value1")

        assert result == "result_value1"
        assert call_count == 1
        mock_cache.get.assert_called_once()
        mock_cache.set.assert_called_once()

    @pytest.mark.asyncio
    async def test_cached_response_cache_disabled(self):
        """Test that function executes normally when cache is disabled"""
        # Create a mock cache service that's disabled
        mock_cache = Mock()
        mock_cache.enabled = False

        call_count = 0

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            nonlocal call_count
            call_count += 1
            return f"result_{arg1}"

        # Temporarily inject cache into function's closure
        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            result = await test_func("value1")

        assert result == "result_value1"
        assert call_count == 1
        mock_cache.get.assert_not_called()
        mock_cache.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_cached_response_passes_key_tags_from_kwargs(self):
        """key_tags should promote named kwargs into the literal `tags` used for the key"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")

        @cached_response(
            prefix="test", ttl_seconds=60, key_tags=["artifact_tag", "model_version"]
        )
        async def test_func(aid_claim, artifact_tag, model_version):
            return "result"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            await test_func(
                aid_claim="claim",
                artifact_tag="artifact-1",
                model_version="openai:gpt-4o-mini",
            )

        _, call_kwargs = mock_cache._generate_key.call_args
        assert call_kwargs["tags"] == {
            "artifact_tag": "artifact-1",
            "model_version": "openai:gpt-4o-mini",
        }

    @pytest.mark.asyncio
    async def test_cached_response_without_key_tags_passes_no_tags(self):
        """Existing decorated functions with no key_tags shouldn't get a tags dict"""
        mock_cache = Mock()
        mock_cache.enabled = True
        mock_cache.get.return_value = None
        mock_cache._generate_key = Mock(return_value="test_key")

        @cached_response(prefix="test", ttl_seconds=60)
        async def test_func(arg1):
            return "result"

        with patch("main.app") as mock_app:
            mock_app.state.cache = mock_cache
            await test_func("value1")

        _, call_kwargs = mock_cache._generate_key.call_args
        assert call_kwargs["tags"] is None
