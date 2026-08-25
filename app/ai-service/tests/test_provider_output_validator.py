"""Tests for services/provider_output_validator.py.

Coverage:
- Valid JSON passes straight through
- Markdown-fenced JSON (```json ... ```) is stripped and parsed
- Truncated JSON is repaired and validated successfully
- Prose responses (no JSON structure) raise ProviderOutputError
- Explicit provider refusals raise ProviderRefusalError with the right reason
- Schema violations (missing required keys) raise ProviderOutputError
- Repair succeeds when truncation is mild (one missing brace/bracket)
- Exhausted retries produce ProviderOutputError with attempts == max_repair_attempts
- Empty / whitespace-only content raises ProviderOutputError immediately
- Nested-object truncation is repaired correctly
- _strip_markdown_fence handles all common fence variants
- _repair_truncated_json leaves already-valid JSON untouched
- _detect_refusal identifies all registered refusal patterns
- _looks_like_prose rejects JSON, accepts prose
- ProviderOutputValidator constructor validates max_repair_attempts
"""

import json
import pytest

from exceptions import ProviderOutputError, ProviderRefusalError
from services.provider_output_validator import (
    HUMANITARIAN_PRIMARY_KEYS,
    ProviderOutputValidator,
    _detect_refusal,
    _looks_like_prose,
    _repair_truncated_json,
    _strip_markdown_fence,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

VALID_RESPONSE = json.dumps(
    {
        "verdict": "credible",
        "confidence": 0.85,
        "summary": "Claim is consistent with field reports.",
        "risk_flags": [],
        "missing_information": [],
        "recommended_next_steps": ["Follow up with local NGO"],
    }
)

REQUIRED_KEYS = {"verdict", "confidence", "summary"}


def make_validator(**kwargs) -> ProviderOutputValidator:
    return ProviderOutputValidator(
        required_keys=REQUIRED_KEYS,
        max_repair_attempts=kwargs.get("max_repair_attempts", 2),
    )


# ---------------------------------------------------------------------------
# Helper unit tests
# ---------------------------------------------------------------------------


class TestStripMarkdownFence:
    def test_strips_json_labeled_fence(self):
        text = "```json\n{\"a\": 1}\n```"
        assert _strip_markdown_fence(text) == '{"a": 1}'

    def test_strips_plain_fence(self):
        text = "```\n{\"a\": 1}\n```"
        assert _strip_markdown_fence(text) == '{"a": 1}'

    def test_leaves_plain_json_untouched(self):
        text = '{"a": 1}'
        assert _strip_markdown_fence(text) == text

    def test_strips_fence_with_trailing_whitespace(self):
        text = "```json  \n{\"x\": 2}\n```  "
        result = _strip_markdown_fence(text)
        assert result == '{"x": 2}'

    def test_strips_fence_with_no_newline_after_opening(self):
        text = '```json{"a":1}```'
        result = _strip_markdown_fence(text)
        assert result == '{"a":1}'


class TestRepairTruncatedJson:
    def test_leaves_valid_json_untouched(self):
        text = '{"a": 1}'
        assert _repair_truncated_json(text) == text

    def test_closes_single_missing_brace(self):
        text = '{"verdict": "credible", "confidence": 0.9'
        repaired = _repair_truncated_json(text)
        # Should be parseable after repair
        parsed = json.loads(repaired)
        assert parsed["verdict"] == "credible"

    def test_closes_missing_bracket_and_brace(self):
        text = '{"items": [1, 2, 3'
        repaired = _repair_truncated_json(text)
        parsed = json.loads(repaired)
        assert parsed["items"] == [1, 2, 3]

    def test_removes_trailing_comma_before_closing(self):
        text = '{"a": 1, "b": 2,'
        repaired = _repair_truncated_json(text)
        parsed = json.loads(repaired)
        assert parsed == {"a": 1, "b": 2}

    def test_nested_truncation(self):
        text = '{"outer": {"inner": "value"'
        repaired = _repair_truncated_json(text)
        parsed = json.loads(repaired)
        assert parsed["outer"]["inner"] == "value"

    def test_deeply_nested_truncation(self):
        text = '{"a": {"b": {"c": [1, 2'
        repaired = _repair_truncated_json(text)
        parsed = json.loads(repaired)
        assert parsed["a"]["b"]["c"] == [1, 2]

    def test_already_balanced_array(self):
        text = '[1, 2, 3]'
        assert _repair_truncated_json(text) == text


class TestDetectRefusal:
    def test_cannot_help_detected(self):
        assert _detect_refusal("I cannot help with this request.") == "content_policy"

    def test_cannot_assist_detected(self):
        assert _detect_refusal("I cannot assist with humanitarian claims.") == "content_policy"

    def test_unable_to_detected(self):
        assert _detect_refusal("I'm unable to provide a response.") == "content_policy"

    def test_safety_filter_detected(self):
        assert _detect_refusal("This triggers a safety filter.") == "safety_filter"

    def test_policy_violation_detected(self):
        assert _detect_refusal("This violates my content policy.") == "content_policy"

    def test_sorry_but_cannot(self):
        assert _detect_refusal("I'm sorry, but I can't do that.") == "content_policy"

    def test_not_appropriate(self):
        assert _detect_refusal("That is not appropriate to answer.") == "content_policy"

    def test_valid_json_not_detected(self):
        assert _detect_refusal('{"verdict": "credible", "confidence": 0.9}') is None

    def test_neutral_prose_not_detected(self):
        assert _detect_refusal("The claim is credible based on evidence.") is None

    def test_case_insensitive(self):
        assert _detect_refusal("I CANNOT HELP with this.") == "content_policy"

    def test_i_wont_help(self):
        assert _detect_refusal("I won't help with that task.") == "content_policy"

    def test_will_not_assist(self):
        assert _detect_refusal("I will not assist with this.") == "content_policy"


class TestLooksLikeProse:
    def test_json_object_not_prose(self):
        assert _looks_like_prose('{"a": 1}') is False

    def test_json_array_not_prose(self):
        assert _looks_like_prose('[1, 2, 3]') is False

    def test_markdown_fence_not_prose(self):
        assert _looks_like_prose('```json\n{"a":1}\n```') is False

    def test_plain_sentence_is_prose(self):
        assert _looks_like_prose("The aid was distributed successfully.") is True

    def test_empty_string_is_prose(self):
        # Empty strings are handled separately, but the helper should be consistent
        assert _looks_like_prose("") is True


# ---------------------------------------------------------------------------
# ProviderOutputValidator unit tests
# ---------------------------------------------------------------------------


class TestProviderOutputValidatorConstruction:
    def test_default_required_keys(self):
        v = ProviderOutputValidator()
        assert v.required_keys == HUMANITARIAN_PRIMARY_KEYS

    def test_custom_required_keys(self):
        v = ProviderOutputValidator(required_keys={"a", "b"})
        assert v.required_keys == frozenset({"a", "b"})

    def test_max_repair_attempts_must_be_positive(self):
        with pytest.raises(ValueError, match="max_repair_attempts must be >= 1"):
            ProviderOutputValidator(max_repair_attempts=0)

    def test_max_repair_attempts_of_one_is_valid(self):
        v = ProviderOutputValidator(max_repair_attempts=1)
        assert v.max_repair_attempts == 1


class TestValidatorHappyPath:
    def test_valid_json_passes_through(self):
        v = make_validator()
        result = v.validate(VALID_RESPONSE)
        assert result["verdict"] == "credible"
        assert result["confidence"] == 0.85

    def test_markdown_fenced_json_accepted(self):
        v = make_validator()
        fenced = f"```json\n{VALID_RESPONSE}\n```"
        result = v.validate(fenced)
        assert result["verdict"] == "credible"

    def test_plain_fence_accepted(self):
        v = make_validator()
        fenced = f"```\n{VALID_RESPONSE}\n```"
        result = v.validate(fenced)
        assert result["verdict"] == "credible"

    def test_whitespace_around_json_accepted(self):
        v = make_validator()
        result = v.validate(f"\n\n  {VALID_RESPONSE}  \n")
        assert result["verdict"] == "credible"

    def test_extra_keys_are_preserved(self):
        v = make_validator()
        payload = {
            "verdict": "inconclusive",
            "confidence": 0.5,
            "summary": "Insufficient evidence",
            "extra_field": "allowed",
        }
        result = v.validate(json.dumps(payload))
        assert result["extra_field"] == "allowed"


class TestValidatorRefusals:
    def test_cannot_help_raises_refusal_error(self):
        v = make_validator()
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate("I cannot help with this humanitarian claim.")
        assert exc_info.value.refusal_reason == "content_policy"
        assert "humanitarian claim" in exc_info.value.raw_content

    def test_safety_filter_raises_refusal_error(self):
        v = make_validator()
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate("This request triggered a safety filter and cannot be processed.")
        assert exc_info.value.refusal_reason == "safety_filter"

    def test_policy_violation_raises_refusal_error(self):
        v = make_validator()
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate("Your request violates my content policy.")
        assert exc_info.value.refusal_reason == "content_policy"
        assert isinstance(exc_info.value, ProviderRefusalError)

    def test_sorry_but_cannot_raises_refusal_error(self):
        v = make_validator()
        with pytest.raises(ProviderRefusalError):
            v.validate("I'm sorry, but I can't provide a response to this claim.")

    def test_refusal_error_carries_raw_content(self):
        v = make_validator()
        raw = "I'm unable to assist with this type of request."
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate(raw)
        assert exc_info.value.raw_content == raw

    def test_refusal_error_is_subclass_of_ai_service_error(self):
        from exceptions import AIServiceError
        v = make_validator()
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate("I cannot help with that.")
        assert isinstance(exc_info.value, AIServiceError)

    def test_refusal_error_str_contains_reason(self):
        v = make_validator()
        with pytest.raises(ProviderRefusalError) as exc_info:
            v.validate("I won't help with this.")
        assert "content_policy" in str(exc_info.value)


class TestValidatorProse:
    def test_plain_prose_raises_output_error(self):
        v = make_validator()
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate("The claim appears credible based on the evidence presented.")
        # Should specifically call out prose vs refusal
        assert "prose" in exc_info.value.message.lower()

    def test_prose_error_carries_raw_content(self):
        v = make_validator()
        raw = "This is just a sentence, not JSON at all."
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(raw)
        assert exc_info.value.raw_content == raw

    def test_empty_string_raises_output_error(self):
        v = make_validator()
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate("")
        assert "empty" in exc_info.value.message.lower()

    def test_whitespace_only_raises_output_error(self):
        v = make_validator()
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate("   \n\t  ")
        assert "empty" in exc_info.value.message.lower()


class TestValidatorSchemaViolation:
    def test_missing_single_required_key_raises_output_error(self):
        v = make_validator()
        # verdict and confidence present, summary missing
        payload = json.dumps({"verdict": "credible", "confidence": 0.8})
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(payload)
        assert "summary" in exc_info.value.message

    def test_missing_all_required_keys_raises_output_error(self):
        v = make_validator()
        payload = json.dumps({"completely": "wrong", "schema": True})
        with pytest.raises(ProviderOutputError):
            v.validate(payload)

    def test_json_array_instead_of_object_raises_output_error(self):
        v = make_validator()
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate("[1, 2, 3]")
        assert "object" in exc_info.value.message.lower()

    def test_schema_error_is_output_error_not_refusal(self):
        v = make_validator()
        with pytest.raises(ProviderOutputError):
            v.validate(json.dumps({"wrong": "keys"}))

    def test_output_error_carries_raw_content(self):
        v = make_validator()
        raw = json.dumps({"wrong": "keys"})
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(raw)
        assert exc_info.value.raw_content == raw


class TestValidatorTruncatedJson:
    def test_truncated_object_is_repaired(self):
        v = make_validator()
        truncated = '{"verdict": "credible", "confidence": 0.9, "summary": "ok"'
        result = v.validate(truncated)
        assert result["verdict"] == "credible"

    def test_truncated_with_nested_array_is_repaired(self):
        v = make_validator()
        truncated = (
            '{"verdict": "inconclusive", "confidence": 0.5, "summary": "unclear", '
            '"risk_flags": ["missing documents", "unverified location"'
        )
        result = v.validate(truncated)
        assert result["verdict"] == "inconclusive"
        assert "missing documents" in result["risk_flags"]

    def test_truncated_object_mid_value_raises_after_exhausted_retries(self):
        """A response cut off inside a string value cannot be repaired."""
        v = make_validator(max_repair_attempts=2)
        # Truncated mid-string — the value is unclosed and the bracket balancer
        # cannot fix it because the string's double-quote is still "open"
        truncated = '{"verdict": "credible", "confidence": 0.9, "summary": "truncated mid-str'
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(truncated)
        assert exc_info.value.attempts == 2

    def test_valid_json_without_required_keys_not_repaired(self):
        """Repair heuristic only applies to parse errors, not schema errors."""
        v = make_validator(max_repair_attempts=2)
        # Valid JSON but wrong schema — repair won't help
        payload = json.dumps({"wrong": "schema"})
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(payload)
        assert exc_info.value.attempts == 2


class TestValidatorRepairBound:
    def test_attempts_equals_max_on_exhaustion(self):
        v = make_validator(max_repair_attempts=3)
        garbage = '{"verdict": "x", "confidence": invalid'
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(garbage)
        assert exc_info.value.attempts == 3

    def test_single_attempt_max_raises_immediately(self):
        v = make_validator(max_repair_attempts=1)
        truncated = '{"verdict": "credible"'
        # With only 1 attempt, there is no repair cycle and it must raise
        # ProviderOutputError (attempts=1)
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate(truncated)
        assert exc_info.value.attempts == 1

    def test_repair_succeeds_on_second_attempt(self):
        """Verify the repair cycle actually runs and succeeds."""
        v = make_validator(max_repair_attempts=2)
        # Missing closing brace — repairable
        truncated = '{"verdict": "credible", "confidence": 0.9, "summary": "ok"'
        result = v.validate(truncated)
        assert result["verdict"] == "credible"

    def test_output_error_is_subclass_of_ai_service_error(self):
        from exceptions import AIServiceError
        v = make_validator()
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate('{"no": "required keys"}')
        assert isinstance(exc_info.value, AIServiceError)

    def test_output_error_str_includes_attempts(self):
        v = make_validator(max_repair_attempts=2)
        with pytest.raises(ProviderOutputError) as exc_info:
            v.validate('{"no": "required keys"}')
        assert "attempts=2" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Integration tests: HumanitarianVerificationService + validator
# ---------------------------------------------------------------------------


class TestHumanitarianVerificationServiceOutputHandling:
    """End-to-end tests that exercise the wiring between verify_claim and the
    validator without making any real network calls."""

    def _make_service_with_stub(self, responses):
        """Return a service configured with a stub provider that yields *responses*."""
        from services.humanitarian_verification import HumanitarianVerificationService
        from services.providers import ProviderRegistry, ModelProvider, LLMResponse
        from unittest.mock import MagicMock

        class StubProvider(ModelProvider):
            def __init__(self, resps):
                self._resps = list(resps)
                self._idx = 0

            @property
            def name(self):
                return "stub"

            def llm_chat(self, system_prompt, user_prompt, *, model=None, timeout=None):
                if self._idx >= len(self._resps):
                    raise RuntimeError("No more stub responses")
                r = self._resps[self._idx]
                self._idx += 1
                if isinstance(r, Exception):
                    raise r
                return LLMResponse(content=r, provider="stub", model=model or "stub-model")

        stub = StubProvider(responses)
        registry = MagicMock(spec=ProviderRegistry)
        registry.resolve_llm.return_value = [("stub", stub)]

        svc = HumanitarianVerificationService(registry=registry)
        svc._get_model_for_provider = lambda p: "stub-model"
        return svc

    # --- Refusal handling ---

    def test_refusal_on_primary_skips_to_next_provider_not_fallback(self):
        """A refusal should break out of both prompt variants for that provider."""
        svc = self._make_service_with_stub([
            # primary: refusal
            "I cannot help with this humanitarian claim.",
            # fallback should NOT be reached; if it is, it would succeed
            VALID_RESPONSE,
        ])
        with pytest.raises(RuntimeError, match="All humanitarian verification attempts failed"):
            svc.verify_claim(
                aid_claim="Aid delivered to 200 households.",
                supporting_evidence=["field report"],
            )

    def test_refusal_does_not_trip_circuit_breaker(self):
        """A refusal is a structured provider outcome, not a transport failure."""
        from services.circuit_breaker import CircuitBreaker
        from unittest.mock import patch

        svc = self._make_service_with_stub([
            "I cannot help with that.",
        ])
        # Override _get_breaker to track if record_failure is called
        breaker = CircuitBreaker(name="stub", failure_threshold=3, recovery_timeout=60)
        svc.breakers["stub"] = breaker

        with pytest.raises(RuntimeError):
            svc.verify_claim(
                aid_claim="Aid claim text here.",
                supporting_evidence=[],
            )

        # record_failure should NOT have been called for a refusal
        assert breaker.failure_count == 0

    # --- Malformed output handling ---

    def test_malformed_primary_falls_through_to_fallback(self):
        """Persistent malformed primary output allows the fallback prompt to be tried."""
        svc = self._make_service_with_stub([
            # primary: bad schema
            json.dumps({"wrong": "schema"}),
            # fallback: good response
            VALID_RESPONSE,
        ])
        result = svc.verify_claim(
            aid_claim="Aid distributed successfully.",
            supporting_evidence=["distribution log"],
        )
        assert result["prompt_variant"] == "fallback"
        assert result["verification"]["verdict"] == "credible"

    def test_malformed_output_does_not_trip_circuit_breaker(self):
        """Parse failures should not increment the circuit breaker failure count."""
        from services.circuit_breaker import CircuitBreaker

        svc = self._make_service_with_stub([
            # Both variants: bad schema — triggers ProviderOutputError
            json.dumps({"wrong": "schema"}),
            json.dumps({"wrong": "schema"}),
        ])
        breaker = CircuitBreaker(name="stub", failure_threshold=3, recovery_timeout=60)
        svc.breakers["stub"] = breaker

        with pytest.raises(RuntimeError):
            svc.verify_claim(
                aid_claim="Test claim.",
                supporting_evidence=[],
            )

        assert breaker.failure_count == 0

    def test_truncated_json_is_repaired_and_returned(self):
        """A truncated but repairable response should succeed without error."""
        truncated = '{"verdict": "credible", "confidence": 0.9, "summary": "ok"'
        svc = self._make_service_with_stub([truncated])
        result = svc.verify_claim(
            aid_claim="Aid delivered.",
            supporting_evidence=[],
        )
        assert result["verification"]["verdict"] == "credible"

    def test_prose_response_falls_through_to_fallback(self):
        """Pure prose on primary → ProviderOutputError → try fallback."""
        svc = self._make_service_with_stub([
            # primary: prose
            "The aid claim appears to be valid based on the evidence.",
            # fallback: valid JSON
            VALID_RESPONSE,
        ])
        result = svc.verify_claim(
            aid_claim="Claim about food distribution.",
            supporting_evidence=[],
        )
        assert result["prompt_variant"] == "fallback"
        assert result["verification"]["verdict"] == "credible"

    def test_all_variants_malformed_raises_runtime_error(self):
        """When every prompt variant fails with ProviderOutputError, RuntimeError is raised."""
        svc = self._make_service_with_stub([
            json.dumps({"wrong": "schema"}),
            json.dumps({"wrong": "schema"}),
        ])
        with pytest.raises(RuntimeError, match="All humanitarian verification attempts failed"):
            svc.verify_claim(
                aid_claim="A claim.",
                supporting_evidence=[],
            )

    def test_transport_error_trips_circuit_breaker(self):
        """A network/transport error (not ProviderOutputError) DOES trip the breaker."""
        from services.circuit_breaker import CircuitBreaker

        svc = self._make_service_with_stub([
            RuntimeError("Connection refused"),
            RuntimeError("Connection refused"),
        ])
        breaker = CircuitBreaker(name="stub", failure_threshold=10, recovery_timeout=60)
        svc.breakers["stub"] = breaker

        with pytest.raises(RuntimeError):
            svc.verify_claim(
                aid_claim="Test.",
                supporting_evidence=[],
            )

        assert breaker.failure_count == 2  # both prompt variants failed
