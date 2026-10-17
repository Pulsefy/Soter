"""Tests for per-claim processing time budget with partial-result fallback (issue #1416).

Acceptance criteria:
1. A total per-claim processing budget is enforced across the full multi-step pipeline.
2. Exceeding the budget returns whatever steps completed, flags the claim for manual
   review, and does NOT silently drop the incomplete steps.
3. Tests cover a pipeline that completes within budget and one that is deliberately
   made to exceed it.
"""

import time
import uuid
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

import metrics
import tasks
from config import settings
from exceptions import ClaimBudgetExceededError
from services.claim_budget import ClaimBudget

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_task_results():
    """Ensure the global in-memory task store does not leak between tests."""
    original = dict(tasks.task_results)
    yield
    tasks.task_results.clear()
    tasks.task_results.update(original)


@pytest.fixture(autouse=True)
def mock_healthy_resources():
    with patch.object(metrics, "check_system_resources", return_value=True):
        yield


# ---------------------------------------------------------------------------
# Unit tests: ClaimBudget context manager
# ---------------------------------------------------------------------------


class TestClaimBudgetUnit:
    """Low-level unit tests for the ClaimBudget class itself."""

    def test_check_passes_within_budget(self):
        """check() does nothing when there is still time remaining."""
        budget = ClaimBudget(budget_seconds=10.0)
        with budget:
            # Should not raise.
            budget.check("ocr")
            budget.check("humanitarian_verification", pending=["fraud_scoring"])

    def test_check_raises_when_budget_exceeded(self):
        """check() raises ClaimBudgetExceededError once elapsed >= budget."""
        budget = ClaimBudget(budget_seconds=0.01)
        with budget:
            time.sleep(0.05)  # outlast the budget
            with pytest.raises(ClaimBudgetExceededError) as exc_info:
                budget.check("ocr")
        err = exc_info.value
        assert err.elapsed >= 0.01
        assert err.budget == 0.01

    def test_completed_steps_included_in_error(self):
        """completed_steps carries whatever was record()ed before the deadline."""
        budget = ClaimBudget(budget_seconds=0.01)
        with budget:
            budget.record("ocr", {"raw_text": "hello"})
            time.sleep(0.05)
            with pytest.raises(ClaimBudgetExceededError) as exc_info:
                budget.check("humanitarian_verification", pending=["fraud_scoring"])
        err = exc_info.value
        assert len(err.completed_steps) == 1
        assert err.completed_steps[0]["step"] == "ocr"

    def test_pending_steps_included_in_error(self):
        """pending_steps lists what was queued but never started."""
        budget = ClaimBudget(budget_seconds=0.01)
        with budget:
            time.sleep(0.05)
            with pytest.raises(ClaimBudgetExceededError) as exc_info:
                budget.check(
                    "humanitarian_verification",
                    pending=["fraud_scoring"],
                )
        err = exc_info.value
        assert "fraud_scoring" in err.pending_steps

    def test_disabled_budget_never_raises(self):
        """budget_seconds <= 0 disables enforcement — check() is always a no-op."""
        budget = ClaimBudget(budget_seconds=0)
        with budget:
            time.sleep(0.02)
            # Even with zero/disabled budget, no exception is raised.
            budget.check("ocr")
            budget.check("humanitarian_verification")
            budget.check("fraud_scoring")

    def test_record_populates_results(self):
        """record() appends to budget.results in order."""
        budget = ClaimBudget(budget_seconds=10.0)
        with budget:
            budget.record("ocr", {"text": "foo"})
            budget.record("humanitarian_verification", {"verdict": "eligible"})
        assert len(budget.results) == 2
        assert budget.results[0]["step"] == "ocr"
        assert budget.results[1]["step"] == "humanitarian_verification"

    def test_elapsed_starts_at_context_entry(self):
        """elapsed is close to 0 immediately after entering the context manager."""
        budget = ClaimBudget(budget_seconds=10.0)
        with budget:
            assert budget.elapsed < 0.1

    def test_remaining_reflects_unused_budget(self):
        """remaining decreases as time passes."""
        budget = ClaimBudget(budget_seconds=5.0)
        with budget:
            first = budget.remaining
            time.sleep(0.05)
            second = budget.remaining
        assert first > second

    def test_remaining_is_infinite_when_disabled(self):
        """remaining returns infinity when budget enforcement is off."""
        budget = ClaimBudget(budget_seconds=0)
        with budget:
            assert budget.remaining == float("inf")

    def test_str_representation_of_exception(self):
        """ClaimBudgetExceededError has a readable string representation."""
        err = ClaimBudgetExceededError(
            "budget hit",
            elapsed=15.0,
            budget=10.0,
            completed_steps=[],
            pending_steps=["fraud_scoring"],
        )
        text = str(err)
        assert "CLAIM_BUDGET_EXCEEDED" in text
        assert "15.00" in text
        assert "10.00" in text


