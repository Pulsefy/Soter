"""Tests for the structured decision audit store and its endpoint wiring."""

import json

import pytest
from fastapi.testclient import TestClient

from main import app
from services.decision_audit import DecisionAuditStore


@pytest.fixture()
def store(tmp_path):
    audit_store = DecisionAuditStore(
        db_path=str(tmp_path / "audit.db"), retention_days=30
    )
    yield audit_store
    audit_store.close()


def _record(store, trace_id="trace-1", claim_id="claim-1", campaign_ref="camp-1", **overrides):
    payload = dict(
        trace_id=trace_id,
        decision_type="humanitarian_verification",
        provider="openai",
        model="gpt-4o-mini",
        prompt_version="primary",
        claim_id=claim_id,
        campaign_ref=campaign_ref,
        outcome={"verdict": "credible", "confidence": 0.88},
        confidence=0.88,
        reasons=["Claim is well-supported."],
        inputs={"aid_claim": "Teams distributed kits to all households."},
    )
    payload.update(overrides)
    return store.record_decision(**payload)


class TestDecisionAuditStore:
    def test_record_decision_persists_all_fields(self, store):
        row_id = _record(store)
        assert row_id is not None
        records = store.query()
        assert len(records) == 1
        record = records[0]
        assert record["id"] == row_id
        assert record["trace_id"] == "trace-1"
        assert record["decision_type"] == "humanitarian_verification"
        assert record["provider"] == "openai"
        assert record["model"] == "gpt-4o-mini"
        assert record["prompt_version"] == "primary"
        assert record["claim_id"] == "claim-1"
        assert record["campaign_ref"] == "camp-1"
        assert record["confidence"] == 0.88
        assert record["reasons"] == ["Claim is well-supported."]
        assert record["outcome"]["verdict"] == "credible"
        assert record["inputs"]["aid_claim"] == "Teams distributed kits to all households."
        assert record["created_at"]

    def test_redacts_sensitive_inputs_before_persistence(self, store):
        _record(
            store,
            inputs={
                "aid_claim": "Family needs food.",
                "contact_email": "jane.doe@example.com",
                "ip_address": "192.168.1.10",
                "api_token": "sk-abcdefghijklmnopqrstuvwxyz1234567890",
            },
        )
        records = store.query()
        stored = json.dumps(records[0]["inputs"])
        assert "jane.doe@example.com" not in stored
        assert "192.168.1.10" not in stored
        assert "sk-abcdefghijklmnopqrstuvwxyz1234567890" not in stored
        assert stored.count("[REDACTED]") >= 3

    def test_query_by_trace_id(self, store):
        _record(store, trace_id="trace-a")
        _record(store, trace_id="trace-b")
        records = store.query(trace_id="trace-a")
        assert len(records) == 1
        assert records[0]["trace_id"] == "trace-a"

    def test_query_by_claim_id(self, store):
        _record(store, claim_id="claim-xyz")
        _record(store, claim_id="claim-abc")
        records = store.query(claim_id="claim-xyz")
        assert len(records) == 1
        assert records[0]["claim_id"] == "claim-xyz"

    def test_query_by_campaign_ref(self, store):
        _record(store, campaign_ref="campaign-2024-001")
        _record(store, campaign_ref="campaign-2025-002")
        records = store.query(campaign_ref="campaign-2024-001")
        assert len(records) == 1
        assert records[0]["campaign_ref"] == "campaign-2024-001"

    def test_query_combined_filters_and_newest_first(self, store):
        _record(store, trace_id="t", claim_id="c", campaign_ref="camp")
        _record(store, trace_id="t", claim_id="c", campaign_ref="camp")
        records = store.query(trace_id="t", claim_id="c", campaign_ref="camp")
        assert len(records) == 2
        assert records[0]["id"] > records[1]["id"]

    def test_query_pagination(self, store):
        for i in range(5):
            _record(store, trace_id=f"trace-{i}")
        page1 = store.query(limit=2, offset=0)
        page2 = store.query(limit=2, offset=2)
        assert len(page1) == 2
        assert len(page2) == 2
        ids1 = {r["id"] for r in page1}
        ids2 = {r["id"] for r in page2}
        assert ids1.isdisjoint(ids2)

    def test_records_survive_store_restart(self, tmp_path):
        db_path = str(tmp_path / "audit.db")
        first = DecisionAuditStore(db_path=db_path, retention_days=30)
        row_id = _record(first, trace_id="trace-persist")
        first.close()

        second = DecisionAuditStore(db_path=db_path, retention_days=30)
        try:
            records = second.query(trace_id="trace-persist")
            assert len(records) == 1
            assert records[0]["id"] == row_id
        finally:
            second.close()

    def test_prune_removes_records_older_than_retention(self, store):
        _record(store, trace_id="recent")
        # Simulate an old record by rewriting its created_at directly.
        import sqlite3

        with sqlite3.connect(store.db_path) as conn:
            conn.execute(
                "UPDATE decision_audit SET created_at = '2000-01-01T00:00:00+00:00' "
                "WHERE trace_id = 'recent'"
            )
            conn.commit()

        deleted = store.prune(retention_days=7)
        assert deleted == 1
        assert store.count() == 0

    def test_prune_keeps_recent_records(self, store):
        _record(store, trace_id="recent")
        deleted = store.prune(retention_days=7)
        assert deleted == 0
        assert store.count() == 1

    def test_disabled_store_is_noop(self, tmp_path):
        disabled = DecisionAuditStore(
            db_path=str(tmp_path / "disabled.db"), enabled=False
        )
        row_id = _record(disabled)
        assert row_id is None
        assert disabled.query() == []
        assert disabled.count() == 0
        assert disabled.prune() == 0
        disabled.close()


