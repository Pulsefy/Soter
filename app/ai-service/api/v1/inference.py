"""
v1 inference endpoints (task queue).
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

import tasks

logger = logging.getLogger(__name__)

router = APIRouter(tags=["inference"])


class InferenceRequest(BaseModel):
    """Request model for AI inference endpoints."""

    type: str = "inference"
    data: Optional[Dict[str, Any]] = None
    priority: Optional[str] = "normal"


class TaskStatusResponse(BaseModel):
    """Response model for task status."""

    task_id: str
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None


@router.post("/ai/inference")
async def create_inference_task(
    request: InferenceRequest,
    background_tasks: BackgroundTasks,
):
    """
    Create a background task for heavy AI inference.

    Offloads time-consuming AI tasks to background workers.  Use the
    returned ``task_id`` to poll for results via ``GET /ai/status/{task_id}``.
    """
    logger.info(f"Creating inference task of type: {request.type}")

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


@router.get("/ai/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """
    Get the current status of a background inference task.

    Poll this endpoint after creating a task.  Possible status values:
    ``pending``, ``processing``, ``completed``, ``failed``.
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


@router.post("/ai/task/{task_id}/cancel")
async def cancel_task(task_id: str):
    """Cancel a pending or in-progress inference task."""
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
