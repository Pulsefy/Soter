"""
v1 inference endpoints (task queue).
"""

import logging
from typing import Any, Dict, Optional
from datetime import datetime
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field, validator

import tasks
from exceptions import LoadShedError
from services.cache import cached_response
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["inference"])


class ContractMetadata(BaseModel):
    """Contract-aware metadata for verification results."""
    campaign_id: str = Field(..., description="Campaign identifier (UUID)")
    claim_id: str = Field(..., description="Claim identifier (UUID)")
    package_id: str = Field(..., description="Package identifier for on-chain anchoring")
    transaction_hash: Optional[str] = Field(None, description="On-chain transaction hash")
    contract_address: Optional[str] = Field(None, description="Smart contract address")
    network: Optional[str] = Field("testnet", description="Stellar network (testnet/mainnet)")
    chain_id: Optional[str] = Field("testnet", description="Chain identifier")
    version: Optional[str] = Field("1.0.0", description="Metadata version")
    timestamp: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Metadata timestamp")

    @validator('campaign_id', 'claim_id')
    def validate_uuid(cls, v):
        """Validate that the ID is a valid UUID."""
        try:
            uuid.UUID(v)
            return v
        except ValueError:
            raise ValueError(f"Invalid UUID: {v}")
    
    @validator('network')
    def validate_network(cls, v):
        """Validate network is one of the allowed values."""
        if v not in ['testnet', 'mainnet', 'public']:
            raise ValueError(f"network must be one of: testnet, mainnet, public")
        return v


class InferenceRequest(BaseModel):
    """Request model for AI inference endpoints."""
    
    type: str = "inference"
    data: Optional[Dict[str, Any]] = None
    priority: Optional[str] = "normal"
    
    # Contract-aware metadata fields
    campaign_id: Optional[str] = None
    claim_id: Optional[str] = None
    package_id: Optional[str] = None
    transaction_hash: Optional[str] = None
    contract_address: Optional[str] = None
    network: Optional[str] = "testnet"
    
    class Config:
        json_schema_extra = {
            "example": {
                "type": "verification",
                "data": {"document_url": "https://example.com/doc.pdf"},
                "campaign_id": "123e4567-e89b-12d3-a456-426614174000",
                "claim_id": "123e4567-e89b-12d3-a456-426614174001",
                "package_id": "pkg_abc123def",
                "network": "testnet"
            }
        }


class TaskStatusResponse(BaseModel):
    """Response model for task status."""
    
    task_id: str
    status: str
    result: Optional[Any] = None
    error: Optional[str] = None
    metadata: Optional[ContractMetadata] = None


@router.post("/ai/inference")
async def create_inference_task(
    request: InferenceRequest,
    background_tasks: BackgroundTasks,
):
    """
    Create a background task for heavy AI inference.
    
    Offloads time-consuming AI tasks to background workers. Use the
    returned ``task_id`` to poll for results via ``GET /ai/status/{task_id}``.
    
    Contract-aware metadata fields are used to anchor verification results
    to on-chain events during Testnet demos.
    """
    logger.info(f"Creating inference task of type: {request.type}")
    
    # Validate metadata if provided
    metadata_errors = []
    if request.campaign_id:
        try:
            uuid.UUID(request.campaign_id)
        except ValueError:
            metadata_errors.append(f"Invalid campaign_id: {request.campaign_id}")
    
    if request.claim_id:
        try:
            uuid.UUID(request.claim_id)
        except ValueError:
            metadata_errors.append(f"Invalid claim_id: {request.claim_id}")
    
    if request.package_id and not request.package_id.startswith('pkg_'):
        metadata_errors.append(f"Invalid package_id format: {request.package_id}")
    
    if metadata_errors:
        raise HTTPException(
            status_code=400,
            detail=f"Metadata validation failed: {'; '.join(metadata_errors)}"
        )

    try:
        # Build task payload with metadata
        payload = {
            "data": request.data or {},
            "priority": request.priority or "normal",
        }
        
        # Add metadata if provided
        if request.campaign_id:
            payload["metadata"] = {
                "campaign_id": request.campaign_id,
                "claim_id": request.claim_id,
                "package_id": request.package_id or f"pkg_{request.claim_id[:8] if request.claim_id else 'unknown'}",
                "transaction_hash": request.transaction_hash,
                "contract_address": request.contract_address,
                "network": request.network or "testnet",
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        task_id = tasks.create_task(
            task_type=request.type,
            payload=payload,
        )

        return {
            "success": True,
            "task_id": task_id,
            "status": "pending",
            "message": "Task queued for processing",
            "status_url": f"/v1/ai/status/{task_id}",
            "metadata": payload.get("metadata"),
        }

    except LoadShedError:
        raise
    except Exception as e:
        logger.error(f"Failed to create inference task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")


@router.get("/ai/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """
    Get the current status of a background inference task.
    
    Poll this endpoint after creating a task. Possible status values:
    ``pending``, ``processing``, ``completed``, ``failed``.
    
    When completed, the result will include contract-aware metadata
    that can be anchored to on-chain events.
    """
    return await _get_task_status(task_id)


@router.get("/ai/jobs/{task_id}", response_model=TaskStatusResponse)
async def get_job_status(task_id: str):
    """
    Get the current status of a queued AI job.
    
    This is the canonical poll endpoint for backend clients. Possible
    status values: ``pending``, ``processing``, ``retrying``, ``completed``,
    ``failed``, ``cancelled``.
    """
    return await _get_task_status(task_id)


@cached_response(prefix="task_status", ttl_seconds=settings.cache_ttl_task_status)
async def _get_task_status(task_id: str):
    logger.info(f"Checking status for task: {task_id}")

    try:
        status_info = tasks.get_task_status(task_id)

        if status_info.get("status") == "not_found":
            raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
        
        # Ensure metadata is included in response
        if status_info.get("result") and isinstance(status_info["result"], dict):
            # If result has metadata, ensure it's properly formatted
            if "metadata" not in status_info["result"] and "campaign_id" in status_info.get("payload", {}):
                # Reconstruct metadata from payload
                status_info["result"]["metadata"] = status_info["payload"].get("metadata")

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