# ---------------------------------------------------------------------------
# Integration tests: _process_claim_pipeline within-budget path
# ---------------------------------------------------------------------------


class TestClaimPipelineWithinBudget:
    """The pipeline completes all steps when it finishes before the deadline."""

    @pytest.fixture(autouse=True)
    def use_test_provider(self, monkeypatch):
        """Configure the service to use the deterministic test provider."""
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)
        # Generous budget so the fast test pipeline always finishes.
        monkeypatch.setattr(settings, "claim_processing_budget_seconds", 60.0)

    def _make_payload(self, **extra):
        return {
            "data": {
                "aid_claim": "Family of 4 displaced by flooding, requesting food kit",
                "supporting_evidence": ["field_report.pdf"],
                "context_factors": {"region": "test"},
                **extra,
            }
        }

    def test_returns_success_status(self):
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert result["status"] == "success"
        assert result["type"] == "claim_pipeline"

    def test_no_manual_review_flag_on_success(self):
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert result["needs_manual_review"] is False

    def test_humanitarian_verification_present(self):
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert "humanitarian_verification" in result["steps"]

    def test_fraud_scoring_present(self):
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert "fraud_scoring" in result["steps"]
        fraud = result["steps"]["fraud_scoring"]
        assert isinstance(fraud, list)
        assert len(fraud) >= 1

    def test_ocr_skipped_when_no_image(self):
        """Without an image_base64 key OCR is not attempted."""
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert "ocr" not in result["steps"]

    def test_elapsed_and_budget_included(self):
        payload = self._make_payload()
        result = tasks._process_claim_pipeline("task-1", payload)
        assert "elapsed_seconds" in result
        assert "budget_seconds" in result
        assert result["elapsed_seconds"] < result["budget_seconds"]

    def test_process_heavy_inference_dispatches_to_pipeline(self, monkeypatch):
        """process_heavy_inference_impl routes claim_pipeline to the right handler."""
        monkeypatch.setattr(settings, "backend_webhook_url", None)

        called_with = {}

        def fake_pipeline(task_id, payload):
            called_with["task_id"] = task_id
            called_with["payload"] = payload
            return {"type": "claim_pipeline", "status": "success", "steps": {}}

        monkeypatch.setattr(tasks, "_process_claim_pipeline", fake_pipeline)
        monkeypatch.setattr(tasks, "send_webhook_notification", MagicMock())

        payload = {"type": "claim_pipeline", "data": {"aid_claim": "test"}}
        task_id = str(uuid.uuid4())
        tasks.update_task_status(task_id, "pending")

        result = tasks.process_heavy_inference_impl(None, task_id, payload)
        assert called_with["task_id"] == task_id
        assert result["status"] == "success"


# ---------------------------------------------------------------------------
# Integration tests: _process_claim_pipeline over-budget path
# ---------------------------------------------------------------------------


