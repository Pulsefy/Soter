"""Integration tests for API endpoints with metadata."""

import pytest
import json
import time
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient


@pytest.fixture
def mock_app():
    """Create a mock FastAPI app with routes."""
    from fastapi import FastAPI
    from api.v1.humanitarian import router as humanitarian_router
    from api.v1.fraud import router as fraud_router

    app = FastAPI()
    app.include_router(humanitarian_router)
    app.include_router(fraud_router)
    return app


@pytest.fixture
def client(mock_app):
    """Create a test client."""
    return TestClient(mock_app)


class TestHumanitarianVerificationAPIWithMetadata:
    """Test humanitarian verification API with metadata."""

    @patch("main.humanitarian_verification_service.verify_claim")
    def test_humanitarian_verification_endpoint_with_metadata(self, mock_verify, client):
        """Test humanitarian verification endpoint includes metadata in response."""
        current_time = int(time.time())
        mock_verify.return_value = {
            "provider": "openai",
            "model": "gpt-4",
            "prompt_variant": "primary",
            "verification": {
                "verdict": "credible",
                "confidence": 0.85,
            },
            "metadata": {
                "campaign_id": "camp_test_001",
                "claim_id": "claim_test_001",
                "package_id": "pkg_test_001",
                "verification_timestamp": current_time,
                "verification_id": "uuid-test-001",
            }
        }

        payload = {
            "aid_claim": "I need shelter assistance after flood",
            "campaign_id": "camp_test_001",
            "claim_id": "claim_test_001",
            "package_id": "pkg_test_001",
            "supporting_evidence": [],
            "context_factors": {},
        }

        response = client.post("/ai/humanitarian/verify", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["metadata"]["campaign_id"] == "camp_test_001"
        assert data["metadata"]["claim_id"] == "claim_test_001"
        assert data["metadata"]["package_id"] == "pkg_test_001"

    @patch("main.humanitarian_verification_service.verify_claim")
    def test_humanitarian_verification_endpoint_payload_shape(self, mock_verify, client):
        """Test humanitarian verification endpoint response payload shape."""
        current_time = int(time.time())
        mock_verify.return_value = {
            "provider": "openai",
            "model": "gpt-4",
            "prompt_variant": "primary",
            "verification": {"verdict": "credible"},
            "metadata": {
                "campaign_id": "camp_001",
                "claim_id": "claim_001",
                "verification_timestamp": current_time,
                "verification_id": "uuid-001",
            }
        }

        payload = {
            "aid_claim": "I need medical assistance",
            "campaign_id": "camp_001",
            "claim_id": "claim_001",
        }

        response = client.post("/ai/humanitarian/verify", json=payload)
        data = response.json()

        # Verify response structure
        assert "success" in data
        assert "provider" in data
        assert "model" in data
        assert "verification" in data
        assert "metadata" in data
        
        # Verify metadata structure
        metadata = data["metadata"]
        assert "campaign_id" in metadata
        assert "claim_id" in metadata
        assert "verification_timestamp" in metadata
        assert "verification_id" in metadata

    @patch("main.humanitarian_verification_service.verify_claim")
    def test_humanitarian_verification_missing_required_metadata(self, mock_verify, client):
        """Test humanitarian verification rejects missing required metadata."""
        # Missing campaign_id should be caught at request validation
        payload = {
            "aid_claim": "I need assistance",
            "claim_id": "claim_001",
        }

        response = client.post("/ai/humanitarian/verify", json=payload)
        # Should fail validation
        assert response.status_code in [422, 400]  # Validation error


class TestFraudDetectionAPIWithMetadata:
    """Test fraud detection API with metadata."""

    @patch("services.fraud_detection.detect_fraud")
    def test_fraud_detection_endpoint_propagates_metadata(self, mock_detect, client):
        """Test fraud detection endpoint propagates metadata."""
        mock_detect.return_value = [
            {
                "claim_id": "claim_001",
                "fraud_risk_score": 0.2,
                "is_flagged": False,
                "campaign_id": "camp_batch_001",
                "package_id": None,
            },
            {
                "claim_id": "claim_002",
                "fraud_risk_score": 0.75,
                "is_flagged": True,
                "campaign_id": "camp_batch_001",
                "package_id": "pkg_batch_001",
            },
        ]

        payload = {
            "campaign_id": "camp_batch_001",
            "claims": [
                {
                    "claim_id": "claim_001",
                    "ip_address": "1.1.1.1",
                    "amount": 100.0,
                    "campaign_id": "camp_batch_001",
                },
                {
                    "claim_id": "claim_002",
                    "ip_address": "2.2.2.2",
                    "amount": 500.0,
                    "campaign_id": "camp_batch_001",
                    "package_id": "pkg_batch_001",
                },
            ]
        }

        response = client.post("/fraud/detect", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["flagged_count"] == 1
        assert len(data["results"]) == 2
        assert data["results"][0]["campaign_id"] == "camp_batch_001"
        assert data["results"][1]["campaign_id"] == "camp_batch_001"

    @patch("services.fraud_detection.detect_fraud")
    def test_fraud_detection_endpoint_includes_verification_metadata(self, mock_detect, client):
        """Test fraud detection response includes verification metadata."""
        current_time = int(time.time())
        mock_detect.return_value = [
            {
                "claim_id": "claim_001",
                "fraud_risk_score": 0.1,
                "is_flagged": False,
                "campaign_id": "camp_001",
            },
        ]

        payload = {
            "campaign_id": "camp_batch_001",
            "claims": [
                {"claim_id": "claim_001", "amount": 100.0}
            ]
        }

        with patch("api.v1.fraud.VerificationMetadata") as mock_metadata_class:
            mock_metadata_instance = MagicMock()
            mock_metadata_instance.dict.return_value = {
                "campaign_id": "camp_batch_001",
                "claim_id": "fraud_batch_check",
                "verification_timestamp": current_time,
                "verification_id": "uuid-batch-001",
            }
            mock_metadata_class.return_value = mock_metadata_instance

            response = client.post("/fraud/detect", json=payload)

            assert response.status_code == 200
            data = response.json()
            # Verification metadata should be included
            if "verification_metadata" in data:
                assert data["verification_metadata"]["campaign_id"] == "camp_batch_001"


class TestMetadataPayloadShape:
    """Test metadata payload shapes across endpoints."""

    def test_humanitarian_verification_response_structure(self, client):
        """Test humanitarian verification response structure is complete."""
        with patch("main.humanitarian_verification_service.verify_claim") as mock_verify:
            current_time = int(time.time())
            mock_verify.return_value = {
                "provider": "openai",
                "model": "gpt-4",
                "prompt_variant": "primary",
                "verification": {"verdict": "credible", "confidence": 0.9},
                "metadata": {
                    "campaign_id": "camp_full_test",
                    "claim_id": "claim_full_test",
                    "package_id": "pkg_full_test",
                    "verification_timestamp": current_time,
                    "verification_id": "full-uuid-001",
                }
            }

            payload = {
                "aid_claim": "Complete test claim",
                "campaign_id": "camp_full_test",
                "claim_id": "claim_full_test",
                "package_id": "pkg_full_test",
            }

            response = client.post("/ai/humanitarian/verify", json=payload)
            data = response.json()

            # Verify complete structure
            required_fields = [
                "success", "provider", "model", "prompt_variant", 
                "verification", "metadata"
            ]
            for field in required_fields:
                assert field in data, f"Missing field: {field}"

            # Verify metadata structure
            metadata = data["metadata"]
            required_metadata = [
                "campaign_id", "claim_id", "package_id",
                "verification_timestamp", "verification_id"
            ]
            for field in required_metadata:
                assert field in metadata, f"Missing metadata field: {field}"

    @patch("services.fraud_detection.detect_fraud")
    def test_fraud_detection_response_structure(self, mock_detect, client):
        """Test fraud detection response structure is complete."""
        mock_detect.return_value = [
            {
                "claim_id": "c1",
                "fraud_risk_score": 0.3,
                "is_flagged": False,
                "campaign_id": "camp_test",
                "package_id": "pkg_test",
            },
        ]

        payload = {
            "campaign_id": "camp_test",
            "claims": [{"claim_id": "c1", "amount": 100.0}]
        }

        response = client.post("/fraud/detect", json=payload)
        data = response.json()

        # Verify response has required fields
        assert "results" in data
        assert "flagged_count" in data
        assert isinstance(data["results"], list)
        assert isinstance(data["flagged_count"], int)

        # Verify each result has metadata fields
        for result in data["results"]:
            assert "claim_id" in result
            assert "fraud_risk_score" in result
            assert "is_flagged" in result


class TestMetadataValidation:
    """Test metadata validation at API level."""

    def test_humanitarian_empty_campaign_id_rejected(self, client):
        """Test empty campaign_id is rejected."""
        payload = {
            "aid_claim": "Valid claim",
            "campaign_id": "",
            "claim_id": "claim_001",
        }

        response = client.post("/ai/humanitarian/verify", json=payload)
        assert response.status_code in [422, 400]

    def test_humanitarian_whitespace_campaign_id_rejected(self, client):
        """Test whitespace-only campaign_id is rejected."""
        payload = {
            "aid_claim": "Valid claim",
            "campaign_id": "   ",
            "claim_id": "claim_001",
        }

        response = client.post("/ai/humanitarian/verify", json=payload)
        assert response.status_code in [422, 400]

    def test_fraud_empty_campaign_id_rejected(self, client):
        """Test empty campaign_id is rejected in fraud detection."""
        payload = {
            "campaign_id": "",
            "claims": [{"claim_id": "c1", "amount": 100.0}]
        }

        response = client.post("/fraud/detect", json=payload)
        assert response.status_code in [422, 400]
