"""
Soter AI Service - FastAPI Application
Main entry point for the AI service layer
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import logging
from config import settings
import tasks
from proof_of_life import ProofOfLifeAnalyzer, ProofOfLifeConfig

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
    
    # Log Redis configuration
    logger.info(f"Redis configured: {settings.redis_url}")
    logger.info(f"Backend webhook URL: {settings.backend_webhook_url}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Soter AI Service...")


app = FastAPI(
    title="Soter AI Service",
    description="AI service layer for Soter platform using FastAPI",
    version="0.1.0",
    lifespan=lifespan
)

proof_of_life_analyzer = ProofOfLifeAnalyzer(
    config=ProofOfLifeConfig(
        confidence_threshold=settings.proof_of_life_confidence_threshold,
        min_face_size=settings.proof_of_life_min_face_size,
    )
)


# Request/Response models
class InferenceRequest(BaseModel):
    """Request model for AI inference endpoints"""
    type: str = "inference"
    data: Optional[Dict[str, Any]] = None
    priority: Optional[str] = "normal"


class TaskStatusResponse(BaseModel):
    """Response model for task status"""
    task_id: str
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None


class ProofOfLifeRequest(BaseModel):
    """Request model for proof-of-life selfie and optional burst frames."""

    selfie_image_base64: str
    burst_images_base64: Optional[List[str]] = None
    confidence_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class ProofOfLifeResponse(BaseModel):
    """Response model for proof-of-life analysis."""

    is_real_person: bool
    confidence: float
    threshold: float
    checks: Dict[str, Any]
    reason: str


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


@app.post("/ai/inference")
async def create_inference_task(
    request: InferenceRequest,
    background_tasks: BackgroundTasks
):
    """
    Create a background task for heavy AI inference
    
    This endpoint offloads time-consuming AI tasks to background workers,
    keeping the API responsive. Use the returned task_id to poll for results.
    
    Args:
        request: Inference request containing task type and data
        background_tasks: FastAPI background tasks (for internal use)
    
    Returns:
        dict: Task ID and status
    """
    logger.info(f"Creating inference task of type: {request.type}")
    
    try:
        # Create background task
        task_id = tasks.create_task(
            task_type=request.type,
            payload={
                'data': request.data or {},
                'priority': request.priority or 'normal'
            }
        )

        return {
            "success": True,
            "task_id": task_id,
            "status": "pending",
            "message": "Task queued for processing",
            "status_url": f"/ai/status/{task_id}"
        }

    except Exception as e:
        logger.error(f"Failed to create inference task: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create task: {str(e)}"
        )


@app.post("/ai/proof-of-life", response_model=ProofOfLifeResponse)
async def analyze_proof_of_life(request: ProofOfLifeRequest):
    """
    Analyze a selfie image with optional burst frames for proof-of-life.

    The endpoint returns a boolean `is_real_person` and confidence score.
    If burst frames are provided, the service also checks for basic liveness
    signals such as blink and head movement.
    """
    logger.info("Processing proof-of-life verification request")

    try:
        result = proof_of_life_analyzer.analyze(
            selfie_image_base64=request.selfie_image_base64,
            burst_images_base64=request.burst_images_base64,
            confidence_threshold=request.confidence_threshold,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Proof-of-life processing failed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to process proof-of-life request"
        )


@app.get("/ai/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """
    Get the status of a background task
    
    Poll this endpoint to check if a task has completed. Returns the
    current status: pending, processing, completed, or failed.
    
    Args:
        task_id: Unique identifier for the task
    
    Returns:
        TaskStatusResponse: Current task status and result if completed
    
    Raises:
        HTTPException: If task_id is not found
    """
    logger.info(f"Checking status for task: {task_id}")
    
    try:
        status_info = tasks.get_task_status(task_id)
        
        if status_info.get('status') == 'not_found':
            raise HTTPException(
                status_code=404,
                detail=f"Task {task_id} not found"
            )
        
        return status_info
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get task status: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get task status: {str(e)}"
        )


@app.post("/ai/task/{task_id}/cancel")
async def cancel_task(task_id: str):
    """
    Cancel a pending or processing task
    
    Args:
        task_id: Unique identifier for the task
    
    Returns:
        dict: Cancellation result
    """
    logger.info(f"Attempting to cancel task: {task_id}")
    
    try:
        from celery.result import AsyncResult
        result = AsyncResult(task_id, app=tasks.celery_app)
        result.revoke(terminate=True)
        
        tasks.update_task_status(task_id, 'cancelled')
        
        return {
            "success": True,
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task has been cancelled"
        }
    
    except Exception as e:
        logger.error(f"Failed to cancel task: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel task: {str(e)}"
        )


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
