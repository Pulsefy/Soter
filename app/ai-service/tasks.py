"""
Celery tasks for Soter AI Service
Handles background task processing for heavy inference
"""

import logging
import os
import uuid
import time
from typing import Any, Dict, Optional
from celery import Celery
from celery.result import AsyncResult
from celery.schedules import crontab
import httpx

import metrics
from config import settings
from schemas.callback import AiCallbackPayload, CallbackStatus
from services.load_shedder import ensure_queue_capacity
from services.pii_scrubber import PIIScrubberService
from services.humanitarian_verification import HumanitarianVerificationService
from services.ocr_job import run_ocr_from_base64
from services.dead_letter import dead_letter_queue

# Configure logging
logger = logging.getLogger(__name__)

# Lazy Celery app initialization - defers actual connection until needed
celery_app = None


def get_celery_app() -> Celery:
    """
    Get or initialize the Celery app.
    Uses lazy initialization to avoid connection errors during startup.
    """
    global celery_app
    if celery_app is None:
        try:
            celery_app = Celery(
                "soter_ai_service",
                broker=settings.redis_url,
                backend=settings.redis_url,
                include=["tasks"],
            )

            # Celery configuration
            celery_app.conf.update(
                task_serializer="json",
                accept_content=["json"],
                result_serializer="json",
                timezone="UTC",
                enable_utc=True,
                task_track_started=True,
                task_time_limit=3600,  # 1 hour max
                task_soft_time_limit=1800,  # 30 minutes soft limit
                result_expires=86400,  # Results expire after 24 hours
                task_acks_late=True,
                task_reject_on_worker_lost=True,
                beat_schedule={
                    "purge-expired-evidence-uploads": {
                        "task": "purge_expired_evidence_uploads",
                        "schedule": crontab(minute=0),  # hourly
                    },
                },
            )
        except Exception as e:
            logger.warning(
                f"Failed to initialize Celery: {e}. Task processing disabled."
            )
            # Return a dummy app that won't crash
            celery_app = Celery("soter_ai_service")

    return celery_app


