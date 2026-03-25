"""
Soter AI Service - FastAPI Application
Main entry point for the AI service layer
"""

from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import logging

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse, Response
import time
import metrics

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from api.routes import router as ocr_router
from config import settings
from middleware import HMACAuthMiddleware
import tasks
from proof_of_life import ProofOfLifeAnalyzer, ProofOfLifeConfig
from schemas.anonymization import AnonymizeRequest, AnonymizeResponse
from services.pii_scrubber import PIIScrubberService
from schemas.humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)
from services.humanitarian_verification import HumanitarianVerificationService

limiter = Limiter(key_func=get_remote_address)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Soter AI Service...")
    if not settings.validate_api_keys():
        logger.warning("No API keys configured. AI features will be unavailable.")
    else:
        provider = settings.get_active_provider()
        logger.info(f"AI provider configured: {provider}")

    # Log Redis configuration
    logger.info(f"Redis configured: {settings.redis_url}")
    logger.info(f"Backend webhook URL: {settings.backend_webhook_url}")

    yield
    logger.info("Shutting down Soter AI Service...")


app = FastAPI(
    title="Soter AI Service",
    description="AI service layer for Soter platform using FastAPI",
    version="0.1.0",
    lifespan=lifespan,
)

proof_of_life_analyzer = ProofOfLifeAnalyzer(
    config=ProofOfLifeConfig(
        confidence_threshold=settings.proof_of_life_confidence_threshold,
        min_face_size=settings.proof_of_life_min_face_size,
    )
)
pii_scrubber_service = PIIScrubberService()
humanitarian_verification_service = HumanitarianVerificationService()


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


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(HMACAuthMiddleware)

app.include_router(ocr_router)


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    # Skip checking metrics endpoint to avoid infinite loop / log spam
    if request.url.path == "/ai/metrics":
        return await call_next(request)

    # Automatically Throttle if over 90%
    if not metrics.check_system_resources(memory_threshold_percent=90.0):
        # Gracefully throttle requests if exhausting resources
        metrics.REQUEST_COUNT.labels(method=request.method, endpoint=request.url.path, http_status=503).inc()
        return JSONResponse(
            status_code=503,
            content={"detail": "Service unavailable: System resources (RAM/VRAM) exhausted, gracefully throttling."}
        )

    start_time = time.time()
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception as e:
        status_code = 500
        raise e
    finally:
        latency = time.time() - start_time
        metrics.REQUEST_COUNT.labels(method=request.method, endpoint=request.url.path, http_status=status_code).inc()
        metrics.REQUEST_LATENCY.labels(method=request.method, endpoint=request.url.path).observe(latency)
        
        # General API request latency logging (model inference logging happens inside the service / tasks layer)
        if request.url.path.startswith("/ai/") and request.url.path != "/ai/metrics":
            metrics.logger.info(f"API route {request.url.path} latency: {latency:.4f}s")
            
    return response


@app.get("/ai/metrics")
async def get_metrics():
    """Endpoint for Prometheus metrics."""
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "soter-ai-service", "version": "0.1.0"}


@app.get("/")
async def root():
    return {
        "service": "Soter AI Service",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.post("/ai/inference")
async def create_inference_task(
    request: InferenceRequest, background_tasks: BackgroundTasks
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
                "data": request.data or {},
                "priority": request.priority or "normal",
            },
        )

        return {
            "success": True,
            "task_id": task_id,
            "status": "pending",
            "message": "Task queued for processing",
            "status_url": f"/ai/status/{task_id}",
        }

    except Exception as e:
        logger.error(f"Failed to create inference task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")


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
            status_code=500, detail="Failed to process proof-of-life request"
        )


@app.post("/ai/anonymize", response_model=AnonymizeResponse)
async def anonymize_text(request: AnonymizeRequest):
    """Anonymize names, locations, and dates before text is sent to external LLMs."""
    logger.info("Processing privacy-preserving anonymization request")

    try:
        result = pii_scrubber_service.anonymize(request.text)
        return AnonymizeResponse(success=True, **result)
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")


@app.post("/ai/humanitarian/verify", response_model=HumanitarianVerificationResponse)
async def verify_humanitarian_claim(request: HumanitarianVerificationRequest):
    """Verify an aid claim against standardized humanitarian criteria."""
    logger.info("Processing humanitarian verification request")

    try:
        result = humanitarian_verification_service.verify_claim(
            aid_claim=request.aid_claim,
            supporting_evidence=request.supporting_evidence,
            context_factors=request.context_factors,
            provider_preference=request.provider_preference,
        )
        return HumanitarianVerificationResponse(success=True, **result)
    except Exception as e:
        logger.error("Humanitarian verification failed: %s", str(e), exc_info=True)
        return HumanitarianVerificationResponse(success=False, error=str(e))


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

        if status_info.get("status") == "not_found":
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

        return status_info

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get task status: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Failed to get task status: {str(e)}"
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

        result = AsyncResult(task_id, app=tasks.get_celery_app())
        result.revoke(terminate=True)

        tasks.update_task_status(task_id, "cancelled")

        return {
            "success": True,
            "task_id": task_id,
            "status": "cancelled",
            "message": "Task has been cancelled",
        }

    except Exception as e:
        logger.error(f"Failed to cancel task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel task: {str(e)}")


# Global error handler for HTTP exceptions
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    logger.error(f"HTTP Exception: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "status_code": exc.status_code,
            "detail": exc.detail,
            "service": "soter-ai-service",
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "status_code": 500,
            "detail": "Internal server error",
            "service": "soter-ai-service",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
