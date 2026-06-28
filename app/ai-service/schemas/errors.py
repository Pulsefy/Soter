from typing import Any, Optional
from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(examples=["VALIDATION_ERROR", "HTTP_400"])
    message: str = Field(examples=["Request validation failed"])
    details: Optional[Any] = Field(None, examples=[{"field": "text", "msg": "field required"}])

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{"loc": ["body", "text"], "msg": "field required", "type": "value_error.missing"}]}
            ]
        }
    }


class ErrorEnvelope(BaseModel):
    error: ErrorDetail

    model_config = {
        "json_schema_extra": {
            "examples": [
                {"error": {"code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{"loc": ["body", "text"], "msg": "field required", "type": "value_error.missing"}]}}
            ]
        }
    }
