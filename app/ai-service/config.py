"""
Configuration module for Soter AI Service
Handles environment variables and API key management
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional
import logging

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
        LLM_TIMEOUT_SECONDS: Timeout for LLM API requests
        APP_ENV: Application environment (development, staging, production)
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
    llm_timeout_seconds: int = 30
    
    # Application settings
    app_env: str = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8000
    
    # Redis and Celery settings
    redis_url: str = "redis://localhost:6379/0"
    
    # Backend webhook URL for notifications
    backend_webhook_url: Optional[str] = "http://localhost:3001/ai/webhook"

    # Proof-of-life settings
    proof_of_life_confidence_threshold: float = 0.65
    proof_of_life_min_face_size: int = 80
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )
    
    def validate_api_keys(self) -> bool:
        """
        Validate that at least one API key is configured
        
        Returns:
            bool: True if at least one API key is present, False otherwise
        """
        has_key = bool(self.openai_api_key or self.groq_api_key)
        
        if not has_key:
            logger.warning("No API keys configured. AI features will be unavailable.")
        
        return has_key
    
    def get_active_provider(self) -> Optional[str]:
        """
        Determine which AI provider is configured
        
        Returns:
            str: Provider name ('openai', 'groq') or None if not configured
        """
        if self.openai_api_key:
            return "openai"
        elif self.groq_api_key:
            return "groq"
        return None


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """
    Get the global settings instance
    
    Returns:
        Settings: The application settings
    """
    return settings