class TestClaimPipelineOverBudget:
    """The pipeline returns a partial result and flags for manual review when
    the budget is exceeded mid-flight."""

    @pytest.fixture(autouse=True)
    def use_test_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "test_provider_mode", True)
        monkeypatch.setattr(settings, "ai_deterministic_mode", True)

    def _make_payload(self, **extra):
        return {
            "data": {
                "aid_claim": "Flood victim requesting emergency shelter",
                **extra,
            }
        }

    def _budget_exhausted_immediately(self):
        """Return a ClaimBudget whose deadline has already passed."""
        budget = ClaimBudget(budget_seconds=0.001, task_type="claim_pipeline")
        budget._start = time.monotonic() - 1.0  # pretend 1s has elapsed
        return budget

    def test_returns_partial_status_when_budget_exceeded(self, monkeypatch):
        """When the budget expires before any step, status is 'partial'."""
        # Patch ClaimBudget.__enter__ to return a pre-expired budget.
        exhausted = self._budget_exhausted_immediately()

        with patch("tasks.ClaimBudget", return_value=exhausted):
            result = tasks._process_claim_pipeline("task-x", self._make_payload())

        assert result["status"] == "partial"
        assert result["type"] == "claim_pipeline"

    def test_needs_manual_review_set_on_over_budget(self, monkeypatch):
        exhausted = self._budget_exhausted_immediately()
        with patch("tasks.ClaimBudget", return_value=exhausted):
            result = tasks._process_claim_pipeline("task-x", self._make_payload())
        assert result["needs_manual_review"] is True

    def test_manual_review_reason_present(self, monkeypatch):
        exhausted = self._budget_exhausted_immediately()
        with patch("tasks.ClaimBudget", return_value=exhausted):
            result = tasks._process_claim_pipeline("task-x", self._make_payload())
        assert "manual_review_reason" in result
        assert isinstance(result["manual_review_reason"], str)
        assert len(result["manual_review_reason"]) > 0

    def test_completed_steps_not_dropped_on_over_budget(self, monkeypatch):
        """Steps that DID finish before the deadline are still in partial_steps."""
        # Budget expires only after humanitarian_verification (not before it).
        task_id = "task-y"
        call_count = [0]
        original_check = ClaimBudget.check

        def tight_check(self, step_name, *, pending=None):
            call_count[0] += 1
            # Simulate time running out before fraud_scoring
            if step_name == "fraud_scoring":
                raise ClaimBudgetExceededError(
                    "budget exceeded before fraud_scoring",
                    elapsed=10.0,
                    budget=9.0,
                    completed_steps=list(self.results),
                    pending_steps=pending or [],
                )

        with patch.object(ClaimBudget, "check", tight_check):
            monkeypatch.setattr(settings, "claim_processing_budget_seconds", 60.0)
            result = tasks._process_claim_pipeline(task_id, self._make_payload())

        assert result["status"] == "partial"
        assert result["needs_manual_review"] is True
        # Humanitarian verification should have completed.
        assert "humanitarian_verification" in result["partial_steps"]

    def test_incomplete_steps_listed(self, monkeypatch):
        """incomplete_steps must list steps that were never started."""
        task_id = "task-z"

        def tight_check(self, step_name, *, pending=None):
            if step_name == "fraud_scoring":
                raise ClaimBudgetExceededError(
                    "budget exceeded",
                    elapsed=10.0,
                    budget=9.0,
                    completed_steps=list(self.results),
                    pending_steps=pending or [],
                )

        with patch.object(ClaimBudget, "check", tight_check):
            monkeypatch.setattr(settings, "claim_processing_budget_seconds", 60.0)
            result = tasks._process_claim_pipeline(task_id, self._make_payload())

        assert "incomplete_steps" in result
        assert isinstance(result["incomplete_steps"], list)

    def test_metric_incremented_on_over_budget(self, monkeypatch):
        """CLAIM_BUDGET_EXCEEDED_TOTAL is incremented exactly once when budget is hit."""
        exhausted = self._budget_exhausted_immediately()
        counter_before = _read_counter(
            metrics.CLAIM_BUDGET_EXCEEDED_TOTAL, task_type="claim_pipeline"
        )
        with patch("tasks.ClaimBudget", return_value=exhausted):
            tasks._process_claim_pipeline("task-m", self._make_payload())
        counter_after = _read_counter(
            metrics.CLAIM_BUDGET_EXCEEDED_TOTAL, task_type="claim_pipeline"
        )
        assert counter_after == counter_before + 1

    def test_metric_not_incremented_on_within_budget(self, monkeypatch):
        """CLAIM_BUDGET_EXCEEDED_TOTAL is NOT incremented on a clean completion."""
        monkeypatch.setattr(settings, "claim_processing_budget_seconds", 60.0)
        counter_before = _read_counter(
            metrics.CLAIM_BUDGET_EXCEEDED_TOTAL, task_type="claim_pipeline"
        )
        tasks._process_claim_pipeline("task-n", self._make_payload())
        counter_after = _read_counter(
            metrics.CLAIM_BUDGET_EXCEEDED_TOTAL, task_type="claim_pipeline"
        )
        assert counter_after == counter_before

    def test_elapsed_and_budget_seconds_present_in_partial_result(self, monkeypatch):
        exhausted = self._budget_exhausted_immediately()
        with patch("tasks.ClaimBudget", return_value=exhausted):
            result = tasks._process_claim_pipeline("task-q", self._make_payload())
        assert "elapsed_seconds" in result
        assert "budget_seconds" in result

    def test_task_marked_completed_not_failed_on_over_budget(self, monkeypatch):
        """A partial result is a completed task (with a special flag), not a failure."""
        monkeypatch.setattr(settings, "backend_webhook_url", None)
        monkeypatch.setattr(settings, "claim_processing_budget_seconds", 60.0)
        monkeypatch.setattr(tasks, "send_webhook_notification", MagicMock())

        exhausted = self._budget_exhausted_immediately()
        with patch("tasks.ClaimBudget", return_value=exhausted):
            task_id = str(uuid.uuid4())
            tasks.update_task_status(task_id, "pending")
            payload = {"type": "claim_pipeline", "data": {"aid_claim": "test"}}
            result = tasks.process_heavy_inference_impl(None, task_id, payload)

        # The heavy inference impl must not raise – it returns a partial result.
        assert result["status"] == "partial"
        status = tasks.task_results[task_id]
        assert status["status"] == "completed"


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------


