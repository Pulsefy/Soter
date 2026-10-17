"""Per-claim processing time budget with partial-result fallback (issue #1416).

Individual provider calls have their own timeouts, but a claim that chains
multiple steps (OCR → humanitarian verification → fraud scoring) has no
total wall-clock ceiling.  If each step individually retries up to its own
timeout, the cumulative time for one claim can far exceed any single step's
limit.

``ClaimBudget`` is a lightweight context manager that tracks elapsed wall
time across all steps of a pipeline.  Before each step the caller checks
the budget by calling ``check()``.  If the deadline has already passed,
``check()`` raises :class:`~exceptions.ClaimBudgetExceededError` which
carries:

- ``completed_steps`` – a list of ``{"step": name, "result": ...}`` dicts
  for every step that *did* finish before the budget ran out.
- ``pending_steps``   – the step names that were queued but never started.

The caller can then return a partial result and flag the claim for manual
review instead of silently discarding the incomplete work.

Usage::

    from services.claim_budget import ClaimBudget

    budget = ClaimBudget(budget_seconds=settings.claim_processing_budget_seconds)
    with budget:
        budget.check("ocr")
        ocr_result = run_ocr(...)
        budget.record("ocr", ocr_result)

        budget.check("humanitarian_verification", pending=["fraud_scoring"])
        hv_result = run_humanitarian_verification(...)
        budget.record("humanitarian_verification", hv_result)

        budget.check("fraud_scoring")
        fraud_result = run_fraud_detection(...)
        budget.record("fraud_scoring", fraud_result)

    # All steps finished within the budget:
    return budget.results
"""

import logging
import time
from typing import Any, Dict, List, Optional

from exceptions import ClaimBudgetExceededError

logger = logging.getLogger(__name__)


class ClaimBudget:
    """Tracks the total wall-clock time available for a multi-step claim pipeline.

    Args:
        budget_seconds: Maximum number of seconds the pipeline is allowed to
            run in total.  A value of 0 or less disables budget enforcement
            (every ``check()`` call becomes a no-op), which lets operators
            opt out of the feature without code changes.
        task_type: Optional label used in log messages for attribution.

    Attributes:
        results: Ordered list of completed step records, each shaped as
            ``{"step": <name>, "result": <any>}``.  Populated by
            :meth:`record` as the pipeline runs.
    """

    def __init__(
        self,
        budget_seconds: float,
        task_type: str = "unknown",
    ) -> None:
        self._budget_seconds = budget_seconds
        self._task_type = task_type
        self._start: Optional[float] = None
        self.results: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Context manager protocol – starts the clock on entry.
    # ------------------------------------------------------------------

    def __enter__(self) -> "ClaimBudget":
        self._start = time.monotonic()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        # We never swallow exceptions; the context manager exists only to
        # start the clock automatically and keep the call-site tidy.
        return None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def elapsed(self) -> float:
        """Seconds elapsed since the budget was started (i.e. since ``__enter__``)."""
        if self._start is None:
            return 0.0
        return time.monotonic() - self._start

    @property
    def remaining(self) -> float:
        """Seconds remaining before the budget expires.

        Returns a large positive number when budget enforcement is disabled
        (``budget_seconds <= 0``) so callers can always compare against it
        without a special case.
        """
        if self._budget_seconds <= 0:
            return float("inf")
        return max(0.0, self._budget_seconds - self.elapsed)

    def check(
        self,
        step_name: str,
        *,
        pending: Optional[List[str]] = None,
    ) -> None:
        """Assert that the budget has not been exceeded before starting ``step_name``.

        Args:
            step_name: Human-readable label for the step about to start.  Used
                in the error message and logged alongside budget diagnostics.
            pending: Optional list of step names *after* ``step_name`` that
                have not yet started.  Included in the raised
                :class:`~exceptions.ClaimBudgetExceededError` so callers can
                surface which steps were skipped.

        Raises:
            :class:`~exceptions.ClaimBudgetExceededError`: When the elapsed time
                already equals or exceeds ``budget_seconds``.
        """
        if self._budget_seconds <= 0:
            # Budget enforcement disabled by configuration.
            return

        if self._start is None:
            # The context manager was not used; start the clock lazily.
            self._start = time.monotonic()

        elapsed = self.elapsed
        if elapsed >= self._budget_seconds:
            pending_steps = pending or []
            logger.warning(
                "claim_budget_exceeded step=%s elapsed=%.2fs budget=%.2fs "
                "task_type=%s completed_steps=%d pending_steps=%s",
                step_name,
                elapsed,
                self._budget_seconds,
                self._task_type,
                len(self.results),
                pending_steps,
            )
            raise ClaimBudgetExceededError(
                f"Claim processing budget of {self._budget_seconds:.0f}s exceeded "
                f"before step '{step_name}' could start "
                f"(elapsed {elapsed:.2f}s)",
                elapsed=elapsed,
                budget=self._budget_seconds,
                completed_steps=list(self.results),
                pending_steps=list(pending_steps),
            )

        logger.debug(
            "claim_budget step=%s elapsed=%.2fs budget=%.2fs remaining=%.2fs",
            step_name,
            elapsed,
            self._budget_seconds,
            self._budget_seconds - elapsed,
        )

    def record(self, step_name: str, result: Any) -> None:
        """Record a completed step result.

        Call this *after* a step finishes successfully so the result is
        available in :attr:`results` (and in :attr:`ClaimBudgetExceededError.completed_steps`)
        if a later step triggers the budget limit.

        Args:
            step_name: Name of the step that just completed.
            result: The step's output (any JSON-serialisable value).
        """
        self.results.append({"step": step_name, "result": result})
        logger.debug(
            "claim_budget_step_done step=%s elapsed=%.2fs remaining=%.2fs",
            step_name,
            self.elapsed,
            self.remaining,
        )
