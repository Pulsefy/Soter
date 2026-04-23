from pydantic import BaseModel, Field


class OCRFieldResult(BaseModel):
    value: str
    confidence: float = 0.0


class OCRData(BaseModel):
    fields: dict[str, OCRFieldResult]
    raw_text: str
    processing_time_ms: int


class OCRResponse(BaseModel):
    success: bool
    data: OCRData | None = None
    error: dict[str, str] | None = None
    processing_time_ms: int
