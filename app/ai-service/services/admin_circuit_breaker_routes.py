"""Admin routes for circuit-breaker observability and manual reset."""

from functools import wraps

from flask import Blueprint, jsonify, request

from services.circuit_breaker import CircuitBreakerRegistry

admin_circuit_breaker_bp = Blueprint("admin_circuit_breaker", __name__)


def require_admin(fn):
    """Placeholder auth guard; replace with the service's real admin auth."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not request.headers.get("X-Admin-Token"):
            return jsonify({"error": "admin authentication required"}), 401
        return fn(*args, **kwargs)

    return wrapper


@admin_circuit_breaker_bp.route("/admin/circuit-breakers", methods=["GET"])
@require_admin
def list_circuit_breakers():
    return jsonify(CircuitBreakerRegistry.all_states())


@admin_circuit_breaker_bp.route("/admin/circuit-breakers/<provider>", methods=["GET"])
@require_admin
def get_circuit_breaker(provider: str):
    breaker = CircuitBreakerRegistry.get(provider)
    if breaker is None:
        return (
            jsonify(
                {"error": f"provider '{provider}' has no configured circuit breaker"}
            ),
            404,
        )
    return jsonify(breaker.get_state())


@admin_circuit_breaker_bp.route(
    "/admin/circuit-breakers/<provider>/reset", methods=["POST"]
)
@require_admin
def reset_circuit_breaker(provider: str):
    body = request.get_json(silent=True) or {}
    reason = body.get("reason", "manual_reset_via_admin_api")
    try:
        state = CircuitBreakerRegistry.reset(provider, reason=reason)
    except KeyError:
        return (
            jsonify(
                {"error": f"provider '{provider}' has no configured circuit breaker"}
            ),
            404,
        )
    return jsonify(state)
