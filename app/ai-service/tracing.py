from contextvars import ContextVar

correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")


def get_correlation_id() -> str:
    return correlation_id_var.get() or ""


def bind_correlation_id(correlation_id: str):
    return correlation_id_var.set(correlation_id or "")


def reset_correlation_id(token):
    correlation_id_var.reset(token)
