"""
Tests for CORS allowlist-based configuration and middleware.

Tests cover:
- Configuration methods for allowed origins
- Origin validation with wildcard patterns
- CORS middleware behavior
- Sensitive endpoint protection
- Vercel preview deployment support
- Production origin allowlist
"""

import pytest
from unittest.mock import patch

# Import config directly for configuration tests
try:
    from config import Settings
except ImportError:
    pytest.skip("Cannot import config module", allow_module_level=True)

# Import TestClient for middleware tests (only used if app can be imported)
TestClient = None
try:
    from fastapi.testclient import TestClient as _TestClient
    TestClient = _TestClient
except ImportError:
    pass


class TestCORSConfiguration:
    """Test CORS configuration methods."""

    def test_get_cors_allowed_origins_development(self):
        """Test that development environment includes localhost."""
        settings = Settings(
            app_env="development",
            cors_allowed_origins="",
            cors_allow_vercel_previews=True,
            cors_custom_origins="",
        )
        origins = settings.get_cors_allowed_origins()
        assert "http://localhost:3000" in origins
        assert "http://localhost:3001" in origins
        assert "http://127.0.0.1:3000" in origins
        assert "https://*.vercel.app" in origins

    def test_get_cors_allowed_origins_production(self):
        """Test that production environment uses configured origins."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com,https://app.example.com",
            cors_allow_vercel_previews=True,
            cors_custom_origins="https://custom.example.org",
        )
        origins = settings.get_cors_allowed_origins()
        assert "https://example.com" in origins
        assert "https://app.example.com" in origins
        assert "https://custom.example.org" in origins
        assert "https://*.vercel.app" in origins
        # Localhost should NOT be in production
        assert "http://localhost:3000" not in origins

    def test_get_cors_allowed_origins_vercel_disabled(self):
        """Test that Vercel previews can be disabled."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        origins = settings.get_cors_allowed_origins()
        assert "https://example.com" in origins
        assert "https://*.vercel.app" not in origins

    def test_get_cors_allowed_origins_empty_config(self):
        """Test behavior with empty configuration."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        origins = settings.get_cors_allowed_origins()
        assert origins == []

    def test_is_origin_allowed_exact_match(self):
        """Test exact origin matching."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        assert settings.is_origin_allowed("https://example.com") is True
        assert settings.is_origin_allowed("https://other.com") is False

    def test_is_origin_allowed_vercel_wildcard(self):
        """Test Vercel preview wildcard pattern matching."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="",
            cors_allow_vercel_previews=True,
            cors_custom_origins="",
        )
        assert settings.is_origin_allowed("https://abc123.vercel.app") is True
        assert settings.is_origin_allowed("https://my-app.vercel.app") is True
        assert settings.is_origin_allowed("https://evil.com") is False

    def test_is_origin_allowed_empty_origin(self):
        """Test that empty origin is rejected."""
        settings = Settings(
            app_env="development",
            cors_allowed_origins="",
            cors_allow_vercel_previews=True,
            cors_custom_origins="",
        )
        assert settings.is_origin_allowed("") is False
        assert settings.is_origin_allowed(None) is False

    def test_is_origin_allowed_localhost_development(self):
        """Test localhost is allowed in development."""
        settings = Settings(
            app_env="development",
            cors_allowed_origins="",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        assert settings.is_origin_allowed("http://localhost:3000") is True
        assert settings.is_origin_allowed("http://127.0.0.1:3000") is True

    def test_is_origin_allowed_localhost_production(self):
        """Test localhost is NOT allowed in production."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        assert settings.is_origin_allowed("http://localhost:3000") is False


class TestCORSMiddleware:
    """Test CORS middleware behavior."""

    @pytest.fixture
    def client(self):
        """Create a test client with CORS middleware."""
        if TestClient is None:
            pytest.skip("TestClient not available - fastapi not installed")
        try:
            from main import app
            return TestClient(app)
        except ImportError:
            pytest.skip("Cannot import main app - dependencies not available")

    def test_cors_headers_allowed_origin(self, client):
        """Test that allowed origins receive CORS headers."""
        with patch("config.Settings.is_origin_allowed", return_value=True):
            response = client.get(
                "/health",
                headers={"Origin": "https://example.com"}
            )
            assert response.status_code == 200
            assert "access-control-allow-origin" in response.headers
            assert response.headers["access-control-allow-origin"] == "https://example.com"

    def test_cors_headers_disallowed_origin(self, client):
        """Test that disallowed origins do not receive CORS headers."""
        with patch("config.Settings.is_origin_allowed", return_value=False):
            response = client.get(
                "/health",
                headers={"Origin": "https://evil.com"}
            )
            assert response.status_code == 200
            assert "access-control-allow-origin" not in response.headers

    def test_cors_preflight_allowed(self, client):
        """Test preflight request for allowed origin."""
        with patch("config.Settings.is_origin_allowed", return_value=True):
            response = client.options(
                "/health",
                headers={
                    "Origin": "https://example.com",
                    "Access-Control-Request-Method": "GET",
                }
            )
            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == "https://example.com"
            assert "GET" in response.headers["access-control-allow-methods"]
            assert "access-control-allow-credentials" in response.headers

    def test_cors_preflight_disallowed(self, client):
        """Test preflight request for disallowed origin."""
        with patch("config.Settings.is_origin_allowed", return_value=False):
            response = client.options(
                "/health",
                headers={
                    "Origin": "https://evil.com",
                    "Access-Control-Request-Method": "GET",
                }
            )
            assert response.status_code == 204
            assert "access-control-allow-origin" not in response.headers

    def test_cors_no_origin_header(self, client):
        """Test request without Origin header (same-origin or non-browser)."""
        response = client.get("/health")
        assert response.status_code == 200
        # No CORS headers needed when no Origin header
        assert "access-control-allow-origin" not in response.headers


