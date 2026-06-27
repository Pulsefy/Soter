"""
Pydantic schemas for resumable evidence upload sessions.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class CreateUploadSessionRequest(BaseModel):
    """Request body for starting a new resumable upload session."""

    filename: str = Field(..., min_length=1, max_length=255, examples=["evidence_photo.jpg"])
    content_type: str = Field(..., min_length=1, examples=["image/jpeg"])
    total_size: int = Field(..., gt=0, description="Total file size in bytes", examples=[1048576])
    total_chunks: int = Field(..., gt=0, description="Number of chunks to be sent", examples=[10])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "filename": "evidence_photo.jpg",
                    "content_type": "image/jpeg",
                    "total_size": 1048576,
                    "total_chunks": 10
                }
            ]
        }
    }


class UploadSessionResponse(BaseModel):
    """Current state of an upload session."""

    session_id: str = Field(examples=["sess_abc123def456"])
    filename: str = Field(examples=["evidence_photo.jpg"])
    content_type: str = Field(examples=["image/jpeg"])
    total_size: int = Field(examples=[1048576])
    total_chunks: int = Field(examples=[10])
    received_chunks: List[int] = Field(examples=[[0, 1, 2]])
    status: str = Field(examples=["in_progress"])
    expires_at: float = Field(examples=[1719784800.0])
    completed: bool = Field(False, examples=[False])
    artifact_id: Optional[str] = Field(None, examples=["art_xyz789"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "session_id": "sess_abc123def456",
                    "filename": "evidence_photo.jpg",
                    "content_type": "image/jpeg",
                    "total_size": 1048576,
                    "total_chunks": 10,
                    "received_chunks": [0, 1, 2],
                    "status": "in_progress",
                    "expires_at": 1719784800.0,
                    "completed": False
                }
            ]
        }
    }


class ChunkUploadResponse(BaseModel):
    """Result of uploading a single chunk."""

    session_id: str = Field(examples=["sess_abc123def456"])
    chunk_index: int = Field(examples=[3])
    received_chunks: List[int] = Field(examples=[[0, 1, 2, 3]])
    remaining_chunks: int = Field(examples=[6])
    status: str = Field(examples=["in_progress"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "session_id": "sess_abc123def456",
                    "chunk_index": 3,
                    "received_chunks": [0, 1, 2, 3],
                    "remaining_chunks": 6,
                    "status": "in_progress"
                }
            ]
        }
    }


class FinalizeUploadResponse(BaseModel):
    """Result of finalizing an assembled upload."""

    session_id: str = Field(examples=["sess_abc123def456"])
    artifact_id: str = Field(examples=["art_xyz789"])
    filename: str = Field(examples=["evidence_photo.jpg"])
    content_type: str = Field(examples=["image/jpeg"])
    total_size: int = Field(examples=[1048576])
    status: str = Field(examples=["completed"])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "session_id": "sess_abc123def456",
                    "artifact_id": "art_xyz789",
                    "filename": "evidence_photo.jpg",
                    "content_type": "image/jpeg",
                    "total_size": 1048576,
                    "status": "completed"
                }
            ]
        }
    }