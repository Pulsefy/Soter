"""
Configuration module for Soter AI Service
Handles environment variables and API key management
"""

from typing import Literal, Optional
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import logging
import os
import secrets

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables

    Environment Variables:
        OPENAI_API_KEY: OpenAI API key for AI model access
        GROQ_API_KEY: Groq API key for AI model access (alternative to OpenAI)
        OPENAI_MODEL: Default OpenAI model for humanitarian verification
        GROQ_MODEL: Default Groq model for humanitarian verification
        AI_DETERMINISTIC_MODE: Enable deterministic AI results for verification and classification during tests/CI
        TEST_PROVIDER_MODE: Enable test provider mode that returns fixture-driven results (no API keys required)
        LLM_TIMEOUT_SECONDS: Timeout for LLM API requests
        APP_ENV: Application environment (development, staging, production, test)
        LOG_LEVEL: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        HOST: Server host (default: 0.0.0.0)
        PORT: Server port (default: 8000)
        REDIS_URL: Redis connection URL for task broker (default: redis://localhost:6379/0)
        BACKEND_WEBHOOK_URL: Webhook URL to notify NestJS backend when tasks complete
        PROOF_OF_LIFE_CONFIDENCE_THRESHOLD: Default threshold for liveness verification
        PROOF_OF_LIFE_MIN_FACE_SIZE: Minimum detected face size in pixels
    """

    # API Keys
    openai_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    groq_model: str = "llama-3.3-70b-versatile"
    ai_deterministic_mode: bool = False
    test_provider_mode: bool = False
    llm_timeout_seconds: int = 30

    # Request throttling
    request_rate_limit: str = "10/minute"

    # Circuit Breaker settings
    circuit_breaker_failure_threshold: int = 3
    circuit_breaker_recovery_timeout_seconds: float = 30.0

    # Cache TTL settings (in seconds)
    cache_ttl_task_status: int = 30  # Short TTL for responsive polling
    cache_ttl_artifact_access: int = 60  # 1 minute for artifact metadata

    # Application settings
    app_env: Literal["development", "staging", "production", "test"] = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8000

    # Redis and Celery settings
    redis_url: str = "redis://localhost:6379/0"
    task_max_retries: int = 3
    task_retry_delay_seconds: int = 30

    # Backend webhook URL for notifications
    backend_webhook_url: Optional[str] = "http://localhost:3001/ai/webhook"

    # Proof-of-life settings
    proof_of_life_confidence_threshold: float = 0.65
    proof_of_life_min_face_size: int = 80

    # Verification artifact access settings
    verification_artifacts_dir: str = "./artifacts/verification"
    verification_artifact_url_ttl_seconds: int = 300
    artifact_signing_secret: str = secrets.token_urlsafe(32)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @model_validator(mode="after")
    def apply_environment_defaults(self) -> "Settings":
        if self.app_env == "staging":
            self.request_rate_limit = "5/minute"
            self.ai_deterministic_mode = True
            if not (self.openai_api_key or self.groq_api_key or self.test_provider_mode):
                self.test_provider_mode = True

        if self.app_env == "test":
            self.request_rate_limit = "5/minute"
            self.ai_deterministic_mode = True
            if not (self.openai_api_key or self.groq_api_key or self.test_provider_mode):
                self.test_provider_mode = True

        if self.app_env == "production":
            if "LOG_LEVEL" not in os.environ:
                self.log_level = "WARNING"
            if self.request_rate_limit == "10/minute":
                self.request_rate_limit = "20/minute"
            if not (self.openai_api_key or self.groq_api_key or self.test_provider_mode):
                raise ValueError(
                    "Production environment requires OPENAI_API_KEY, GROQ_API_KEY, or TEST_PROVIDER_MODE=true"
                )

        return self

    def validate_api_keys(self) -> bool:
        has_key = bool(self.openai_api_key or self.groq_api_key or self.test_provider_mode)
        if not has_key:
            logger.warning("No API keys configured. AI features will be unavailable.")
        return has_key

    def get_active_provider(self) -> Optional[str]:
        if self.test_provider_mode:
            return "test"
        if self.openai_api_key:
            return "openai"
        if self.groq_api_key:
            return "groq"
        return None


settings = Settings()


def get_settings() -> Settings:
    return settings
