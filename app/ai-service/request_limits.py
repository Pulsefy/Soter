"""Request-size and caller-timeout guards for AI endpoints."""

from __future__ import annotations

from typing import Callable

from fastapi.responses import JSONResponse

import metrics
from config import settings


_LIMITED_PATH_PREFIXES = ("/v1/", "/ai/")


def clamp_request_timeout(timeout: float | None, endpoint: str) -> float | None:
    """Clamp a caller timeout to the configured server-side ceiling."""
    if timeout is None:
        return None

    maximum = float(settings.max_request_timeout_seconds)
    if timeout <= maximum:
        return timeout

    metrics.REQUEST_REJECTIONS_TOTAL.labels(
        endpoint=metrics.bounded_endpoint_label(endpoint), reason="timeout_clamped"
    ).inc()
    return maximum


class RequestSizeLimitMiddleware:
    """Reject oversized AI requests before FastAPI parses their payloads."""

    def __init__(self, app: Callable):
        self.app = app

    @staticmethod
    def _is_limited(scope: dict) -> bool:
        return scope.get("method") in {"POST", "PUT", "PATCH"} and any(
            scope.get("path", "").startswith(prefix)
            for prefix in _LIMITED_PATH_PREFIXES
        )

    async def __call__(self, scope: dict, receive: Callable, send: Callable):
        if scope.get("type") != "http" or not self._is_limited(scope):
            await self.app(scope, receive, send)
            return

        max_bytes = int(settings.max_request_body_bytes)
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > max_bytes:
                    await self._reject(scope, receive, send)
                    return
            except ValueError:
                pass

        messages = []
        total_bytes = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                await self.app(scope, receive, send)
                return

            if message["type"] == "http.request":
                total_bytes += len(message.get("body", b""))
                if total_bytes > max_bytes:
                    await self._reject(scope, receive, send)
                    return
                messages.append(message)
                if not message.get("more_body", False):
                    break

        message_index = 0

        async def replay_receive():
            nonlocal message_index
            if message_index < len(messages):
                message = messages[message_index]
                message_index += 1
                return message
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay_receive, send)

    async def _reject(self, scope: dict, receive: Callable, send: Callable):
        endpoint = scope.get("path", "")
        metrics.REQUEST_REJECTIONS_TOTAL.labels(
            endpoint=metrics.bounded_endpoint_label(endpoint),
            reason="request_body_too_large",
        ).inc()
        response = JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "REQUEST_BODY_TOO_LARGE",
                    "message": (
                        "Request body exceeds the configured maximum of "
                        f"{settings.max_request_body_bytes} bytes"
                    ),
                }
            },
        )
        await response(scope, receive, send)
