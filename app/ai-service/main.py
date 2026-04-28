"""
Soter AI Service - FastAPI Application
Main entry point for the AI service layer.

"""

from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import logging

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.responses import JSONResponse, RedirectResponse, Response
from exceptions import AIServiceError
from schemas.errors import ErrorDetail, ErrorEnvelope
import time
import metrics

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


from api.routes import router as ocr_router

# New versioned router
from api.v1.router import v1_router

from config import settings
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


# ---------------------------------------------------------------------------
# Legacy -> v1 redirect map
# Only routes that were previously registered directly on the app (not via
# the ocr_router) need an explicit redirect entry here.  The OCR route is
# still served by the legacy router above so no redirect is needed for it.
# ---------------------------------------------------------------------------
_LEGACY_TO_V1: dict = {
    "/ai/inference": "/v1/ai/inference",
    "/ai/proof-of-life": "/v1/ai/proof-of-life",
    "/ai/anonymize": "/v1/ai/anonymize",
    "/ai/humanitarian/verify": "/v1/ai/humanitarian/verify",
}

# Prefix-based redirects for parameterised routes (matched in order).
_LEGACY_PREFIX_MAP: list = [
    ("/ai/status/", "/v1/ai/status/"),
    ("/ai/task/", "/v1/ai/task/"),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up Soter AI Service...")
    if not settings.validate_api_keys():
        logger.warning("No API keys configured. AI features will be unavailable.")
    else:
        provider = settings.get_active_provider()
        logger.info(f"AI provider configured: {provider}")

    logger.info(f"Redis configured: {settings.redis_url}")
    logger.info(f"Backend webhook URL: {settings.backend_webhook_url}")

    yield
    logger.info("Shutting down Soter AI Service...")


app = FastAPI(
    title="Soter AI Service",
    description="AI service layer for Soter platform using FastAPI",
    version="1.0.0",
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


# Middleware

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def legacy_redirect_middleware(request: Request, call_next):
    """
    Transparently redirect un-versioned /ai/* paths to their /v1
    equivalents with a 308 Permanent Redirect so that HTTP clients
    preserve the original request method and body.

    The /ai/ocr route is intentionally excluded because it is still
    served directly by the legacy router; the redirect would send clients
    to a /v1/ai/ocr path that also works, but the legacy path remains
    fully functional during the transition period.

    The /ai/metrics path is also excluded - it has no v1 equivalent.
    """
    path = request.url.path

    # Exact-match redirects
    if path in _LEGACY_TO_V1:
        target = _LEGACY_TO_V1[path]
        if request.url.query:
            target = f"{target}?{request.url.query}"
        logger.debug(f"Legacy redirect: {path} -> {target}")
        return RedirectResponse(url=target, status_code=308)

    # Prefix-based redirects (parameterised routes)
    for legacy_prefix, v1_prefix in _LEGACY_PREFIX_MAP:
        if path.startswith(legacy_prefix):
            target = v1_prefix + path[len(legacy_prefix) :]
            if request.url.query:
                target = f"{target}?{request.url.query}"
            logger.debug(f"Legacy prefix redirect: {path} -> {target}")
            return RedirectResponse(url=target, status_code=308)

    return await call_next(request)


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    path = request.url.path

    # Paths that must NEVER be throttled:
    #   /health        – load-balancer probes must always succeed
    #   /              – root discovery endpoint
    #   /docs, /redoc, /openapi.json – API docs
    #   /ai/metrics    – Prometheus scrape (also avoids infinite loop)
    #   Any path in _LEGACY_TO_V1 or matching _LEGACY_PREFIX_MAP – these are
    #     cheap 308 redirects issued by legacy_redirect_middleware; the actual
    #     work happens on the /v1/* destination, which IS subject to throttling.
    _NEVER_THROTTLE = {
        "/health",
        "/",
        "/ai/metrics",
        "/docs",
        "/redoc",
        "/openapi.json",
    }

    is_redirect_path = path in _LEGACY_TO_V1 or any(
        path.startswith(pfx) for pfx, _ in _LEGACY_PREFIX_MAP
    )

    if path in _NEVER_THROTTLE or is_redirect_path:
        return await call_next(request)

    # Gracefully throttle if memory pressure is critical.
    if not metrics.check_system_resources(memory_threshold_percent=90.0):
        metrics.REQUEST_COUNT.labels(
            method=request.method,
            endpoint=path,
            http_status=503,
        ).inc()
        return JSONResponse(
            status_code=503,
            content={
                "detail": (
                    "Service unavailable: System resources (RAM/VRAM) exhausted, "
                    "gracefully throttling."
                )
            },
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
        metrics.REQUEST_COUNT.labels(
            method=request.method,
            endpoint=path,
            http_status=status_code,
        ).inc()
        metrics.REQUEST_LATENCY.labels(method=request.method, endpoint=path).observe(
            latency
        )

        monitored_prefixes = ("/ai/", "/v1/ai/")
        if any(path.startswith(p) for p in monitored_prefixes):
            metrics.logger.info(f"API route {path} latency: {latency:.4f}s")

    return response


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

# Legacy OCR router - still live for backward compatibility (no redirect).
app.include_router(ocr_router)

# Versioned router - canonical home for all routes going forward.
app.include_router(v1_router)


@app.get("/ai/metrics")
async def get_metrics():
    """Endpoint for Prometheus metrics."""
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "soter-ai-service", "version": "1.0.0"}


@app.get("/")
async def root():
    return {
        "service": "Soter AI Service",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "api_v1": "/v1",
    }


# Legacy inline handlers


@app.post("/ai/inference", include_in_schema=False, deprecated=True)
async def _legacy_create_inference_task(
    request: InferenceRequest, background_tasks: BackgroundTasks
):
    """Deprecated - use /v1/ai/inference instead."""
    logger.info(f"[legacy] Creating inference task of type: {request.type}")

    try:
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
            "status_url": f"/v1/ai/status/{task_id}",
        }
    except Exception as e:
        logger.error(f"Failed to create inference task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")


@app.post(
    "/ai/proof-of-life",
    response_model=ProofOfLifeResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_analyze_proof_of_life(request: ProofOfLifeRequest):
    """Deprecated - use /v1/ai/proof-of-life instead."""
    logger.info("[legacy] Processing proof-of-life verification request")

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


@app.post(
    "/ai/anonymize",
    response_model=AnonymizeResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_anonymize_text(request: AnonymizeRequest):
    """Deprecated - use /v1/ai/anonymize instead."""
    logger.info("[legacy] Processing privacy-preserving anonymization request")

    try:
        result = pii_scrubber_service.anonymize(request.text)
        return AnonymizeResponse(success=True, **result)
    except Exception as e:
        logger.error(f"Anonymization failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to anonymize text")


@app.post(
    "/ai/humanitarian/verify",
    response_model=HumanitarianVerificationResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_verify_humanitarian_claim(request: HumanitarianVerificationRequest):
    """Deprecated - use /v1/ai/humanitarian/verify instead."""
    logger.info("[legacy] Processing humanitarian verification request")

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


@app.get(
    "/ai/status/{task_id}",
    response_model=TaskStatusResponse,
    include_in_schema=False,
    deprecated=True,
)
async def _legacy_get_task_status(task_id: str):
    """Deprecated - use /v1/ai/status/{task_id} instead."""
    logger.info(f"[legacy] Checking status for task: {task_id}")

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


@app.post("/ai/task/{task_id}/cancel", include_in_schema=False, deprecated=True)
async def _legacy_cancel_task(task_id: str):
    """Deprecated - use /v1/ai/task/{task_id}/cancel instead."""
    logger.info(f"[legacy] Attempting to cancel task: {task_id}")

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


# ---------------------------------------------------------------------------
# Global error handlers
# ---------------------------------------------------------------------------


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    logger.error(f"HTTP Exception: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorEnvelope(
            error=ErrorDetail(code=f"HTTP_{exc.status_code}", message=str(exc.detail))
        ).model_dump(),
    )


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request, exc: StarletteHTTPException):
    return await http_exception_handler(request, exc)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    logger.error(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="VALIDATION_ERROR",
                message="Request validation failed",
                details=exc.errors(),
            )
        ).model_dump(),
    )


@app.exception_handler(AIServiceError)
async def ai_service_exception_handler(request, exc: AIServiceError):
    logger.error(f"AI service error: {exc.message}", exc_info=True)
    return JSONResponse(
        status_code=502,
        content=ErrorEnvelope(
            error=ErrorDetail(code=exc.code, message=exc.message, details=exc.details)
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content=ErrorEnvelope(
            error=ErrorDetail(code="INTERNAL_SERVER_ERROR", message="Internal server error")
        ).model_dump(),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
