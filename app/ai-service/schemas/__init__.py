"""AI Service Pydantic schemas."""

from .anonymization import AnonymizeRequest, AnonymizeResponse
from .callback import AiCallbackPayload, CallbackStatus
from .common import AnchorMetadata, ResultEnvelope
from .errors import ErrorDetail, ErrorEnvelope
from .fraud import FraudDetectionRequest, FraudDetectionResponse
from .humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)
from .ocr import BatchOCRResponse, OCRResponse
from .uploads import (
    ChunkUploadResponse,
    CreateUploadSessionRequest,
    FinalizeUploadResponse,
    UploadSessionResponse,
)

__all__ = [
    # Anonymization
    "AnonymizeRequest",
    "AnonymizeResponse",
    # Callback
    "AiCallbackPayload",
    "CallbackStatus",
    # Common
    "AnchorMetadata",
    "ResultEnvelope",
    # Errors
    "ErrorDetail",
    "ErrorEnvelope",
    # Fraud
    "FraudDetectionRequest",
    "FraudDetectionResponse",
    # Humanitarian
    "HumanitarianVerificationRequest",
    "HumanitarianVerificationResponse",
    # OCR
    "BatchOCRResponse",
    "OCRResponse",
    # Uploads
    "ChunkUploadResponse",
    "CreateUploadSessionRequest",
    "FinalizeUploadResponse",
    "UploadSessionResponse",
]
