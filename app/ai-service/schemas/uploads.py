"""
Pydantic schemas for resumable evidence upload sessions.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class CreateUploadSessionRequest(BaseModel):
    """Request body for starting a new resumable upload session."""

    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(..., min_length=1)
    total_size: int = Field(..., gt=0, description="Total file size in bytes")
    total_chunks: int = Field(..., gt=0, description="Number of chunks to be sent")


class UploadSessionResponse(BaseModel):
    """Current state of an upload session."""

    session_id: str
    filename: str
    content_type: str
    total_size: int
    total_chunks: int
    received_chunks: List[int]
    status: str
    expires_at: float
    completed: bool = False
    artifact_id: Optional[str] = None


class ChunkUploadResponse(BaseModel):
    """Result of uploading a single chunk."""

    session_id: str
    chunk_index: int
    received_chunks: List[int]
    remaining_chunks: int
    status: str


class FinalizeUploadResponse(BaseModel):
    """Result of finalizing an assembled upload."""

    session_id: str
    artifact_id: str
    filename: str
    content_type: str
    total_size: int
    status: str