def get_process_heavy_inference_task():
    """
    Get the lazily-registered process_heavy_inference task.
    This allows the task to be registered only when Celery is actually available.
    """
    app = get_celery_app()

    # Define and register the task with the app
    @app.task(
        bind=True,
        name="process_heavy_inference",
        max_retries=settings.task_max_retries,
        default_retry_delay=settings.task_retry_delay_seconds,
    )
    def process_heavy_inference_task(
        self, task_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        try:
            return process_heavy_inference_impl(self, task_id, payload)
        except BaseException as exc:
            if (
                isinstance(exc, (KeyboardInterrupt, SystemExit))
                or type(exc).__name__ == "WorkerShutdown"
            ):
                error_msg = "Task interrupted by worker shutdown"
                logger.warning(
                    f"Task {task_id} interrupted by shutdown. Dead-lettering."
                )
                handle_task_retries_exhausted(task_id, payload, error_msg)
                raise
            if not isinstance(exc, Exception):
                raise
            if self.request.retries < settings.task_max_retries:
                retry_delay = settings.task_retry_delay_seconds * (
                    2**self.request.retries
                )
                logger.warning(
                    "Retrying task %s after failure %s/%s in %ss: %s",
                    task_id,
                    self.request.retries + 1,
                    settings.task_max_retries,
                    retry_delay,
                    exc,
                )
                update_task_status(task_id, "retrying", error=str(exc))
                raise self.retry(exc=exc, countdown=retry_delay)

            handle_task_retries_exhausted(task_id, payload, str(exc))
            raise

    return process_heavy_inference_task


def get_purge_expired_evidence_uploads_task():
    """
    Get the lazily-registered purge_expired_evidence_uploads task.

    Removes abandoned upload sessions and expired evidence artifacts on the
    schedule configured in ``get_celery_app``. Registered lazily so the task
    exists only once Celery is actually available, matching the pattern used
    by ``get_process_heavy_inference_task``.
    """
    app = get_celery_app()

    @app.task(name="purge_expired_evidence_uploads")
    def purge_expired_evidence_uploads_task() -> Dict[str, Any]:
        from api.v1.uploads import run_evidence_upload_purge

        dry_run = os.getenv("EVIDENCE_PURGE_DRY_RUN", "false").lower() == "true"
        return run_evidence_upload_purge(dry_run=dry_run)

    return purge_expired_evidence_uploads_task


def handle_task_retries_exhausted(
    task_id: str, payload: Dict[str, Any], error_msg: str
) -> None:
    """
    Finalize a task that has exhausted its Celery retry budget: mark it
    failed, notify the backend, and dead-letter it so an operator can
    replay it later without waiting on another transient-failure window.
    """
    update_task_status(task_id, "failed", error=error_msg)
    send_webhook_notification(task_id, "failed", error=error_msg)
    dead_letter_queue.add(
        kind="async_job",
        task_id=task_id,
        payload=payload,
        error=error_msg,
        task_type=payload.get("type") if isinstance(payload, dict) else None,
    )
    metrics.DEAD_LETTER_ITEMS_TOTAL.labels(kind="async_job").inc()


# Task status storage (in production, use Redis with proper TTL)
task_results: Dict[str, Dict[str, Any]] = {}
pii_scrubber_service = PIIScrubberService()
humanitarian_verification_service = HumanitarianVerificationService()


def update_task_status(
    task_id: str, status: str, result: Optional[Any] = None, error: Optional[str] = None
) -> None:
    """
    Update the status of a background task

    Args:
        task_id: Unique identifier for the task
        status: Current status (pending, processing, completed, failed)
        result: Task result data (if completed)
        error: Error message (if failed)
    """
    task_results[task_id] = {
        "status": status,
        "result": result,
        "error": error,
        "updated_at": time.time(),
    }


def send_webhook_notification(
    task_id: str, status: str, result: Any = None, error: str = None
) -> None:
    """
    Send a signed webhook notification to the NestJS backend when a task
    transitions to a terminal state.

    The payload is serialised using :class:`~schemas.callback.AiCallbackPayload`
    (the canonical contract) and signed with HMAC-SHA256 if ``AI_WEBHOOK_SECRET``
    is configured.  The resulting signature is sent in the
    ``X-Signature-256`` header, matching what :class:`WebhookHmacGuard`
    on the backend expects.

    Args:
        task_id: Unique identifier of the completed/failed task.
        status:  Terminal status string ("completed" or "failed").
        result:  Task output dict (required when status="completed").
        error:   Error message string (required when status="failed").
    """
    if not settings.backend_webhook_url:
        logger.warning("Backend webhook URL not configured, skipping notification")
        return

    try:
        payload = AiCallbackPayload.build(
            task_id=task_id,
            status=CallbackStatus(status),
            result=result,
            error=error,
        )
    except Exception as exc:
        logger.error(f"Failed to build callback payload for task {task_id}: {exc}")
        return

    body_bytes = payload.to_json_bytes()
    headers: dict = {"Content-Type": "application/json"}

    if settings.ai_webhook_secret:
        headers["X-Signature-256"] = payload.sign(settings.ai_webhook_secret)
    else:
        logger.warning(
            "AI_WEBHOOK_SECRET not configured — sending unsigned webhook for task %s. "
            "Set AI_WEBHOOK_SECRET in .env to enable HMAC verification.",
            task_id,
        )

    try:
        import threading

        def send_notification() -> None:
            try:
                deliver_webhook(body_bytes, headers)
                logger.info(f"Webhook notification sent for task {task_id}")
            except Exception as exc:
                logger.error(f"Failed to send webhook notification: {exc}")
                dead_letter_queue.add(
                    kind="callback",
                    task_id=task_id,
                    payload={"status": status, "result": result, "error": error},
                    error=str(exc),
                )
                metrics.DEAD_LETTER_ITEMS_TOTAL.labels(kind="callback").inc()

        thread = threading.Thread(target=send_notification, daemon=True)
        thread.start()
    except Exception as exc:
        logger.error(f"Error setting up webhook notification thread: {exc}")


def deliver_webhook(body_bytes: bytes, headers: Dict[str, str]) -> None:
    """
    Synchronously POST a webhook body to the configured backend URL.

    Raises on any non-2xx response or connection failure. Shared by the
    fire-and-forget notification path and dead-letter replay so both
    paths agree on what counts as a delivery failure.
    """
    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            str(settings.backend_webhook_url),
            content=body_bytes,
            headers=headers,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"Webhook delivery failed: {response.status_code} - {response.text}"
            )