class TestSensitiveEndpointCORSProtection:
    """Test that sensitive endpoints reject CORS."""

    @pytest.fixture
    def client(self):
        """Create a test client with CORS middleware."""
        if TestClient is None:
            pytest.skip("TestClient not available - fastapi not installed")
        try:
            from main import app
            return TestClient(app)
        except ImportError:
            pytest.skip("Cannot import main app - dependencies not available")

    def test_sensitive_endpoint_rejects_cors(self, client):
        """Test that sensitive artifact endpoints reject CORS entirely."""
        with patch("config.Settings.is_origin_allowed", return_value=True):
            response = client.post(
                "/v1/ai/verification-artifacts/test/access",
                json={"mode": "signed_url"},
                headers={
                    "Origin": "https://example.com",
                    "X-User-Role": "admin",
                    "X-Org-Id": "org123",
                    "X-User-Id": "user123",
                }
            )
            assert response.status_code == 403
            assert "CORS_NOT_ALLOWED" in response.text

    def test_sensitive_endpoint_allows_no_origin(self, client):
        """Test that sensitive endpoints work without Origin header (direct calls)."""
        # This should not be rejected by CORS middleware
        # It may fail for other reasons (missing auth, etc), but not CORS
        response = client.post(
            "/v1/ai/verification-artifacts/test/access",
            json={"mode": "signed_url"},
            headers={
                "X-User-Role": "admin",
                "X-Org-Id": "org123",
                "X-User-Id": "user123",
            }
        )
        # Should not be 403 from CORS
        assert response.status_code != 403 or "CORS_NOT_ALLOWED" not in response.text

    def test_non_sensitive_endpoint_allows_cors(self, client):
        """Test that non-sensitive endpoints allow CORS for allowed origins."""
        with patch("config.Settings.is_origin_allowed", return_value=True):
            response = client.get(
                "/health",
                headers={"Origin": "https://example.com"}
            )
            assert response.status_code == 200
            assert response.headers["access-control-allow-origin"] == "https://example.com"


class TestVercelPreviewSupport:
    """Test Vercel preview deployment support."""

    def test_vercel_preview_pattern_matching(self):
        """Test that Vercel preview URLs match wildcard pattern."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="",
            cors_allow_vercel_previews=True,
            cors_custom_origins="",
        )
        
        # Valid Vercel preview URLs
        assert settings.is_origin_allowed("https://abc123.vercel.app") is True
        assert settings.is_origin_allowed("https://my-project-xyz.vercel.app") is True
        assert settings.is_origin_allowed("https://deploy-preview-123.vercel.app") is True
        
        # Invalid URLs
        assert settings.is_origin_allowed("https://evil.com") is False
        assert settings.is_origin_allowed("https://vercel.app.evil.com") is False
        assert settings.is_origin_allowed("http://abc123.vercel.app") is False  # Wrong scheme

    def test_vercel_preview_disabled(self):
        """Test that Vercel previews can be disabled."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        
        assert settings.is_origin_allowed("https://abc123.vercel.app") is False
        assert settings.is_origin_allowed("https://example.com") is True


class TestProductionOriginAllowlist:
    """Test production origin allowlist functionality."""

    def test_multiple_production_origins(self):
        """Test that multiple production origins are supported."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://app.example.com,https://admin.example.com,https://api.example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        
        assert settings.is_origin_allowed("https://app.example.com") is True
        assert settings.is_origin_allowed("https://admin.example.com") is True
        assert settings.is_origin_allowed("https://api.example.com") is True
        assert settings.is_origin_allowed("https://other.com") is False

    def test_custom_origins(self):
        """Test that custom origins are supported."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="https://staging.example.com,https://partner.example.org",
        )
        
        assert settings.is_origin_allowed("https://example.com") is True
        assert settings.is_origin_allowed("https://staging.example.com") is True
        assert settings.is_origin_allowed("https://partner.example.org") is True
        assert settings.is_origin_allowed("https://other.com") is False

    def test_origin_whitespace_handling(self):
        """Test that whitespace in origin lists is handled correctly."""
        settings = Settings(
            app_env="production",
            test_provider_mode=True,
            cors_allowed_origins="https://example.com , https://app.example.com , https://admin.example.com",
            cors_allow_vercel_previews=False,
            cors_custom_origins="",
        )
        
        assert settings.is_origin_allowed("https://example.com") is True
        assert settings.is_origin_allowed("https://app.example.com") is True
        assert settings.is_origin_allowed("https://admin.example.com") is True
