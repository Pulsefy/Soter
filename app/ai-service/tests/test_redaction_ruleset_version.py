"""Tests for explicit versioning of the redaction rule set (issue #1428).

One test class per acceptance criterion:

* redaction output, and anything persisting a redacted result (including
  decision audit records), carries the rule-set version active at the time
* a changelog tracks what changed between versions
* the version is present on redacted output
"""

from __future__ import annotations

import json
import re
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from redaction_ruleset import REDACTION_RULESET_CHANGELOG, REDACTION_RULESET_VERSION
from services.decision_audit import DecisionAuditRecord, DecisionAuditStore
from services.pii_scrubber import PIIScrubberService

TEXT = "Mary Johnson received aid in Maiduguri Camp on 15 Jan 2025."


@pytest.fixture
def store(tmp_path) -> DecisionAuditStore:
    return DecisionAuditStore(path=str(tmp_path / "audit.jsonl"), retention_days=90.0)


@pytest.fixture
def client():
    return TestClient(app)


class TestVersionPresentOnRedactedOutput:
    def setup_method(self):
        self.service = PIIScrubberService()

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_anonymize_output_carries_version(self, mock_labels):
        mock_labels.return_value.observe = MagicMock()
        result = self.service.anonymize(TEXT)
        assert result["ruleset_version"] == REDACTION_RULESET_VERSION

    @patch("metrics.PIPELINE_STEP_LATENCY.labels")
    def test_anonymize_empty_text_carries_version(self, mock_labels):
        mock_labels.return_value.observe = MagicMock()
        assert self.service.anonymize("")["ruleset_version"] == (
            REDACTION_RULESET_VERSION
        )

    def test_structured_preview_carries_version(self):
        populated = self.service.preview_structured_fields(
            {"full_name": {"value": "Jane Doe"}}
        )
        empty = self.service.preview_structured_fields({})
        assert populated["ruleset_version"] == REDACTION_RULESET_VERSION
        assert empty["ruleset_version"] == REDACTION_RULESET_VERSION

    def test_v1_anonymize_endpoint_returns_version(self, client):
        response = client.post("/v1/ai/anonymize", json={"text": TEXT})
        assert response.status_code == 200
        assert response.json()["result"]["ruleset_version"] == (
            REDACTION_RULESET_VERSION
        )

    def test_preview_endpoint_returns_version_for_text(self, client):
        response = client.post("/v1/ai/redaction/preview", json={"text": TEXT})
        assert response.status_code == 200
        assert response.json()["result"]["ruleset_version"] == (
            REDACTION_RULESET_VERSION
        )

    def test_preview_endpoint_returns_version_for_structured_fields(self, client):
        response = client.post(
            "/v1/ai/redaction/preview",
            json={"fields": {"full_name": {"value": "Jane Doe"}}},
        )
        assert response.status_code == 200
        assert response.json()["result"]["ruleset_version"] == (
            REDACTION_RULESET_VERSION
        )


class TestVersionPersistedWithDecisionAuditRecords:
    def test_record_is_stamped_with_active_version(self, store):
        record = store.record(
            "humanitarian_verification", "eligible", claim_id="claim-1"
        )
        assert record.redaction_ruleset_version == REDACTION_RULESET_VERSION

    def test_version_is_written_to_disk(self, store):
        store.record("fraud_detection", "cleared", claim_id="claim-2")
        with open(store.path, encoding="utf-8") as fh:
            persisted = [json.loads(line) for line in fh if line.strip()]
        assert persisted[0]["redaction_ruleset_version"] == REDACTION_RULESET_VERSION

    def test_stamp_reflects_rules_active_when_persisted(self, store):
        with patch("services.decision_audit.REDACTION_RULESET_VERSION", "9.9.9"):
            record = store.record("fraud_detection", "flagged", claim_id="claim-3")
        assert record.redaction_ruleset_version == "9.9.9"

    def test_caller_cannot_spoof_the_version(self):
        record = DecisionAuditRecord(
            decision_type="fraud_detection",
            outcome="cleared",
            redaction_ruleset_version="0.0.0-spoofed",
        ).redacted()
        assert record.redaction_ruleset_version == REDACTION_RULESET_VERSION

    def test_legacy_records_without_version_still_load(self):
        legacy = {"decision_type": "fraud_detection", "outcome": "cleared"}
        record = DecisionAuditRecord.from_dict(legacy)
        assert record.redaction_ruleset_version is None


class TestChangelog:
    def test_version_is_semver(self):
        assert re.fullmatch(r"\d+\.\d+\.\d+", REDACTION_RULESET_VERSION)

    def test_changelog_head_matches_current_version(self):
        assert REDACTION_RULESET_CHANGELOG[0]["version"] == REDACTION_RULESET_VERSION

    def test_changelog_versions_are_unique_and_described(self):
        versions = [entry["version"] for entry in REDACTION_RULESET_CHANGELOG]
        assert len(versions) == len(set(versions))
        for entry in REDACTION_RULESET_CHANGELOG:
            assert entry["summary"]
            assert entry["changes"]
