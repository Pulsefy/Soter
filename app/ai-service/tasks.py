"""
Celery tasks for Soter AI Service
Handles background task processing for heavy inference
"""

import logging
import uuid
import time
from typing import Any, Dict, Optional
from celery import Celery
from celery.result import AsyncResult
import httpx

import metrics
from config import settings
from services.load_shedder import ensure_queue_capacity
from services.pii_scrubber import PIIScrubberService
from services.humanitarian_verification import HumanitarianVerificationService
from services.ocr_job import run_ocr_from_base64

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
                'soter_ai_service',
                broker=settings.redis_url,
                backend=settings.redis_url,
                include=['tasks']
            )
            
            # Celery configuration
            celery_app.conf.update(
                task_serializer='json',
                accept_content=['json'],
                result_serializer='json',
                timezone='UTC',
                enable_utc=True,
                task_track_started=True,
                task_time_limit=3600,  # 1 hour max
                task_soft_time_limit=1800,  # 30 minutes soft limit
                result_expires=86400,  # Results expire after 24 hours
                task_acks_late=True,
                task_reject_on_worker_lost=True,
            )
        except Exception as e:
            logger.warning(f"Failed to initialize Celery: {e}. Task processing disabled.")
            # Return a dummy app that won't crash
            celery_app = Celery('soter_ai_service')
    
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
        name='process_heavy_inference',
        max_retries=settings.task_max_retries,
        default_retry_delay=settings.task_retry_delay_seconds,
    )
    def process_heavy_inference_task(self, task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return process_heavy_inference_impl(self, task_id, payload)
        except Exception as exc:
            if self.request.retries < settings.task_max_retries:
                retry_delay = settings.task_retry_delay_seconds * (2 ** self.request.retries)
                logger.warning(
                    "Retrying task %s after failure %s/%s in %ss: %s",
                    task_id,
                    self.request.retries + 1,
                    settings.task_max_retries,
                    retry_delay,
                    exc,
                )
                update_task_status(task_id, 'retrying', error=str(exc))
                raise self.retry(exc=exc, countdown=retry_delay)

            error_msg = str(exc)
            update_task_status(task_id, 'failed', error=error_msg)
            send_webhook_notification(task_id, 'failed', error=error_msg)
            raise
    
    return process_heavy_inference_task

# Task status storage (in production, use Redis with proper TTL)
task_results: Dict[str, Dict[str, Any]] = {}
pii_scrubber_service = PIIScrubberService()
humanitarian_verification_service = HumanitarianVerificationService()


def update_task_status(
    task_id: str,
    status: str,
    result: Optional[Any] = None,
    error: Optional[str] = None
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
        'status': status,
        'result': result,
        'error': error,
        'updated_at': time.time()
    }


def send_webhook_notification(task_id: str, status: str, result: Any = None, error: str = None) -> None:
    """
    Send webhook notification to NestJS backend when task completes
    
    Args:
        task_id: Unique identifier for the task
        status: Final status (completed, failed)
        result: Task result data (if completed)
        error: Error message (if failed)
    """
    if not settings.backend_webhook_url:
        logger.warning("Backend webhook URL not configured, skipping notification")
        return
    
    payload = {
        'task_id': task_id,
        'status': status,
        'service': 'soter-ai-service',
        'timestamp': time.time(),
    }
    
    if result is not None:
        payload['result'] = result
    
    if error:
        payload['error'] = error
    
    try:
        # Fire and forget - don't block the task completion
        import threading
        def send_notification():
            try:
                with httpx.Client(timeout=10.0) as client:
                    response = client.post(settings.backend_webhook_url, json=payload)
                    if response.status_code >= 400:
                        logger.error(f"Webhook notification failed: {response.status_code} - {response.text}")
                    else:
                        logger.info(f"Webhook notification sent for task {task_id}")
            except Exception as e:
                logger.error(f"Failed to send webhook notification: {e}")
        
        thread = threading.Thread(target=send_notification)
        thread.start()
    except Exception as e:
        logger.error(f"Error setting up webhook notification: {e}")


def process_heavy_inference_impl(self, task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
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
        update_task_status(task_id, 'processing')
        
        # Extract task type from payload
        task_type = payload.get('type', 'inference')
        
        start_inference = time.time()
        
        # Simulate heavy processing (replace with actual AI inference logic)
        # In production, this would handle:
        # - Large image processing
        # - Complex model inference
        # - Batch processing
        
        if task_type == 'ocr':
            result = _process_ocr(payload)
        elif task_type == 'image_analysis':
            result = _process_image_analysis(payload)
        elif task_type == 'model_inference':
            result = _process_model_inference(payload)
        elif task_type == 'humanitarian_verification':
            result = _process_humanitarian_verification(payload)
        elif task_type == 'batch_processing':
            result = _process_batch(payload)
        else:
            result = _process_default_inference(payload)
        
        # Update status to completed
        update_task_status(task_id, 'completed', result)
        
        # Send webhook notification to backend
        send_webhook_notification(task_id, 'completed', result)
        
        inference_latency = time.time() - start_inference
        metrics.INFERENCE_LATENCY.labels(task_type=task_type).observe(inference_latency)
        
        logger.info(f"Task {task_id} completed successfully in {inference_latency:.4f}s")
        return result
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {str(e)}", exc_info=True)
        raise


def _process_ocr(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Process an OCR task from base64-encoded image bytes."""
    image_base64 = payload.get('image_base64')
    if not image_base64:
        raise ValueError("'image_base64' is required for ocr tasks")

    return {
        'type': 'ocr',
        'status': 'success',
        'result': run_ocr_from_base64(
            image_base64,
            payload.get('anchor_metadata'),
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
        'type': 'image_analysis',
        'analysis': {
            'objects_detected': ['person', 'vehicle', 'building'],
            'confidence_scores': [0.95, 0.87, 0.78],
            'image_quality': 'high',
            'dimensions': {'width': 1920, 'height': 1080}
        },
        'processing_time': 2.0
    }


def _process_model_inference(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process complex model inference task
    
    Args:
        payload: Task payload
    
    Returns:
        dict: Inference results
    """
    data = payload.get('data', {})
    raw_text = data.get('text') if isinstance(data, dict) else None
    anonymization_result = None
    if isinstance(raw_text, str) and raw_text.strip():
        # Enforce privacy-by-design: sanitize text before any external LLM call.
        anonymization_result = pii_scrubber_service.anonymize(raw_text)

    # Simulate model inference
    time.sleep(3)  # Simulate inference time
    
    return {
        'type': 'model_inference',
        'inference': {
            'predictions': [
                {'label': 'need_verified', 'confidence': 0.92},
                {'label': 'need_pending', 'confidence': 0.05},
                {'label': 'need_rejected', 'confidence': 0.03}
            ],
            'model_version': 'v1.0.0',
            'processing_time_ms': 250,
            'anonymization': anonymization_result,
        },
        'processing_time': 3.0
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
    batch_size = payload.get('batch_size', 10)
    time.sleep(batch_size * 0.5)  # Simulate processing
    
    results = []
    for i in range(batch_size):
        results.append({
            'id': f'batch_item_{i}',
            'status': 'processed',
            'confidence': 0.85 + (i * 0.01)
        })
    
    return {
        'type': 'batch_processing',
        'batch_size': batch_size,
        'processed': batch_size,
        'failed': 0,
        'results': results,
        'processing_time': batch_size * 0.5
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
        'type': 'inference',
        'status': 'success',
        'result': {
            'message': 'Inference completed',
            'data': payload.get('data', {})
        },
        'processing_time': 1.0
    }


def _process_humanitarian_verification(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Process humanitarian claim verification using standardized prompts."""
    data = payload.get('data', {})
    aid_claim = data.get('aid_claim')
    if not aid_claim:
        raise ValueError("'aid_claim' is required for humanitarian_verification tasks")

    verification = humanitarian_verification_service.verify_claim(
        aid_claim=aid_claim,
        supporting_evidence=data.get('supporting_evidence', []),
        context_factors=data.get('context_factors', {}),
        provider_preference=data.get('provider_preference', 'auto'),
    )

    return {
        'type': 'humanitarian_verification',
        'status': 'success',
        'result': verification,
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
    if local_status and local_status.get('status') in {'completed', 'failed', 'retrying', 'cancelled'}:
        return {
            'task_id': task_id,
            **local_status,
        }

    # Try to get from Celery result backend first
    try:
        celery_result = AsyncResult(task_id, app=get_celery_app())
        if celery_result.ready():
            return {
                'task_id': task_id,
                'status': 'completed' if celery_result.successful() else 'failed',
                'result': celery_result.result if celery_result.successful() else None,
                'error': str(celery_result.info) if celery_result.failed() else None
            }
        elif celery_result.started():
            return {
                'task_id': task_id,
                'status': 'processing',
            }
        else:
            return {
                'task_id': task_id,
                'status': 'pending',
            }
    except Exception:
        pass
    
    # Fall back to local storage
    if local_status:
        return {
            'task_id': task_id,
            **local_status
        }
    
    return {
        'task_id': task_id,
        'status': 'not_found'
    }


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
    update_task_status(task_id, 'pending')
    
    ensure_queue_capacity()
    
    try:
        # Queue the task using the lazy-registered task
        task = get_process_heavy_inference_task()
        task.apply_async(
            args=[task_id, {**payload, 'type': task_type}],
            task_id=task_id
        )
    except Exception as e:
        logger.error(f"Failed to queue task {task_id}: {e}. Redis may not be available.")
        update_task_status(task_id, 'failed', error=str(e))
        raise
    
    logger.info(f"Created task {task_id} of type {task_type}")
    
    return task_id
