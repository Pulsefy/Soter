"""
Dead-letter listing and replay endpoints for failed callback deliveries and
exhausted async jobs (Issue #776).

Replay is a privileged, operator-triggered recovery action:
- Requires an authorized role (``X-User-Role: admin`` or ``operator``),
  mirroring the role check used for verification-artifact access.
- Every attempt is appended to the item's audit log (actor, outcome, error).
- Replay is rate-limited two ways: a per-item cooldown enforced by the
  DeadLetterQueue service, and a per-client request rate limit on the route
  itself. Items that exhaust ``dead_letter_max_replay_attempts`` stop being
  replayable until an operator intervenes out-of-band.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

import metrics
import tasks
from config import settings
from services.dead_letter import DeadLetterError, dead_letter_queue

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dead-letter"])
limiter = Limiter(key_func=get_remote_address)

REPLAY_AUTHORIZED_ROLES = {"admin", "operator"}
READ_AUTHORIZED_ROLES = {"admin", "operator", "reviewer"}

_ERROR_STATUS = {
    "not_found": 404,
    "already_succeeded": 409,
    "exhausted": 409,
    "rate_limited": 429,
}
_ERROR_MESSAGES = {
    "not_found": "Dead-letter item not found",
    "already_succeeded": "Item has already been successfully replayed",
    "exhausted": "Item has exhausted its replay attempts",
    "rate_limited": "Replay attempted too soon; wait for the cooldown to elapse",
}


def _error_response(code: str) -> JSONResponse:
    status_code = _ERROR_STATUS.get(code, 400)
    headers = {}
    if code == "rate_limited":
        headers["Retry-After"] = str(int(settings.dead_letter_replay_cooldown_seconds))
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": _ERROR_MESSAGES.get(code, "Request failed"),
            }
        },
    )


def _forbidden(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"error": {"code": "forbidden_role", "message": message}},
    )


@router.get("/ai/dead-letter")
async def list_dead_letter_items(
    kind: Optional[str] = None,
    status: Optional[str] = None,
    x_user_role: str = Header(default="", alias="X-User-Role"),
):
    """List dead-letter items, optionally filtered by kind and/or status."""
    if x_user_role not in READ_AUTHORIZED_ROLES:
        return _forbidden(
            f"User role '{x_user_role}' is not authorized to view dead-letter items"
        )

    items = dead_letter_queue.list(kind=kind, status=status)
    return {
        "items": [item.to_dict() for item in items],
        "count": len(items),
    }


@router.get("/ai/dead-letter/{item_id}")
async def get_dead_letter_item(
    item_id: str,
    x_user_role: str = Header(default="", alias="X-User-Role"),
):
    """Get a single dead-letter item with its full replay audit log."""
    if x_user_role not in READ_AUTHORIZED_ROLES:
        return _forbidden(
            f"User role '{x_user_role}' is not authorized to view dead-letter items"
        )

    entry = dead_letter_queue.get(item_id)
    if entry is None:
        return _error_response("not_found")
    return entry.to_dict()


@router.post("/ai/dead-letter/{item_id}/replay")
@limiter.limit(settings.dead_letter_replay_rate_limit)
async def replay_dead_letter_item(
    item_id: str,
    request: Request,
    x_user_role: str = Header(default="", alias="X-User-Role"),
    x_user_id: str = Header(default="", alias="X-User-Id"),
):
    """
    Replay a single dead-letter item (resend a callback or re-run an async job).

    Returns 404 if the item doesn't exist, 409 if it has already succeeded or
    exhausted its retry budget, and 429 if replayed again before the
    per-item cooldown elapses.
    """
    if x_user_role not in REPLAY_AUTHORIZED_ROLES:
        return _forbidden(
            f"User role '{x_user_role}' is not authorized to replay dead-letter items"
        )

    try:
        entry = dead_letter_queue.check_replayable(item_id)
    except DeadLetterError as exc:
        return _error_response(str(exc))

    actor = x_user_id.strip() or x_user_role

    try:
        if entry.kind == "callback":
            tasks.replay_callback_delivery(entry.task_id, entry.payload)
        else:
            tasks.replay_async_job(entry.task_id, entry.payload)
        success = True
        replay_error = None
    except Exception as exc:
        success = False
        replay_error = str(exc)
        logger.warning(
            "dead_letter_replay_failed",
            extra={
                "dead_letter_id": item_id,
                "kind": entry.kind,
                "error": replay_error,
            },
        )

    updated = dead_letter_queue.record_attempt(
        item_id, actor=actor, success=success, error=replay_error
    )
    metrics.DEAD_LETTER_REPLAY_ATTEMPTS_TOTAL.labels(
        kind=entry.kind, outcome="succeeded" if success else "failed"
    ).inc()

    return {
        "success": success,
        "item": updated.to_dict(),
    }
