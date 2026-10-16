"""Tests for the replay-safe idempotency key support."""

import threading

import pytest

from exceptions import AIServiceError
from services.idempotency import (
    DEFAULT_WINDOW_SECONDS,
    IdempotencyConflictError,
    IdempotencyStore,
    get_idempotency_store,
    reset_idempotency_store,
)


class FakeClock:
    """Deterministic monotonic clock for window expiry tests."""

    def __init__(self, start: float = 0.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, delta: float) -> None:
        self.now += delta


def _counting_producer(result="result"):
    calls = {"n": 0}

    def produce():
        calls["n"] += 1
        return result

    return produce, calls


def test_clean_resubmit_returns_original_result():
    store = IdempotencyStore(window_seconds=60.0)
    produce, calls = _counting_producer(result={"output": "hello"})
    payload = {"prompt": "hi", "model": "gpt"}

    first = store.execute("key-1", payload, produce)
    second = store.execute("key-1", payload, produce)

    assert first == {"output": "hello"}
    assert second is first
    assert calls["n"] == 1, "producer must not rerun on replay"


def test_resubmit_with_different_key_reprocesses():
    store = IdempotencyStore(window_seconds=60.0)
    produce, calls = _counting_producer()
    payload = {"prompt": "hi"}

    store.execute("key-1", payload, produce)
    store.execute("key-2", payload, produce)

    assert calls["n"] == 2


def test_conflicting_resubmit_raises_conflict():
    store = IdempotencyStore(window_seconds=60.0)
    produce, calls = _counting_producer()

    store.execute("key-1", {"prompt": "hi"}, produce)

    with pytest.raises(IdempotencyConflictError) as exc_info:
        store.execute("key-1", {"prompt": "different"}, produce)

    err = exc_info.value
    assert isinstance(err, AIServiceError)
    assert err.code == "AI_IDEMPOTENCY_CONFLICT"
    assert err.key == "key-1"
    assert calls["n"] == 1, "conflict must not reprocess"


def test_conflict_detected_despite_key_ordering():
    store = IdempotencyStore(window_seconds=60.0)
    produce, _ = _counting_producer()

    store.execute("key-1", {"a": 1, "b": 2}, produce)

    # Same meaning, different key ordering -> not a conflict.
    store.execute("key-1", {"b": 2, "a": 1}, produce)

    with pytest.raises(IdempotencyConflictError):
        store.execute("key-1", {"a": 1, "b": 3}, produce)


def test_window_expiry_allows_reprocessing():
    clock = FakeClock()
    store = IdempotencyStore(window_seconds=10.0, clock=clock)
    produce, calls = _counting_producer(result="original")
    payload = {"prompt": "hi"}

    first = store.execute("key-1", payload, produce)
    assert first == "original"
    assert calls["n"] == 1

    # Still within the window -> cached result.
    clock.advance(9.0)
    assert store.execute("key-1", payload, produce) == "original"
    assert calls["n"] == 1

    # Advance past the window -> fresh processing.
    clock.advance(2.0)
    produce2, calls2 = _counting_producer(result="refreshed")
    second = store.execute("key-1", payload, produce2)
    assert second == "refreshed"
    assert calls2["n"] == 1


def test_window_expiry_allows_different_payload():
    clock = FakeClock()
    store = IdempotencyStore(window_seconds=5.0, clock=clock)
    produce, _ = _counting_producer()

    store.execute("key-1", {"prompt": "hi"}, produce)
    clock.advance(6.0)

    # Expired -> no conflict even with a different payload.
    store.execute("key-1", {"prompt": "other"}, produce)


def test_none_key_always_processes():
    store = IdempotencyStore(window_seconds=60.0)
    produce, calls = _counting_producer()

    store.execute(None, {"prompt": "hi"}, produce)
    store.execute(None, {"prompt": "hi"}, produce)

    assert calls["n"] == 2


def test_lookup_and_forget():
    store = IdempotencyStore(window_seconds=60.0)
    produce, _ = _counting_producer(result="value")

    assert store.lookup("key-1") is None
    store.execute("key-1", {"prompt": "hi"}, produce)
    assert store.lookup("key-1") == "value"

    store.forget("key-1")
    assert store.lookup("key-1") is None


def test_default_window_is_positive():
    assert DEFAULT_WINDOW_SECONDS > 0


def test_invalid_window_rejected():
    with pytest.raises(ValueError):
        IdempotencyStore(window_seconds=0)


def test_process_wide_store_is_shared_and_resettable():
    reset_idempotency_store()
    try:
        store_a = get_idempotency_store()
        store_b = get_idempotency_store()
        assert store_a is store_b

        produce, calls = _counting_producer()
        store_a.execute("key-1", {"prompt": "hi"}, produce)
        store_b.execute("key-1", {"prompt": "hi"}, produce)
        assert calls["n"] == 1

        reset_idempotency_store()
        assert get_idempotency_store() is not store_a
    finally:
        reset_idempotency_store()


def test_concurrent_replays_produce_once():
    store = IdempotencyStore(window_seconds=60.0)
    calls = {"n": 0}
    lock = threading.Lock()
    results = []

    def produce():
        with lock:
            calls["n"] += 1
        return "ok"

    def worker():
        results.append(store.execute("key-1", {"prompt": "hi"}, produce))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert calls["n"] == 1, "concurrent replays must produce once"
    assert all(r == "ok" for r in results)
