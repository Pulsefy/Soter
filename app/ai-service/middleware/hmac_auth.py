import hashlib
import hmac
import time
from typing import Callable, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings


class HMACAuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware to verify HMAC signatures on incoming requests.
    
    Ensures that only authorized services (NestJS backend) can call the AI service
    by validating the HMAC-SHA256 signature in the request headers.
    """

    SIGNATURE_HEADER = "X-HMAC-Signature"
    TIMESTAMP_HEADER = "X-HMAC-Timestamp"
    MAX_TIMESTAMP_DIFF_SECONDS = 300

    EXCLUDED_PATHS = {"/health", "/", "/docs", "/openapi.json", "/redoc"}

    def __init__(self, app, secret_key: Optional[str] = None):
        super().__init__(app)
        self.secret_key = secret_key or settings.hmac_secret_key

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self.EXCLUDED_PATHS:
            return await call_next(request)

        if not self.secret_key:
            return JSONResponse(
                status_code=500,
                content={
                    "error": True,
                    "status_code": 500,
                    "detail": "HMAC secret key not configured",
                    "service": "soter-ai-service",
                },
            )

        signature = request.headers.get(self.SIGNATURE_HEADER)
        timestamp = request.headers.get(self.TIMESTAMP_HEADER)

        if not signature or not timestamp:
            return JSONResponse(
                status_code=403,
                content={
                    "error": True,
                    "status_code": 403,
                    "detail": "Missing HMAC signature or timestamp",
                    "service": "soter-ai-service",
                },
            )

        try:
            request_timestamp = int(timestamp)
        except ValueError:
            return JSONResponse(
                status_code=403,
                content={
                    "error": True,
                    "status_code": 403,
                    "detail": "Invalid timestamp format",
                    "service": "soter-ai-service",
                },
            )

        current_timestamp = int(time.time())
        if abs(current_timestamp - request_timestamp) > self.MAX_TIMESTAMP_DIFF_SECONDS:
            return JSONResponse(
                status_code=403,
                content={
                    "error": True,
                    "status_code": 403,
                    "detail": "Request timestamp expired",
                    "service": "soter-ai-service",
                },
            )

        body = await request.body()

        if not self._verify_signature(
            method=request.method,
            path=request.url.path,
            timestamp=timestamp,
            body=body,
            provided_signature=signature,
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "error": True,
                    "status_code": 403,
                    "detail": "Invalid HMAC signature",
                    "service": "soter-ai-service",
                },
            )

        return await call_next(request)

    def _verify_signature(
        self,
        method: str,
        path: str,
        timestamp: str,
        body: bytes,
        provided_signature: str,
    ) -> bool:
        """
        Verify the HMAC signature against the computed signature.
        
        The signature is computed as:
        HMAC-SHA256(secret_key, method + path + timestamp + body)
        """
        payload = f"{method}{path}{timestamp}".encode("utf-8") + body
        expected_signature = hmac.new(
            self.secret_key.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(expected_signature, provided_signature)
