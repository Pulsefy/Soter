"""
Structured Logging Module with Correlation ID Support (Issue #461)

This module provides JSON structured logging with:
- Correlation IDs for request tracing
- Automatic PII redaction
- Consistent logging format across the AI service
- Integration with FastAPI
"""

import json
import logging
import uuid
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Dict, Optional
from pythonjsonlogger import jsonlogger
from services.log_redaction import redact_log_data

# Correlation ID context variable for async context propagation
CORRELATION_ID_VAR: ContextVar[Optional[str]] = ContextVar(
    'correlation_id', default=None
)


def get_correlation_id() -> Optional[str]:
    """Get the current correlation ID from context."""
    return CORRELATION_ID_VAR.get()


def set_correlation_id(correlation_id: str) -> None:
    """Set the correlation ID in context."""
    CORRELATION_ID_VAR.set(correlation_id)


def generate_correlation_id() -> str:
    """Generate a new unique correlation ID."""
    return str(uuid.uuid4())


class StructuredJsonFormatter(jsonlogger.JsonFormatter):
    """Custom JSON formatter that adds correlation ID and redacts PII."""
    
    def add_fields(
        self,
        log_record: Dict[str, Any],
        record: logging.LogRecord,
        message_dict: Dict[str, Any],
    ) -> None:
        """Add custom fields to the log record."""
        # Add ISO timestamp
        log_record['timestamp'] = datetime.utcnow().isoformat() + 'Z'
        
        # Add correlation ID if available
        correlation_id = get_correlation_id()
        if correlation_id:
            log_record['correlation_id'] = correlation_id
        
        # Add standard fields
        log_record['level'] = record.levelname
        log_record['logger'] = record.name
        
        # Add exception info if present
        if record.exc_info:
            log_record['exception'] = self.formatException(record.exc_info)
        
        # Apply redaction to the entire log record
        redacted_record = redact_log_data(log_record)
        
        # Update log_record with redacted version
        log_record.clear()
        log_record.update(redacted_record)


def configure_structured_logging(
    log_level: str = logging.INFO,
    logger_name: Optional[str] = None,
) -> logging.Logger:
    """
    Configure structured JSON logging for a logger.
    
    Args:
        log_level: Logging level (default: INFO)
        logger_name: Logger name (default: root logger)
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(logger_name or __name__)
    logger.setLevel(log_level)
    
    # Remove existing handlers
    logger.handlers = []
    
    # Create console handler with JSON formatter
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    
    # Use custom structured JSON formatter
    formatter = StructuredJsonFormatter()
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    
    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger with structured logging configured.
    
    Args:
        name: Logger name (typically __name__)
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    
    # If logger doesn't have handlers, configure it
    if not logger.handlers:
        log_level = logging.INFO
        console_handler = logging.StreamHandler()
        console_handler.setLevel(log_level)
        formatter = StructuredJsonFormatter()
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        logger.setLevel(log_level)
    
    return logger


def log_structured(
    logger: logging.Logger,
    level: int,
    message: str,
    **kwargs: Any,
) -> None:
    """
    Log a structured message with additional context.
    
    PII is automatically redacted.
    
    Args:
        logger: Logger instance
        level: Log level (logging.INFO, logging.ERROR, etc.)
        message: Main log message
        **kwargs: Additional context to log (will be redacted)
    """
    # Redact any PII in the additional context
    redacted_context = redact_log_data(kwargs)
    
    # Log with the redacted context
    logger.log(level, message, extra=redacted_context)


# Module-level logger configured with structured logging
_root_logger = configure_structured_logging(logger_name=None)