class TestClaimBudgetConfig:
    """Validate that claim_processing_budget_seconds is surfaced by config validation."""

    def test_default_is_positive(self):
        assert settings.claim_processing_budget_seconds > 0

    def test_validate_configuration_rejects_zero(self, monkeypatch):
        """A budget of 0 must be blocked by validate_configuration (0 means disabled
        in ClaimBudget, but we surface it as a misconfiguration so operators are
        forced to use a positive value or explicitly opt out via the env var)."""
        from config import Settings
        from pydantic_settings import BaseSettings

        # Build a fresh settings object with an invalid value and check that
        # validate_configuration raises.
        s = Settings()
        monkeypatch.setattr(s, "claim_processing_budget_seconds", 0.0)
        with pytest.raises(Exception, match="CLAIM_PROCESSING_BUDGET_SECONDS"):
            s.validate_configuration()

    def test_validate_configuration_rejects_negative(self, monkeypatch):
        from config import Settings

        s = Settings()
        monkeypatch.setattr(s, "claim_processing_budget_seconds", -5.0)
        with pytest.raises(Exception, match="CLAIM_PROCESSING_BUDGET_SECONDS"):
            s.validate_configuration()

    def test_validate_configuration_accepts_positive(self, monkeypatch):
        from config import Settings

        s = Settings()
        monkeypatch.setattr(s, "claim_processing_budget_seconds", 30.0)
        # Should not raise for a valid positive value.
        # validate_configuration() may raise for other reasons (e.g. no API keys
        # in test env), but specifically the budget check should not fire.
        try:
            s.validate_configuration()
        except Exception as exc:
            assert "CLAIM_PROCESSING_BUDGET_SECONDS" not in str(exc)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_counter(counter, **labels) -> float:
    """Read the current value of a prometheus_client Counter."""
    try:
        return counter.labels(**labels)._value.get()
    except Exception:
        return 0.0
