"""
Configuration module for Soter AI Service
Handles environment variables and API key management
"""

import logging
import os
import re
import secrets
from typing import Dict, List, Literal, Optional

from pydantic import Field, HttpUrl, model_validator
from pydantic_core import PydanticUndefined
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class ConfigurationError(ValueError):
    """Raised when startup configuration is invalid or incomplete.

    The message names *every* offending configuration key at once so
    operators can fix all problems in a single deployment cycle. Secret
    values are never included in the message.
    """


#: Settings fields whose values must never appear in logs or error messages.
_SECRET_FIELDS = frozenset(
    {
        "openai_api_key",
        "groq_api_key",
        "ai_webhook_secret",
        "artifact_signing_secret",
    }
)

_WEBHOOK_SECRET_PLACEHOLDER = "change-me-to-a-strong-random-secret"
_MIN_WEBHOOK_SECRET_LENGTH = 16

# slowapi rate limit strings, e.g. "10/minute".
_RATE_LIMIT_PATTERN: re.Pattern[str] = re.compile(
    r"^\s*\d+\s*/\s*(second|minute|hour)\s*$"
)

_REDIS_SCHEMES = ("redis://", "rediss://", "unix://")


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
        MAX_REQUEST_BODY_BYTES: Maximum request body size for AI endpoints
        MAX_REQUEST_TIMEOUT_SECONDS: Maximum caller-supplied provider timeout
        APP_ENV: Application environment (development, staging, production, test)
        LOG_LEVEL: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        HOST: Server host (default: 0.0.0.0)
        PORT: Server port (default: 8000)
        REDIS_URL: Redis connection URL for task broker (default: redis://localhost:6379/0)
        BACKEND_WEBHOOK_URL: Webhook URL to notify NestJS backend when tasks complete
        PROOF_OF_LIFE_CONFIDENCE_THRESHOLD: Default threshold for liveness verification
        PROOF_OF_LIFE_MIN_FACE_SIZE: Minimum detected face size in pixels
        CACHE_TTL_VERIFICATION: TTL for cached AI verification responses (artifact + model-version keyed)
        FRAUD_PASS_MAX_SCORE: Claims scoring below this are banded 'pass'
        FRAUD_REVIEW_MAX_SCORE: Claims scoring below this (and above pass) are 'review'; at/above it is 'reject'
    """

    # API Keys
    openai_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openai_model: str = "gpt-4o-mini"
    groq_model: str = "llama-3.3-70b-versatile"
    ai_deterministic_mode: bool = False
    test_provider_mode: bool = False
    llm_timeout_seconds: int = 30

    # Per-model USD cost per 1,000 tokens (issue #981), keyed by the exact
    # model string passed to the provider (e.g. OPENAI_MODEL/GROQ_MODEL).
    # Used to derive an estimated cost metric from captured token counts;
    # a model missing from this table simply has no cost estimated for it
    # (not a fabricated 0) — see metrics.estimate_llm_cost_usd. Defaults are
    # illustrative list-price approximations as of this writing, not a
    # billing guarantee; operators should override via
    # LLM_MODEL_COST_PER_1K_TOKENS (a JSON object) to match their actual
    # negotiated/current provider pricing.
    llm_model_cost_per_1k_tokens: Dict[str, Dict[str, float]] = Field(
        default_factory=lambda: {
            "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
            "llama-3.3-70b-versatile": {"prompt": 0.00059, "completion": 0.00079},
        }
    )

    # Request safety limits
    max_request_body_bytes: int = 10 * 1024 * 1024
    max_request_timeout_seconds: float = 60.0

    # Request throttling / Rate limiting
    request_rate_limit: str = "10/minute"
    rate_limit_per_key_default: str = "60/minute"
    rate_limit_endpoint_overrides: Dict[str, str] = Field(
        default_factory=lambda: {
            "/v1/ai/inference": "10/minute",
            "/ai/inference": "10/minute",
            "/v1/ai/ocr/jobs": "10/minute",
            "/ai/ocr/jobs": "10/minute",
            "/v1/ai/humanitarian/verify": "10/minute",
            "/ai/humanitarian/verify": "10/minute",
            "/v1/ai/proof-of-life": "15/minute",
            "/ai/proof-of-life": "15/minute",
            "/v1/ai/anonymize": "30/minute",
            "/ai/anonymize": "30/minute",
            "/v1/ai/fraud/detect": "20/minute",
        }
    )
    rate_limit_enabled: bool = True

    # Circuit Breaker settings
    circuit_breaker_failure_threshold: int = 3
    circuit_breaker_recovery_timeout_seconds: float = 30.0

    # Provider fallback ordering.
    # Explicit, operator-controlled ordering used when a request must fall back
    # across providers (e.g. under ``provider_preference="auto"``). Comma-
    # separated provider names; each must be a known provider and the list is
    # intersected with the providers that are actually available at runtime.
    # Order is preserved, so operators can express e.g. cheapest-first or
    # lowest-latency-first without editing source.
    llm_provider_fallback_order: str = "openai,groq,test"
    ocr_provider_fallback_order: str = "test,tesseract"

    # Load shedding settings
    load_shed_memory_threshold_percent: float = 90.0
    load_shed_max_celery_queue_depth: int = 100

    # Dead-letter replay settings
    dead_letter_max_replay_attempts: int = 5
    dead_letter_replay_cooldown_seconds: float = 10.0
    dead_letter_replay_rate_limit: str = "10/minute"

    # Decision audit settings (issue #990)
    # Every verification/fraud decision is written to a durable, redacted
    # audit record so a disbursement decision can be reconstructed later.
    # See DECISION_AUDIT.md for the record shape and retention guidance.
    decision_audit_enabled: bool = True
    decision_audit_path: str = "./audit/decision_audit.jsonl"
    # Records older than this are dropped by the retention sweep. Set to 0 to
    # keep audit records forever (the compliance-archive configuration).
    decision_audit_retention_days: float = 90.0

    # Cache TTL settings (in seconds)
    cache_ttl_task_status: int = 30  # Short TTL for responsive polling
    cache_ttl_artifact_access: int = 60  # 1 minute for artifact metadata
    cache_ttl_verification: int = (
        120  # AI verification responses, keyed by claim/artifact/model version
    )

    # Fraud detection decision thresholds.
    # A claim's normalised fraud_risk_score (0 = lowest risk, 1 = highest
    # risk) is banded into pass / review / reject. Defaults below were
    # chosen from the calibration report at
    # reports/fraud_threshold_calibration.md, which ran the current model
    # against the fixture set in tests/fixtures/fraud_claims.json:
    # 27/30 fixtures landed in PASS, 1/30 in REVIEW, 2/30 in REJECT.
    # Operators can retune sensitivity via environment variables without a
    # code change; see validate_configuration() for the accepted range.
    fraud_pass_max_score: float = 0.40
    fraud_review_max_score: float = 0.75

    # Application settings
    app_env: Literal["development", "staging", "production", "test"] = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8000
    drain_timeout_seconds: int = 30

    # Redis and Celery settings
    redis_url: str = "redis://localhost:6379/0"
    task_max_retries: int = 3
    task_retry_delay_seconds: int = 30

    # Backend webhook URL for notifications
    backend_webhook_url: HttpUrl = (
        "http://localhost:3000/api/v1/webhooks/ai-verification"
    )

    # Shared HMAC secret for signing outbound webhook payloads.
    # Must match AI_WEBHOOK_SECRET on the NestJS backend.
    # If unset, webhook calls are sent unsigned (development only).
    ai_webhook_secret: Optional[str] = None

    # Proof-of-life settings
    proof_of_life_confidence_threshold: float = 0.65
    proof_of_life_min_face_size: int = 80

    # Verification artifact access settings
    verification_artifacts_dir: str = "./artifacts/verification"
    verification_artifact_url_ttl_seconds: int = 300
    artifact_signing_secret: str = secrets.token_urlsafe(32)

    # CORS configuration
    # Comma-separated list of allowed origins for production
    cors_allowed_origins: str = ""
    # Allow Vercel preview deployments (pattern: *.vercel.app)
    cors_allow_vercel_previews: bool = True
    # Additional custom origins (comma-separated)
    cors_custom_origins: str = ""

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
            if not (
                self.openai_api_key or self.groq_api_key or self.test_provider_mode
            ):
                self.test_provider_mode = True

        if self.app_env == "test":
            self.request_rate_limit = "5/minute"
            self.ai_deterministic_mode = True
            if not (
                self.openai_api_key or self.groq_api_key or self.test_provider_mode
            ):
                self.test_provider_mode = True

        if self.app_env == "production":
            if "LOG_LEVEL" not in os.environ:
                self.log_level = "WARNING"
            if self.request_rate_limit == "10/minute":
                self.request_rate_limit = "20/minute"
            if not (
                self.openai_api_key or self.groq_api_key or self.test_provider_mode
            ):
                raise ValueError(
                    "Production environment requires OPENAI_API_KEY, GROQ_API_KEY, or TEST_PROVIDER_MODE=true"
                )

        return self

    def validate_api_keys(self) -> bool:
        has_key = bool(
            self.openai_api_key or self.groq_api_key or self.test_provider_mode
        )
        if not has_key:
            logger.warning("No API keys configured. AI features will be unavailable.")
        return has_key

    def validate_configuration(self) -> None:
        """Validate the full configuration, raising on the first pass.

        Every missing or malformed key is collected and reported together so
        a single boot attempt surfaces all problems. Error messages name
        configuration keys only - secret values are never included.

        Raises:
            ConfigurationError: if any required or optional-but-set value is
                invalid. The service must not start serving in that case.
        """
        errors: list[str] = []

        def _add(key: str, problem: str) -> None:
            errors.append(f"{key}: {problem}")

        # --- Provider keys: set-but-blank is malformed -------------------
        if self.openai_api_key is not None and not self.openai_api_key.strip():
            _add("OPENAI_API_KEY", "is set but blank")
        if self.groq_api_key is not None and not self.groq_api_key.strip():
            _add("GROQ_API_KEY", "is set but blank")

        # --- Callback/webhook signing secret -----------------------------
        if self.ai_webhook_secret is not None:
            webhook_secret = self.ai_webhook_secret.strip()
            if not webhook_secret:
                _add("AI_WEBHOOK_SECRET", "is set but blank")
            elif webhook_secret == _WEBHOOK_SECRET_PLACEHOLDER:
                _add(
                    "AI_WEBHOOK_SECRET",
                    "is still set to the example placeholder value; generate a "
                    "strong random secret instead",
                )
            elif len(webhook_secret) < _MIN_WEBHOOK_SECRET_LENGTH:
                _add(
                    "AI_WEBHOOK_SECRET",
                    f"must be at least {_MIN_WEBHOOK_SECRET_LENGTH} characters",
                )

        # --- Redis URL scheme --------------------------------------------
        # Never echo the URL itself - it may embed credentials.
        redis_url = str(self.redis_url)
        if not redis_url.startswith(_REDIS_SCHEMES):
            scheme = redis_url.split("://", 1)[0] if "://" in redis_url else "<none>"
            _add(
                "REDIS_URL",
                f"must use one of {', '.join(_REDIS_SCHEMES)} schemes "
                f"(got '{scheme}://')",
            )

        # --- Rate limit strings consumed by slowapi ----------------------
        for key, rate_limit in (
            ("REQUEST_RATE_LIMIT", self.request_rate_limit),
            ("DEAD_LETTER_REPLAY_RATE_LIMIT", self.dead_letter_replay_rate_limit),
        ):
            if not _RATE_LIMIT_PATTERN.match(str(rate_limit)):
                _add(
                    key,
                    f"must match '<count>/(second|minute|hour)' (got {rate_limit!r})",
                )

        # --- Numeric settings must be positive ---------------------------
        positive_numeric_settings = (
            ("LLM_TIMEOUT_SECONDS", self.llm_timeout_seconds),
            ("MAX_REQUEST_BODY_BYTES", self.max_request_body_bytes),
            ("MAX_REQUEST_TIMEOUT_SECONDS", self.max_request_timeout_seconds),
            ("CACHE_TTL_TASK_STATUS", self.cache_ttl_task_status),
            ("CACHE_TTL_ARTIFACT_ACCESS", self.cache_ttl_artifact_access),
            ("CACHE_TTL_VERIFICATION", self.cache_ttl_verification),
            ("TASK_RETRY_DELAY_SECONDS", self.task_retry_delay_seconds),
            (
                "VERIFICATION_ARTIFACT_URL_TTL_SECONDS",
                self.verification_artifact_url_ttl_seconds,
            ),
            ("PROOF_OF_LIFE_MIN_FACE_SIZE", self.proof_of_life_min_face_size),
        )
        for key, value in positive_numeric_settings:
            if value <= 0:
                _add(key, f"must be a positive number (got {value})")

        # --- Decision audit retention (issue #990) -----------------------
        # 0 is a valid, documented value meaning "retain forever", so this
        # setting is checked for non-negativity rather than positivity.
        if self.decision_audit_retention_days < 0:
            _add(
                "DECISION_AUDIT_RETENTION_DAYS",
                "must be 0 (retain forever) or a positive number of days "
                f"(got {self.decision_audit_retention_days})",
            )
        if self.decision_audit_enabled and not str(self.decision_audit_path).strip():
            _add("DECISION_AUDIT_PATH", "must not be blank when auditing is enabled")

        # --- Bounded numeric settings ------------------------------------
        if not 0.0 <= self.proof_of_life_confidence_threshold <= 1.0:
            _add(
                "PROOF_OF_LIFE_CONFIDENCE_THRESHOLD",
                f"must be between 0.0 and 1.0 (got {self.proof_of_life_confidence_threshold})",
            )
        if not 1 <= int(self.port) <= 65535:
            _add("PORT", f"must be between 1 and 65535 (got {self.port})")

        # --- Fraud detection thresholds -----------------------------------
        if not 0.0 <= self.fraud_pass_max_score <= 1.0:
            _add(
                "FRAUD_PASS_MAX_SCORE",
                f"must be between 0.0 and 1.0 (got {self.fraud_pass_max_score})",
            )
        if not 0.0 <= self.fraud_review_max_score <= 1.0:
            _add(
                "FRAUD_REVIEW_MAX_SCORE",
                f"must be between 0.0 and 1.0 (got {self.fraud_review_max_score})",
            )
        if self.fraud_pass_max_score >= self.fraud_review_max_score:
            _add(
                "FRAUD_PASS_MAX_SCORE / FRAUD_REVIEW_MAX_SCORE",
                "FRAUD_PASS_MAX_SCORE must be strictly less than "
                f"FRAUD_REVIEW_MAX_SCORE (got {self.fraud_pass_max_score} >= "
                f"{self.fraud_review_max_score})",
            )

        # --- CORS origins: entries must be absolute origins --------------
        for key, raw in (
            ("CORS_ALLOWED_ORIGINS", self.cors_allowed_origins),
            ("CORS_CUSTOM_ORIGINS", self.cors_custom_origins),
        ):
            for entry in raw.split(","):
                entry = entry.strip()
                if not entry:
                    continue
                if not entry.startswith(("http://", "https://")):
                    _add(key, "origin entries must start with http:// or https://")
                    break

        # --- Provider fallback ordering ----------------------------------
        # Imported lazily to avoid a circular import (config -> providers ->
        # config). The known-provider sets live next to the registry so they
        # remain the single source of truth.
        from services.providers import validate_fallback_order

        for key, order in (
            ("LLM_PROVIDER_FALLBACK_ORDER", self.get_llm_fallback_order()),
            ("OCR_PROVIDER_FALLBACK_ORDER", self.get_ocr_fallback_order()),
        ):
            try:
                validate_fallback_order(key, order)
            except ValueError as exc:
                _add(key, str(exc))

        # --- Per-model LLM cost rates --------------------------------------
        for model_name, rates in self.llm_model_cost_per_1k_tokens.items():
            for direction in ("prompt", "completion"):
                rate = rates.get(direction)
                if rate is None:
                    _add(
                        "LLM_MODEL_COST_PER_1K_TOKENS",
                        f"model '{model_name}' is missing a '{direction}' rate",
                    )
                elif rate < 0:
                    _add(
                        "LLM_MODEL_COST_PER_1K_TOKENS",
                        f"model '{model_name}' has a negative '{direction}' rate",
                    )

        # --- Production requirements (defense in depth) ------------------
        # apply_environment_defaults already rejects this at construction
        # time; re-checking here keeps validate_configuration() authoritative.
        if self.app_env == "production" and not (
            self.openai_api_key or self.groq_api_key or self.test_provider_mode
        ):
            _add(
                "OPENAI_API_KEY / GROQ_API_KEY / TEST_PROVIDER_MODE",
                "production requires at least one provider API key or "
                "TEST_PROVIDER_MODE=true",
            )

        if errors:
            summary = "\n  - ".join(errors)
            logger.error(
                "configuration_validation_failed error_count=%d invalid_keys=%s",
                len(errors),
                ", ".join(error.split(":", 1)[0] for error in errors),
            )
            raise ConfigurationError(f"Invalid configuration:\n  - {summary}")

    def report_boot_configuration(
        self, logger_: Optional[logging.Logger] = None
    ) -> None:
        """Log the effective configuration at DEBUG level on boot.

        Optional values that are still at their declared defaults are
        reported explicitly so operators can see which knobs were left
        untouched. Secret-valued fields are never logged - only whether they
        are set - consistent with ``logging_redaction.py``.
        """
        log = logger_ or logger

        for name, field in type(self).model_fields.items():
            display_name = name.upper()
            if name in _SECRET_FIELDS:
                state = "<set>" if getattr(self, name) else "<unset>"
                log.debug("config %s=%s", display_name, state)
                continue
            value = getattr(self, name)
            default = field.default
            if default is PydanticUndefined:
                continue
            # str() on both sides keeps the comparison stable when pydantic
            # coerced the raw default into a richer type (e.g. HttpUrl).
            if value == default or str(value) == str(default):
                log.debug("config default %s=%r", display_name, value)

    def get_active_provider(self) -> Optional[str]:
        if self.test_provider_mode:
            return "test"
        if self.openai_api_key:
            return "openai"
        if self.groq_api_key:
            return "groq"
        return None

    @staticmethod
    def _parse_fallback_order(raw: str) -> List[str]:
        return [entry.strip() for entry in raw.split(",") if entry.strip()]

    def get_llm_fallback_order(self) -> List[str]:
        """Parsed, ordered LLM provider fallback list from configuration."""
        return self._parse_fallback_order(self.llm_provider_fallback_order)

    def get_ocr_fallback_order(self) -> List[str]:
        """Parsed, ordered OCR provider fallback list from configuration."""
        return self._parse_fallback_order(self.ocr_provider_fallback_order)

    def get_cors_allowed_origins(self) -> list[str]:
        """
        Build the list of allowed CORS origins based on configuration.

        Returns:
            List of allowed origins including:
            - Production origins from cors_allowed_origins
            - Vercel preview deployments if cors_allow_vercel_previews is True
            - Custom origins from cors_custom_origins
        """
        origins = []

        # Add production origins
        if self.cors_allowed_origins:
            origins.extend(
                [
                    origin.strip()
                    for origin in self.cors_allowed_origins.split(",")
                    if origin.strip()
                ]
            )

        # Add Vercel preview pattern if enabled
        if self.cors_allow_vercel_previews:
            origins.append("https://*.vercel.app")
            origins.append("https://*.vercel.app:*")

        # Add custom origins
        if self.cors_custom_origins:
            origins.extend(
                [
                    origin.strip()
                    for origin in self.cors_custom_origins.split(",")
                    if origin.strip()
                ]
            )

        # Always allow localhost for development
        if self.app_env == "development":
            origins.extend(
                [
                    "http://localhost:3000",
                    "http://localhost:3001",
                    "http://127.0.0.1:3000",
                ]
            )

        return origins

    def is_origin_allowed(self, origin: str) -> bool:
        """
        Check if a given origin is allowed based on CORS configuration.

        Args:
            origin: The Origin header value to check

        Returns:
            True if origin is allowed, False otherwise
        """
        if not origin:
            return False

        allowed_origins = self.get_cors_allowed_origins()

        for allowed in allowed_origins:
            # Handle wildcard patterns (e.g., https://*.vercel.app)
            if "*" in allowed:
                pattern = allowed.replace("*", '[^"]*')
                import re

                if re.match(f"^{pattern}$", origin):
                    return True
            # Exact match
            elif origin == allowed:
                return True

        return False


settings = Settings()


def get_settings() -> Settings:
    return settings
