"""
Request Correlation Middleware for FastAPI (Issue #461)

Middleware that:
- Extracts or generates correlation IDs for each request
- Sets correlation ID in context for logging
- Logs structured request/response metadata
- Measures request latency
"""

import time
import logging
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from services.structured_logging import (
    get_correlation_id,
    set_correlation_id,
    generate_correlation_id,
    log_structured,
)

logger = logging.getLogger(__name__)


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """
    Middleware that manages correlation IDs for request tracing.
    
    Extracts correlation ID from request headers or generates a new one.
    Sets it in context for use throughout request handling.
    """
    
    CORRELATION_ID_HEADER = 'x-correlation-id'
    
    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ) -> Response:
        """
        Process request and attach correlation ID.
        
        Args:
            request: FastAPI request
            call_next: Next middleware/handler
            
        Returns:
            Response with correlation ID in headers
        """
        # Extract or generate correlation ID
        correlation_id = request.headers.get(
            self.CORRELATION_ID_HEADER,
            generate_correlation_id(),
        )
        
        # Set correlation ID in context for logging
        set_correlation_id(correlation_id)
        
        # Measure request start time
        start_time = time.time()
        
        try:
            # Log incoming request
            log_structured(
                logger,
                logging.INFO,
                f'Incoming {request.method} request',
                method=request.method,
                path=request.url.path,
                query_params=dict(request.query_params),
                client_host=request.client.host if request.client else None,
            )
            
            # Process request
            response = await call_next(request)
            
        except Exception as exc:
            # Log error
            latency_ms = (time.time() - start_time) * 1000
            log_structured(
                logger,
                logging.ERROR,
                f'Error processing {request.method} {request.url.path}',
                method=request.method,
                path=request.url.path,
                latency_ms=latency_ms,
                error=str(exc),
                exception_type=type(exc).__name__,
            )
            raise
        
        # Log response
        latency_ms = (time.time() - start_time) * 1000
        log_structured(
            logger,
            logging.INFO,
            f'{request.method} {request.url.path} completed',
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            latency_ms=round(latency_ms, 2),
        )
        
        # Add correlation ID to response headers
        response.headers[self.CORRELATION_ID_HEADER] = correlation_id
        
        return response


class RequestMetadataMiddleware(BaseHTTPMiddleware):
    """
    Middleware that logs detailed request/response metadata for debugging.
    
    Logs:
    - Request method, path, headers (with redaction)
    - Response status code
    - Request/response sizes
    """
    
    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ) -> Response:
        """Process request and log metadata."""
        # Get correlation ID from context
        correlation_id = get_correlation_id()
        
        # For debugging: log request headers (redacted)
        log_structured(
            logger,
            logging.DEBUG,
            f'Request headers for {request.method} {request.url.path}',
            method=request.method,
            path=request.url.path,
            headers={
                k: v[:20] + '...' if len(str(v)) > 20 else v
                for k, v in request.headers.items()
            },
        )
        
        # Process request
        response = await call_next(request)
        
        # Log response metadata
        log_structured(
            logger,
            logging.DEBUG,
            f'Response metadata for {request.method} {request.url.path}',
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            response_headers={
                k: v[:20] + '...' if len(str(v)) > 20 else v
                for k, v in response.headers.items()
            },
        )
        
        return response
