"""Admin routes for circuit-breaker observability and manual reset."""

import logging
from typing import Optional

from fastapi import APIRouter, Body, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.circuit_breaker import CircuitBreakerRegistry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-circuit-breakers"])


class CircuitBreakerResetRequest(BaseModel):
    reason: Optional[str] = None


def _require_admin(x_admin_token: str):
    if not x_admin_token or not x_admin_token.strip():
        return JSONResponse(
            status_code=401,
            content={
                "error": {
                    "code": "admin_auth_required",
                    "message": "admin authentication required",
                }
            },
        )
    return None


@router.get("/admin/circuit-breakers")
async def list_circuit_breakers(
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
):
    err = _require_admin(x_admin_token)
    if err is not None:
        return err
    return CircuitBreakerRegistry.all_states()


@router.get("/admin/circuit-breakers/{provider}")
async def get_circuit_breaker(
    provider: str,
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
):
    err = _require_admin(x_admin_token)
    if err is not None:
        return err
    breaker = CircuitBreakerRegistry.get(provider)
    if breaker is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "code": "provider_not_found",
                    "message": f"provider '{provider}' has no configured circuit breaker",
                }
            },
        )
    return breaker.get_state()


@router.post("/admin/circuit-breakers/{provider}/reset")
async def reset_circuit_breaker(
    provider: str,
    body: Optional[CircuitBreakerResetRequest] = Body(default=None),
    x_admin_token: str = Header(default="", alias="X-Admin-Token"),
):
    err = _require_admin(x_admin_token)
    if err is not None:
        return err
    reason = (body and body.reason) or "manual_reset_via_admin_api"
    try:
        state = CircuitBreakerRegistry.reset(provider, reason=reason)
    except KeyError:
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "code": "provider_not_found",
                    "message": f"provider '{provider}' has no configured circuit breaker",
                }
            },
        )
    return state
