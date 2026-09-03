"""Tests for structured decision audit records (issue #990).

One test class per acceptance criterion:

* every decision writes a record with inputs, provider, model, prompt version,
  and outcome
* records are queryable by trace id, claim id, and campaign reference
* sensitive fields are redacted per ``logging_redaction.py`` before persistence
* records survive process restart
* retention is configurable
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from main import app
from services.decision_audit import (
    DecisionAuditRecord,
    DecisionAuditStore,
    build_store_from_settings,
)
from services.fraud_detection import FRAUD_RULES_VERSION
from services.humanitarian_prompt import HUMANITARIAN_PROMPT_VERSION


@pytest.fixture
def store(tmp_path) -> DecisionAuditStore:
    """A store backed by a throwaway log file."""
    return DecisionAuditStore(path=str(tmp_path / "audit.jsonl"), retention_days=90.0)


@pytest.fixture
def client(store):
    """TestClient with the audit store swapped for the throwaway one.

    The store is swapped *after* entering the context manager: the lifespan
    re-asserts the production store on ``app.state`` at startup, so an earlier
    assignment would be overwritten.
    """
    previous = getattr(app.state, "decision_audit_store", None)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        app.state.decision_audit_store = store
        yield test_client
    app.state.decision_audit_store = previous


# ---------------------------------------------------------------------------
# AC1: every decision writes a complete record
# ---------------------------------------------------------------------------


class TestRecordCompleteness:
    def test_record_captures_all_required_fields(self, store):
        record = store.record(
            "humanitarian_verification",
            "eligible",
            trace_id="trace-1",
            claim_id="claim-1",
            campaign_ref="campaign-1",
            provider="openai",
            model="gpt-4o",
            prompt_version=HUMANITARIAN_PROMPT_VERSION,
            prompt_variant="primary",
            confidence=0.91,
            reasons=["Meets Sphere shelter criteria"],
            inputs={"aid_claim": "Family of five displaced by flooding"},
        )

        assert record is not None
        assert record.decision_type == "humanitarian_verification"
        assert record.outcome == "eligible"
        assert record.provider == "openai"
        assert record.model == "gpt-4o"
        assert record.prompt_version == HUMANITARIAN_PROMPT_VERSION
        assert record.prompt_variant == "primary"
        assert record.confidence == 0.91
        assert record.reasons == ["Meets Sphere shelter criteria"]
        assert record.inputs["aid_claim"].startswith("Family of five")
        assert record.record_id.startswith("da_")
        assert record.created_at > 0

    def test_disabled_store_is_a_no_op(self, tmp_path):
        disabled = DecisionAuditStore(path=str(tmp_path / "off.jsonl"), enabled=False)
        assert disabled.record("fraud_detection", "cleared") is None
        assert len(disabled) == 0

    def test_verification_endpoint_writes_a_record(self, client, store):
        service = MagicMock()
        service.get_model_version.return_value = "openai:gpt-4o"
        service.verify_claim.return_value = {
            "provider": "openai",
            "model": "gpt-4o",
            "prompt_variant": "primary",
            "verification": {
                "eligible": False,
                "confidence": 0.42,
                "reasoning": "Evidence does not establish displacement",
            },
            "raw_response": "{}",
        }
        previous = app.state.humanitarian_verification_service
        app.state.humanitarian_verification_service = service
        try:
            response = client.post(
                "/v1/ai/humanitarian/verify",
                json={
                    "aid_claim": "Family of five displaced by flooding in Kano",
                    "supporting_evidence": ["photo of damaged home"],
                    "provider_preference": "test",
                    "anchor_metadata": {
                        "campaign_ref": "campaign-990",
                        "claim_id": "claim-990",
                    },
                },
            )
        finally:
            app.state.humanitarian_verification_service = previous

        assert response.status_code == 200, response.text

        records = store.query(claim_id="claim-990")
        assert len(records) == 1
        record = records[0]
        assert record.decision_type == "humanitarian_verification"
        assert record.outcome == "ineligible"
        assert record.provider == "openai"
        assert record.model == "gpt-4o"
        assert record.prompt_version == HUMANITARIAN_PROMPT_VERSION
        assert record.campaign_ref == "campaign-990"
        assert "aid_claim" in record.inputs

    def test_verification_failure_is_also_audited(self, client, store):
        service = MagicMock()
        service.get_model_version.return_value = "openai:gpt-4o"
        service.verify_claim.side_effect = RuntimeError("provider exploded")
        previous = app.state.humanitarian_verification_service
        app.state.humanitarian_verification_service = service
        try:
            client.post(
                "/v1/ai/humanitarian/verify",
                json={
                    "aid_claim": "Family of five displaced by flooding in Kano",
                    "provider_preference": "test",
                    "anchor_metadata": {"claim_id": "claim-err"},
                },
            )
        finally:
            app.state.humanitarian_verification_service = previous

        records = store.query(claim_id="claim-err")
        assert len(records) == 1
        assert records[0].outcome == "error"

    def test_fraud_endpoint_writes_one_record_per_claim(self, client, store):
        response = client.post(
            "/v1/fraud/detect",
            json={
                "claims": [
                    {"claim_id": "fraud-a", "amount": 100.0, "location": "Kano"},
                    {"claim_id": "fraud-b", "amount": 105.0, "location": "Kano"},
                ],
                "anchor_metadata": {"campaign_ref": "campaign-fraud"},
            },
        )
        assert response.status_code == 200, response.text

        by_campaign = store.query(campaign_ref="campaign-fraud")
        assert len(by_campaign) == 2
        for record in by_campaign:
            assert record.decision_type == "fraud_detection"
            assert record.outcome in {"flagged", "cleared"}
            assert record.provider == "internal"
            assert record.model == "sklearn.LocalOutlierFactor"
            assert record.prompt_version == FRAUD_RULES_VERSION
            assert "fraud_risk_score" in record.metadata

        assert len(store.query(claim_id="fraud-a")) == 1


# ---------------------------------------------------------------------------
# AC2: queryable by trace id, claim id, campaign reference
# ---------------------------------------------------------------------------


class TestQueryability:
    def _seed(self, store):
        store.record(
            "humanitarian_verification",
            "eligible",
            trace_id="trace-x",
            claim_id="claim-x",
            campaign_ref="campaign-x",
        )
        store.record(
            "fraud_detection",
            "flagged",
            trace_id="trace-y",
            claim_id="claim-y",
            campaign_ref="campaign-x",
        )

    def test_query_by_each_identifier(self, store):
        self._seed(store)
        assert len(store.query(trace_id="trace-x")) == 1
        assert len(store.query(claim_id="claim-y")) == 1
        assert len(store.query(campaign_ref="campaign-x")) == 2

    def test_identifiers_intersect(self, store):
        self._seed(store)
        assert len(store.query(campaign_ref="campaign-x", claim_id="claim-y")) == 1
        assert len(store.query(campaign_ref="campaign-x", claim_id="missing")) == 0

    def test_filter_by_decision_type_and_limit(self, store):
        self._seed(store)
        results = store.query(
            campaign_ref="campaign-x", decision_type="fraud_detection"
        )
        assert len(results) == 1
        assert results[0].outcome == "flagged"
        assert len(store.query(campaign_ref="campaign-x", limit=1)) == 1

    def test_unknown_identifier_returns_empty(self, store):
        self._seed(store)
        assert store.query(trace_id="nope") == []

    def test_results_are_newest_first(self, store):
        first = store.record("fraud_detection", "cleared", claim_id="c")
        time.sleep(0.01)
        second = store.record("fraud_detection", "flagged", claim_id="c")
        results = store.query(claim_id="c")
        assert [r.record_id for r in results] == [second.record_id, first.record_id]

    def test_query_endpoint_returns_records(self, client, store):
        store.record(
            "humanitarian_verification",
            "eligible",
            trace_id="trace-http",
            claim_id="claim-http",
            campaign_ref="campaign-http",
        )
        response = client.get("/v1/ai/decision-audit?claim_id=claim-http")
        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["result"]) == 1
        assert body["result"][0]["trace_id"] == "trace-http"

    def test_query_endpoint_requires_an_identifier(self, client):
        response = client.get("/v1/ai/decision-audit")
        assert response.status_code == 400

    def test_get_endpoint_by_record_id(self, client, store):
        record = store.record("fraud_detection", "cleared", claim_id="claim-one")
        found = client.get(f"/v1/ai/decision-audit/{record.record_id}")
        assert found.status_code == 200
        assert found.json()["result"]["record_id"] == record.record_id
        assert client.get("/v1/ai/decision-audit/da_missing").status_code == 404


# ---------------------------------------------------------------------------
# AC3: redaction before persistence
# ---------------------------------------------------------------------------


class TestRedaction:
    def test_sensitive_inputs_are_masked_on_disk(self, store):
        store.record(
            "humanitarian_verification",
            "eligible",
            claim_id="claim-pii",
            inputs={
                "aid_claim": "Reach me at aid.worker@example.com",
                "context_factors": {"phone": "555-123-4567"},
                "supporting_evidence": ["card 4111 1111 1111 1111"],
            },
            reasons=["Reported by aid.worker@example.com"],
            metadata={"api_key": "sk-abcdefghijklmnopqrstuvwxyz012345"},
        )

        raw = open(store.path, encoding="utf-8").read()
        assert "aid.worker@example.com" not in raw
        assert "555-123-4567" not in raw
        assert "4111 1111 1111 1111" not in raw
        assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in raw
        assert "[REDACTED]" in raw

    def test_identifiers_and_scores_survive_redaction(self, store):
        record = store.record(
            "fraud_detection",
            "flagged",
            trace_id="a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            claim_id="claim-keep",
            campaign_ref="campaign-keep",
            confidence=0.77,
            metadata={"fraud_risk_score": 0.23},
        )
        assert record.trace_id == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        assert record.claim_id == "claim-keep"
        assert record.campaign_ref == "campaign-keep"
        assert record.confidence == 0.77
        assert record.metadata["fraud_risk_score"] == 0.23
        # The identifiers must remain usable as query keys after redaction.
        assert len(store.query(trace_id=record.trace_id)) == 1

    def test_fraud_endpoint_redacts_claim_ip(self, client, store):
        client.post(
            "/v1/fraud/detect",
            json={
                "claims": [
                    {
                        "claim_id": "ip-a",
                        "ip_address": "192.168.11.24",
                        "amount": 100.0,
                    },
                    {
                        "claim_id": "ip-b",
                        "ip_address": "192.168.11.25",
                        "amount": 101.0,
                    },
                ]
            },
        )
        raw = open(store.path, encoding="utf-8").read()
        assert "192.168.11.24" not in raw
        assert "[REDACTED]" in raw


# ---------------------------------------------------------------------------
# AC4: durability across restart
# ---------------------------------------------------------------------------


class TestDurability:
    def test_records_reload_after_restart(self, tmp_path):
        path = str(tmp_path / "durable.jsonl")
        first = DecisionAuditStore(path=path)
        first.record(
            "humanitarian_verification",
            "ineligible",
            trace_id="trace-restart",
            claim_id="claim-restart",
            campaign_ref="campaign-restart",
            provider="groq",
            model="llama-3.1",
            prompt_version=HUMANITARIAN_PROMPT_VERSION,
        )

        # A fresh store over the same path stands in for a process restart.
        reloaded = DecisionAuditStore(path=path)
        assert len(reloaded) == 1
        for key, value in (
            ("trace_id", "trace-restart"),
            ("claim_id", "claim-restart"),
            ("campaign_ref", "campaign-restart"),
        ):
            found = reloaded.query(**{key: value})
            assert len(found) == 1, f"lost index for {key}"
            assert found[0].provider == "groq"
            assert found[0].prompt_version == HUMANITARIAN_PROMPT_VERSION

    def test_append_is_one_json_line_per_record(self, store):
        store.record("fraud_detection", "cleared", claim_id="a")
        store.record("fraud_detection", "flagged", claim_id="b")
        lines = [
            line
            for line in open(store.path, encoding="utf-8").read().splitlines()
            if line
        ]
        assert len(lines) == 2
        assert {json.loads(line)["claim_id"] for line in lines} == {"a", "b"}

    def test_malformed_lines_do_not_break_reload(self, tmp_path):
        path = tmp_path / "torn.jsonl"
        good = DecisionAuditRecord(
            decision_type="fraud_detection", outcome="cleared", claim_id="ok"
        )
        path.write_text(
            json.dumps(good.to_dict()) + "\n{ truncated write\n", encoding="utf-8"
        )
        reloaded = DecisionAuditStore(path=str(path))
        assert len(reloaded) == 1
        assert reloaded.query(claim_id="ok")[0].outcome == "cleared"


# ---------------------------------------------------------------------------
# AC5: configurable retention
# ---------------------------------------------------------------------------


class TestRetention:
    def test_expired_records_are_pruned_and_compacted(self, tmp_path):
        path = str(tmp_path / "retention.jsonl")
        store = DecisionAuditStore(path=path, retention_days=1.0)
        fresh = store.record("fraud_detection", "cleared", claim_id="fresh")
        stale = store.record("fraud_detection", "flagged", claim_id="stale")
        # Backdate the stale record past the one-day window.
        stale.created_at = time.time() - (2 * 86400)

        assert store.prune() == 1
        assert len(store) == 1
        assert store.query(claim_id="stale") == []
        assert store.query(claim_id="fresh")[0].record_id == fresh.record_id
        # The compacted log must not resurrect the pruned record on reload.
        assert len(DecisionAuditStore(path=path, retention_days=1.0)) == 1

    def test_expired_records_are_dropped_on_load(self, tmp_path):
        path = tmp_path / "expired.jsonl"
        old = DecisionAuditRecord(
            decision_type="fraud_detection",
            outcome="cleared",
            claim_id="old",
            created_at=time.time() - (10 * 86400),
        )
        path.write_text(json.dumps(old.to_dict()) + "\n", encoding="utf-8")
        assert len(DecisionAuditStore(path=str(path), retention_days=1.0)) == 0

    def test_zero_retention_means_keep_forever(self, tmp_path):
        path = tmp_path / "forever.jsonl"
        ancient = DecisionAuditRecord(
            decision_type="fraud_detection",
            outcome="cleared",
            claim_id="ancient",
            created_at=time.time() - (5000 * 86400),
        )
        path.write_text(json.dumps(ancient.to_dict()) + "\n", encoding="utf-8")
        store = DecisionAuditStore(path=str(path), retention_days=0)
        assert len(store) == 1
        assert store.prune() == 0

    def test_settings_drive_the_store(self, tmp_path):
        settings = MagicMock()
        settings.decision_audit_path = str(tmp_path / "from-settings.jsonl")
        settings.decision_audit_retention_days = 30.0
        settings.decision_audit_enabled = True

        store = build_store_from_settings(settings)
        assert store.retention_days == 30.0
        assert store.enabled is True
        assert store.path.endswith("from-settings.jsonl")

    def test_retention_setting_rejects_negative_values(self):
        from config import Settings

        settings = Settings(decision_audit_retention_days=-1)
        with pytest.raises(Exception) as excinfo:
            settings.validate_configuration()
        assert "DECISION_AUDIT_RETENTION_DAYS" in str(excinfo.value)