def replay_callback_delivery(task_id: str, payload: Dict[str, Any]) -> None:
    """
    Rebuild and resend a dead-lettered callback payload.

    Args:
        task_id: The AI task the callback belongs to.
        payload: The dead-letter entry's stored payload, containing the
            original ``status``, ``result``, and ``error`` fields.

    Raises:
        RuntimeError: If the webhook URL is not configured or delivery fails.
    """
    if not settings.backend_webhook_url:
        raise RuntimeError("Backend webhook URL not configured, cannot replay callback")

    callback_payload = AiCallbackPayload.build(
        task_id=task_id,
        status=CallbackStatus(payload.get("status")),
        result=payload.get("result"),
        error=payload.get("error"),
    )

    body_bytes = callback_payload.to_json_bytes()
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if settings.ai_webhook_secret:
        headers["X-Signature-256"] = callback_payload.sign(settings.ai_webhook_secret)

    deliver_webhook(body_bytes, headers)


def replay_async_job(task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Re-run a dead-lettered async job synchronously.

    Reuses the same processing implementation the Celery worker calls, so a
    successful replay leaves the task in the same terminal 'completed' state
    (and fires the same completion webhook) as if it had succeeded on the
    original attempt.

    Raises:
        Exception: Whatever the underlying task processing raised.
    """
    return process_heavy_inference_impl(None, task_id, payload)


def process_heavy_inference_impl(
    self, task_id: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Process heavy AI inference tasks in background

    Args:
        task_id: Unique identifier for tracking
        payload: Task payload containing input data

    Returns:
        dict: Processing results
    """
    logger.info(f"Starting heavy inference task {task_id}")

    try:
        # Update status to processing
        update_task_status(task_id, "processing")

        # Extract task type from payload
        task_type = payload.get("type", "inference")

        start_inference = time.time()

        # Simulate heavy processing (replace with actual AI inference logic)
        # In production, this would handle:
        # - Large image processing
        # - Complex model inference
        # - Batch processing

        if task_type == "ocr":
            result = _process_ocr(payload)
        elif task_type == "image_analysis":
            result = _process_image_analysis(payload)
        elif task_type == "model_inference":
            result = _process_model_inference(payload)
        elif task_type == "humanitarian_verification":
            result = _process_humanitarian_verification(payload)
        elif task_type == "batch_processing":
            result = _process_batch(payload)
        else:
            result = _process_default_inference(payload)

        # Update status to completed
        update_task_status(task_id, "completed", result)

        # Send webhook notification to backend
        send_webhook_notification(task_id, "completed", result)

        inference_latency = time.time() - start_inference
        metrics.INFERENCE_LATENCY.labels(task_type=task_type).observe(inference_latency)

        logger.info(
            f"Task {task_id} completed successfully in {inference_latency:.4f}s"
        )
        return result

    except Exception as e:
        logger.error(f"Task {task_id} failed: {str(e)}", exc_info=True)
        raise


def _process_ocr(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Process an OCR task from base64-encoded image bytes."""
    image_base64 = payload.get("image_base64")
    if not image_base64:
        raise ValueError("'image_base64' is required for ocr tasks")

    return {
        "type": "ocr",
        "status": "success",
        "result": run_ocr_from_base64(
            image_base64,
            payload.get("anchor_metadata"),
            language_hint=payload.get("language_hint"),
        ),
    }


def _process_image_analysis(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process image analysis task

    Args:
        payload: Task payload

    Returns:
        dict: Analysis results
    """
    # Simulate image processing
    time.sleep(2)  # Simulate processing time

    return {
        "type": "image_analysis",
        "analysis": {
            "objects_detected": ["person", "vehicle", "building"],
            "confidence_scores": [0.95, 0.87, 0.78],
            "image_quality": "high",
            "dimensions": {"width": 1920, "height": 1080},
        },
        "processing_time": 2.0,
    }


def _process_model_inference(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process complex model inference task

    Args:
        payload: Task payload

    Returns:
        dict: Inference results
    """
    data = payload.get("data", {})
    raw_text = data.get("text") if isinstance(data, dict) else None
    anonymization_result = None
    if isinstance(raw_text, str) and raw_text.strip():
        # Enforce privacy-by-design: sanitize text before any external LLM call.
        anonymization_result = pii_scrubber_service.anonymize(raw_text)

    # Simulate model inference
    time.sleep(3)  # Simulate inference time

    return {
        "type": "model_inference",
        "inference": {
            "predictions": [
                {"label": "need_verified", "confidence": 0.92},
                {"label": "need_pending", "confidence": 0.05},
                {"label": "need_rejected", "confidence": 0.03},
            ],
            "model_version": "v1.0.0",
            "processing_time_ms": 250,
            "anonymization": anonymization_result,
        },
        "processing_time": 3.0,
    }


def _process_batch(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process batch processing task

    Args:
        payload: Task payload

    Returns:
        dict: Batch results
    """
    # Simulate batch processing
    batch_size = payload.get("batch_size", 10)
    time.sleep(batch_size * 0.5)  # Simulate processing

    results = []
    for i in range(batch_size):
        results.append(
            {
                "id": f"batch_item_{i}",
                "status": "processed",
                "confidence": 0.85 + (i * 0.01),
            }
        )

    return {
        "type": "batch_processing",
        "batch_size": batch_size,
        "processed": batch_size,
        "failed": 0,
        "results": results,
        "processing_time": batch_size * 0.5,
    }


def _process_default_inference(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process default inference task

    Args:
        payload: Task payload

    Returns:
        dict: Inference results
    """
    # Simulate processing
    time.sleep(1)

    return {
        "type": "inference",
        "status": "success",
        "result": {"message": "Inference completed", "data": payload.get("data", {})},
        "processing_time": 1.0,
    }


def _process_humanitarian_verification(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Process humanitarian claim verification using standardized prompts."""
    data = payload.get("data", {})
    aid_claim = data.get("aid_claim")
    if not aid_claim:
        raise ValueError("'aid_claim' is required for humanitarian_verification tasks")

    verification = humanitarian_verification_service.verify_claim(
        aid_claim=aid_claim,
        supporting_evidence=data.get("supporting_evidence", []),
        context_factors=data.get("context_factors", {}),
        provider_preference=data.get("provider_preference", "auto"),
    )

    return {
        "type": "humanitarian_verification",
        "status": "success",
        "result": verification,
    }


def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Get the status of a background task

    Args:
        task_id: Unique identifier for the task

    Returns:
        dict: Task status information
    """
    local_status = task_results.get(task_id)
    if local_status and local_status.get("status") in {
        "completed",
        "failed",
        "retrying",
        "cancelled",
        "expired",
    }:
        return {
            "task_id": task_id,
            **local_status,
        }

    # Try to get from Celery result backend first
    try:
        celery_result = AsyncResult(task_id, app=get_celery_app())
        if celery_result.ready():
            return {
                "task_id": task_id,
                "status": "completed" if celery_result.successful() else "failed",
                "result": celery_result.result if celery_result.successful() else None,
                "error": str(celery_result.info) if celery_result.failed() else None,
            }
        elif celery_result.started():
            return {
                "task_id": task_id,
                "status": "processing",
            }
        else:
            return {
                "task_id": task_id,
                "status": "pending",
            }
    except Exception:
        pass

    # Fall back to local storage
    if local_status:
        return {"task_id": task_id, **local_status}

    return {"task_id": task_id, "status": "not_found"}


def create_task(task_type: str, payload: Dict[str, Any]) -> str:
    """
    Create a new background task

    Args:
        task_type: Type of task to create
        payload: Task payload

    Returns:
        str: Task ID
    """
    task_id = str(uuid.uuid4())

    # Initialize task status
    update_task_status(task_id, "pending")

    ensure_queue_capacity()

    try:
        # Queue the task using the lazy-registered task
        task = get_process_heavy_inference_task()
        task.apply_async(
            args=[task_id, {**payload, "type": task_type}], task_id=task_id
        )
    except Exception as e:
        logger.error(
            f"Failed to queue task {task_id}: {e}. Redis may not be available."
        )
        update_task_status(task_id, "failed", error=str(e))
        raise

    logger.info(f"Created task {task_id} of type {task_type}")

    return task_id


def cancel_task(task_id: str) -> None:
    """
    Cancel a background task.
    """
    from celery.result import AsyncResult

    result = AsyncResult(task_id, app=get_celery_app())
    result.revoke(terminate=True)
    update_task_status(task_id, "cancelled")


def expire_task(task_id: str) -> None:
    """
    Expire a background task.
    """
    from celery.result import AsyncResult

    result = AsyncResult(task_id, app=get_celery_app())
    result.revoke(terminate=True)
    update_task_status(task_id, "expired")


# Registered eagerly (unlike the on-demand inference task) so that celery
# beat, which dispatches purely by task name, always finds it in the worker's
# registry without needing a request to trigger registration first.
get_purge_expired_evidence_uploads_task()
