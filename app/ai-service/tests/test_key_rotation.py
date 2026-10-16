"""Tests for provider API key rotation support (issue #1411)."""

import pytest
from unittest.mock import MagicMock, patch
import httpx

from services.providers import (
    OpenAIProvider,
    GroqProvider,
    is_authentication_error,
)
from exceptions import AIServiceError


class TestAuthenticationErrorDetection:
    """Tests for is_authentication_error helper function."""

    def test_401_is_auth_error(self):
        assert is_authentication_error(401) is True

    def test_403_is_auth_error(self):
        assert is_authentication_error(403) is True

    def test_400_is_not_auth_error(self):
        assert is_authentication_error(400) is False

    def test_429_is_not_auth_error(self):
        assert is_authentication_error(429) is False

    def test_500_is_not_auth_error(self):
        assert is_authentication_error(500) is False

    def test_200_is_not_auth_error(self):
        assert is_authentication_error(200) is False


class TestOpenAIProviderKeyRotation:
    """Tests for OpenAI provider with primary and fallback key retry."""

    def test_primary_success_no_fallback_attempt(self):
        """Primary key authenticates successfully; fallback is not used."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "success"}}],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = OpenAIProvider().llm_chat("sys", "usr")
                assert resp.content == "success"
                assert resp.provider == "openai"

                # Verify that only one request was made (primary key)
                assert mock_client_instance.post.call_count == 1
                call_args = mock_client_instance.post.call_args
                headers = call_args[1]["headers"]
                assert "Bearer primary-key" in headers["Authorization"]

    def test_fallback_success_after_primary_auth_failure(self):
        """Primary key fails with 401; fallback key is attempted and succeeds."""
        # First response: 401 with primary key
        mock_response_401 = MagicMock()
        mock_response_401.status_code = 401
        mock_response_401.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response_401
        )

        # Second response: 200 with fallback key
        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.raise_for_status = MagicMock()
        mock_response_200.json.return_value = {
            "choices": [{"message": {"content": "fallback success"}}],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = [mock_response_401, mock_response_200]

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = OpenAIProvider().llm_chat("sys", "usr")
                assert resp.content == "fallback success"
                assert resp.provider == "openai"

                # Verify that two requests were made (primary + fallback)
                assert mock_client_instance.post.call_count == 2

                # First call with primary key
                first_call = mock_client_instance.post.call_args_list[0]
                headers_1 = first_call[1]["headers"]
                assert "Bearer primary-key" in headers_1["Authorization"]

                # Second call with fallback key
                second_call = mock_client_instance.post.call_args_list[1]
                headers_2 = second_call[1]["headers"]
                assert "Bearer fallback-key" in headers_2["Authorization"]

    def test_fallback_failure_after_primary_auth_failure(self):
        """Both primary and fallback keys fail with 401; error is raised."""
        # Both responses: 401
        mock_response_401 = MagicMock()
        mock_response_401.status_code = 401
        mock_response_401.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response_401
        )

        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = [
            mock_response_401,
            mock_response_401,
        ]

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                with pytest.raises(AIServiceError) as exc_info:
                    OpenAIProvider().llm_chat("sys", "usr")

                assert exc_info.value.code == "AI_PROVIDER_ERROR"
                assert exc_info.value.details["status_code"] == 401

                # Verify that two requests were made (both failed)
                assert mock_client_instance.post.call_count == 2

    def test_no_fallback_configured_no_retry(self):
        """Primary key fails with 401; no fallback configured, error is raised immediately."""
        mock_response_401 = MagicMock()
        mock_response_401.status_code = 401
        mock_response_401.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response_401
        )

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response_401

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = None
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                with pytest.raises(AIServiceError) as exc_info:
                    OpenAIProvider().llm_chat("sys", "usr")

                assert exc_info.value.code == "AI_PROVIDER_ERROR"
                assert exc_info.value.details["status_code"] == 401

                # Verify that only one request was made (no fallback attempt)
                assert mock_client_instance.post.call_count == 1

    def test_403_forbidden_triggers_fallback_retry(self):
        """Primary key fails with 403 Forbidden; fallback is attempted."""
        mock_response_403 = MagicMock()
        mock_response_403.status_code = 403
        mock_response_403.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Forbidden", request=MagicMock(), response=mock_response_403
        )

        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.raise_for_status = MagicMock()
        mock_response_200.json.return_value = {
            "choices": [{"message": {"content": "fallback success"}}],
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = [mock_response_403, mock_response_200]

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = OpenAIProvider().llm_chat("sys", "usr")
                assert resp.content == "fallback success"

                # Verify that two requests were made
                assert mock_client_instance.post.call_count == 2

    def test_non_auth_errors_dont_trigger_fallback(self):
        """Non-auth errors (e.g., rate limit 429) do not trigger fallback retry."""
        mock_response_429 = MagicMock()
        mock_response_429.status_code = 429
        mock_response_429.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Too Many Requests", request=MagicMock(), response=mock_response_429
        )

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response_429

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                with pytest.raises(AIServiceError) as exc_info:
                    OpenAIProvider().llm_chat("sys", "usr")

                assert exc_info.value.code == "AI_PROVIDER_ERROR"
                assert exc_info.value.details["status_code"] == 429

                # Verify that only one request was made (no fallback for non-auth errors)
                assert mock_client_instance.post.call_count == 1

    def test_timeout_doesnt_trigger_fallback(self):
        """Timeout errors do not trigger fallback retry."""
        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = httpx.TimeoutException("Timeout")

        with patch("services.providers.settings") as mock_settings:
            mock_settings.openai_api_key = "primary-key"
            mock_settings.openai_fallback_api_key = "fallback-key"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                with pytest.raises(AIServiceError) as exc_info:
                    OpenAIProvider().llm_chat("sys", "usr")

                assert exc_info.value.code == "AI_TIMEOUT"

                # Verify that only one request was made (no fallback for timeouts)
                assert mock_client_instance.post.call_count == 1


class TestGroqProviderKeyRotation:
    """Tests for Groq provider with primary and fallback key retry."""

    def test_groq_primary_success_no_fallback_attempt(self):
        """Groq primary key succeeds; fallback is not used."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "groq success"}}],
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response

        with patch("services.providers.settings") as mock_settings:
            mock_settings.groq_api_key = "primary-key"
            mock_settings.groq_fallback_api_key = "fallback-key"
            mock_settings.groq_model = "llama-3.3-70b"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = GroqProvider().llm_chat("sys", "usr")
                assert resp.content == "groq success"
                assert resp.provider == "groq"

                # Verify that only one request was made
                assert mock_client_instance.post.call_count == 1

    def test_groq_fallback_success_after_primary_auth_failure(self):
        """Groq primary fails with 401; fallback succeeds."""
        mock_response_401 = MagicMock()
        mock_response_401.status_code = 401
        mock_response_401.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_response_401
        )

        mock_response_200 = MagicMock()
        mock_response_200.status_code = 200
        mock_response_200.raise_for_status = MagicMock()
        mock_response_200.json.return_value = {
            "choices": [{"message": {"content": "groq fallback success"}}],
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.side_effect = [mock_response_401, mock_response_200]

        with patch("services.providers.settings") as mock_settings:
            mock_settings.groq_api_key = "primary-key"
            mock_settings.groq_fallback_api_key = "fallback-key"
            mock_settings.groq_model = "llama-3.3-70b"
            mock_settings.ai_deterministic_mode = False
            mock_settings.llm_timeout_seconds = 30

            with patch("httpx.Client") as MockClient:
                MockClient.return_value.__enter__ = MagicMock(
                    return_value=mock_client_instance
                )
                MockClient.return_value.__exit__ = MagicMock(return_value=False)

                resp = GroqProvider().llm_chat("sys", "usr")
                assert resp.content == "groq fallback success"

                # Verify that two requests were made
                assert mock_client_instance.post.call_count == 2


class TestSettingsKeyReload:
    """Tests for runtime key rotation via Settings.reload_api_keys()."""

    def test_reload_api_keys_from_environment(self):
        """reload_api_keys updates keys from environment variables."""
        from config import Settings

        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "new-openai-key",
                "GROQ_API_KEY": "new-groq-key",
                "OPENAI_FALLBACK_API_KEY": "new-openai-fallback",
                "GROQ_FALLBACK_API_KEY": "new-groq-fallback",
            },
        ):
            # Create a settings instance with old values
            settings_instance = Settings(
                openai_api_key="old-openai-key",
                groq_api_key="old-groq-key",
                openai_fallback_api_key="old-openai-fallback",
                groq_fallback_api_key="old-groq-fallback",
                app_env="test",
            )

            # Verify old values
            assert settings_instance.openai_api_key == "old-openai-key"
            assert settings_instance.groq_api_key == "old-groq-key"

            # Reload keys
            settings_instance.reload_api_keys()

            # Verify new values
            assert settings_instance.openai_api_key == "new-openai-key"
            assert settings_instance.groq_api_key == "new-groq-key"
            assert settings_instance.openai_fallback_api_key == "new-openai-fallback"
            assert settings_instance.groq_fallback_api_key == "new-groq-fallback"

    def test_reload_api_keys_rejects_blank_keys(self):
        """reload_api_keys rejects blank API keys."""
        from config import Settings

        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "   ",  # Blank
                "GROQ_API_KEY": "valid-key",
            },
        ):
            settings_instance = Settings(app_env="test", test_provider_mode=True)

            with pytest.raises(ValueError, match="OPENAI_API_KEY is set but blank"):
                settings_instance.reload_api_keys()

    def test_reload_api_keys_handles_unset_keys(self):
        """reload_api_keys handles unset keys gracefully."""
        from config import Settings

        # No keys set in environment
        import os

        env_copy = os.environ.copy()
        for key in [
            "OPENAI_API_KEY",
            "GROQ_API_KEY",
            "OPENAI_FALLBACK_API_KEY",
            "GROQ_FALLBACK_API_KEY",
        ]:
            os.environ.pop(key, None)

        try:
            settings_instance = Settings(app_env="test", test_provider_mode=True)
            settings_instance.reload_api_keys()

            # All keys should be None
            assert settings_instance.openai_api_key is None
            assert settings_instance.groq_api_key is None
            assert settings_instance.openai_fallback_api_key is None
            assert settings_instance.groq_fallback_api_key is None
        finally:
            # Restore environment
            os.environ.clear()
            os.environ.update(env_copy)

    def test_reload_api_keys_affects_subsequent_provider_calls(self):
        """After reload_api_keys, subsequent provider calls use updated keys."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "test"}}],
        }

        mock_client_instance = MagicMock()
        mock_client_instance.post.return_value = mock_response

        with patch.dict(
            "os.environ",
            {
                "OPENAI_API_KEY": "updated-key",
            },
        ):
            with patch("services.providers.settings") as mock_settings:
                # Initial state
                mock_settings.openai_api_key = "old-key"
                mock_settings.openai_fallback_api_key = None
                mock_settings.ai_deterministic_mode = False
                mock_settings.llm_timeout_seconds = 30

                # Simulate reload by updating the mock
                mock_settings.openai_api_key = "updated-key"

                with patch("httpx.Client") as MockClient:
                    MockClient.return_value.__enter__ = MagicMock(
                        return_value=mock_client_instance
                    )
                    MockClient.return_value.__exit__ = MagicMock(return_value=False)

                    resp = OpenAIProvider().llm_chat("sys", "usr")

                    # Verify the updated key was used
                    call_args = mock_client_instance.post.call_args
                    headers = call_args[1]["headers"]
                    assert "Bearer updated-key" in headers["Authorization"]