class TestDecisionAuditEndpointWiring:
    def test_fraud_endpoint_writes_audit_record(self, tmp_path, monkeypatch):
        audit_store = DecisionAuditStore(db_path=str(tmp_path / "fraud.db"))
        monkeypatch.setattr(app.state, "decision_audit_store", audit_store)
        try:
            client = TestClient(app)
            resp = client.post(
                "/v1/fraud/detect",
                json={
                    "claims": [
                        {
                            "claim_id": "claim-fraud-1",
                            "ip_address": "1.2.3.4",
                            "amount": 100.0,
                        }
                    ],
                    "anchor_metadata": {
                        "claim_id": "claim-fraud-1",
                        "campaign_ref": "campaign-anti-fraud",
                    },
                },
            )
            assert resp.status_code == 200
            assert resp.json()["trace_id"] is not None

            records = audit_store.query(decision_type="fraud_detection")
            assert len(records) == 1
            record = records[0]
            assert record["claim_id"] == "claim-fraud-1"
            assert record["campaign_ref"] == "campaign-anti-fraud"
            assert record["model"] == "LocalOutlierFactor"
            assert record["outcome"][0]["claim_id"] == "claim-fraud-1"
            assert "1.2.3.4" not in json.dumps(record["inputs"])
        finally:
            audit_store.close()

    def test_humanitarian_endpoint_writes_audit_record(self, tmp_path, monkeypatch):
        import main as main_module

        def fake_verify(
            aid_claim,
            supporting_evidence=None,
            context_factors=None,
            provider_preference="auto",
            timeout=None,
        ):
            return {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "prompt_variant": "primary",
                "verification": {
                    "verdict": "credible",
                    "confidence": 0.88,
                    "summary": "Claim is well-supported.",
                },
                "raw_response": "{}",
            }

        monkeypatch.setattr(
            main_module.humanitarian_verification_service, "verify_claim", fake_verify
        )

        audit_store = DecisionAuditStore(db_path=str(tmp_path / "verify.db"))
        monkeypatch.setattr(app.state, "decision_audit_store", audit_store)
        try:
            client = TestClient(app)
            resp = client.post(
                "/v1/ai/humanitarian/verify",
                json={
                    "aid_claim": "Family of 5 displaced by flood needs food and shelter",
                    "supporting_evidence": ["photo of damaged home"],
                    "context_factors": {"location": "Kano, Nigeria"},
                    "provider_preference": "auto",
                    "anchor_metadata": {
                        "claim_id": "claim-verify-1",
                        "campaign_ref": "campaign-aid-2024",
                    },
                },
            )
            assert resp.status_code == 200
            assert resp.json()["trace_id"] is not None

            records = audit_store.query(
                decision_type="humanitarian_verification"
            )
            assert len(records) == 1
            record = records[0]
            assert record["claim_id"] == "claim-verify-1"
            assert record["campaign_ref"] == "campaign-aid-2024"
            assert record["provider"] == "openai"
            assert record["model"] == "gpt-4o-mini"
            assert record["prompt_version"] == "primary"
            assert record["outcome"]["verdict"] == "credible"
        finally:
            audit_store.close()

    def test_audit_query_endpoint_filters_by_trace_and_claim(self, tmp_path, monkeypatch):
        audit_store = DecisionAuditStore(db_path=str(tmp_path / "query.db"))
        _record(audit_store, trace_id="trace-q1", claim_id="claim-q1", campaign_ref="camp-q")
        _record(audit_store, trace_id="trace-q2", claim_id="claim-q2", campaign_ref="camp-q")
        monkeypatch.setattr(app.state, "decision_audit_store", audit_store)
        try:
            client = TestClient(app)
            resp = client.get(
                "/v1/ai/audit/decisions",
                params={"trace_id": "trace-q1", "claim_id": "claim-q1"},
            )
            assert resp.status_code == 200
            records = resp.json()["records"]
            assert len(records) == 1
            assert records[0]["trace_id"] == "trace-q1"
            assert records[0]["claim_id"] == "claim-q1"
        finally:
            audit_store.close()

    def test_audit_query_endpoint_filters_by_campaign(self, tmp_path, monkeypatch):
        audit_store = DecisionAuditStore(db_path=str(tmp_path / "query2.db"))
        _record(audit_store, campaign_ref="campaign-a", decision_type="fraud_detection")
        _record(audit_store, campaign_ref="campaign-b", decision_type="fraud_detection")
        monkeypatch.setattr(app.state, "decision_audit_store", audit_store)
        try:
            client = TestClient(app)
            resp = client.get(
                "/v1/ai/audit/decisions",
                params={"campaign_ref": "campaign-a"},
            )
            assert resp.status_code == 200
            records = resp.json()["records"]
            assert len(records) == 1
            assert records[0]["campaign_ref"] == "campaign-a"
        finally:
            audit_store.close()
