"""
Soter AI Service - FastAPI Application
Main entry point for the AI service layer
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
from config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    logger.info("Starting up Soter AI Service...")
    
    # Validate API keys on startup
    if not settings.validate_api_keys():
        logger.warning("No API keys configured. AI features will be unavailable.")
    else:
        provider = settings.get_active_provider()
        logger.info(f"AI provider configured: {provider}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Soter AI Service...")


app = FastAPI(
    title="Soter AI Service",
    description="AI service layer for Soter platform using FastAPI",
    version="0.1.0",
    lifespan=lifespan
)


@app.get("/health")
async def health_check():
    """
    Health check endpoint to verify service availability
    
    Returns:
        dict: Health status with timestamp and service name
    """
    return {
        "status": "healthy",
        "service": "soter-ai-service",
        "version": "0.1.0"
    }


@app.get("/")
async def root():
    """
    Root endpoint with service information
    """
    return {
        "service": "Soter AI Service",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health"
    }


# Global error handler for HTTP exceptions
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    """
    Global error handler for HTTP exceptions
    
    Args:
        request: The incoming request
        exc: The HTTPException that was raised
        
    Returns:
        JSONResponse: Formatted error response
    """
    logger.error(f"HTTP Exception: {exc.status_code} - {exc.detail}")
    
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "status_code": exc.status_code,
            "detail": exc.detail,
            "service": "soter-ai-service"
        }
    )


# Global error handler for general exceptions
@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    """
    Global error handler for unhandled exceptions
    
    Args:
        request: The incoming request
        exc: The exception that was raised
        
    Returns:
        JSONResponse: Formatted error response
    """
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "status_code": 500,
            "detail": "Internal server error",
            "service": "soter-ai-service"
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
