"""Tests for humanitarian verification with metadata propagation."""

import pytest
import time
import json
from unittest.mock import patch, MagicMock

from schemas.humanitarian import (
    HumanitarianVerificationRequest,
    HumanitarianVerificationResponse,
)
from services.humanitarian_verification import HumanitarianVerificationService


class TestHumanitarianVerificationWithMetadata:
    """Test humanitarian verification with on-chain metadata."""

    @pytest.fixture
    def verification_service(self):
        """Create a humanitarian verification service instance."""
        return HumanitarianVerificationService()

    def test_humanitarian_request_includes_metadata_fields(self):
        """Test HumanitarianVerificationRequest schema includes metadata fields."""
        request = HumanitarianVerificationRequest(
            aid_claim="I need food assistance due to recent flood",
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            package_id="pkg_def456",
        )
        assert request.campaign_id == "camp_abc123"
        assert request.claim_id == "claim_xyz789"
        assert request.package_id == "pkg_def456"

    def test_humanitarian_request_metadata_is_optional_except_campaign_and_claim(self):
        """Test campaign_id and claim_id validation in request."""
        # This should work
        request = HumanitarianVerificationRequest(
            aid_claim="I need food assistance",
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
        )
        assert request.package_id is None

    def test_humanitarian_request_campaign_id_required_when_providing_metadata(self):
        """Test campaign_id validation in request."""
        with pytest.raises(ValueError, match="campaign_id cannot be empty"):
            HumanitarianVerificationRequest(
                aid_claim="I need food assistance",
                campaign_id="",
                claim_id="claim_xyz789",
            )

    def test_humanitarian_request_claim_id_required_when_providing_metadata(self):
        """Test claim_id validation in request."""
        with pytest.raises(ValueError, match="claim_id cannot be empty"):
            HumanitarianVerificationRequest(
                aid_claim="I need food assistance",
                campaign_id="camp_abc123",
                claim_id="",
            )

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_propagates_metadata(self, mock_call_provider, verification_service):
        """Test that metadata is propagated through verification result."""
        mock_call_provider.return_value = json.dumps({
            "verdict": "credible",
            "confidence": 0.9,
            "summary": "Aid claim is credible",
        })

        result = verification_service.verify_claim(
            aid_claim="I need food assistance",
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            package_id="pkg_def456",
        )

        assert "metadata" in result
        assert result["metadata"]["campaign_id"] == "camp_abc123"
        assert result["metadata"]["claim_id"] == "claim_xyz789"
        assert result["metadata"]["package_id"] == "pkg_def456"
        assert "verification_timestamp" in result["metadata"]
        assert "verification_id" in result["metadata"]

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_without_metadata(self, mock_call_provider, verification_service):
        """Test verification works without metadata."""
        mock_call_provider.return_value = json.dumps({
            "verdict": "credible",
            "confidence": 0.9,
        })

        result = verification_service.verify_claim(
            aid_claim="I need food assistance",
        )

        assert "metadata" not in result or result.get("metadata") is None

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_rejects_metadata_without_campaign_id(self, mock_call_provider, verification_service):
        """Test verification rejects metadata without campaign_id."""
        with pytest.raises(ValueError, match="campaign_id is required"):
            verification_service.verify_claim(
                aid_claim="I need food assistance",
                claim_id="claim_xyz789",
            )

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_rejects_metadata_without_claim_id(self, mock_call_provider, verification_service):
        """Test verification rejects metadata without claim_id."""
        with pytest.raises(ValueError, match="claim_id is required"):
            verification_service.verify_claim(
                aid_claim="I need food assistance",
                campaign_id="camp_abc123",
            )

    def test_humanitarian_response_includes_metadata(self):
        """Test HumanitarianVerificationResponse schema includes metadata."""
        response = HumanitarianVerificationResponse(
            success=True,
            provider="openai",
            model="gpt-4",
            prompt_variant="primary",
            verification={
                "verdict": "credible",
                "confidence": 0.9,
            },
            metadata={
                "campaign_id": "camp_abc123",
                "claim_id": "claim_xyz789",
                "package_id": "pkg_def456",
                "verification_timestamp": int(time.time()),
                "verification_id": "uuid-1234-5678",
            }
        )
        assert response.metadata["campaign_id"] == "camp_abc123"
        assert response.metadata["claim_id"] == "claim_xyz789"

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_metadata_has_stable_identifiers(self, mock_call_provider, verification_service):
        """Test metadata contains all required stable identifiers."""
        mock_call_provider.return_value = json.dumps({
            "verdict": "credible",
            "confidence": 0.85,
        })

        result = verification_service.verify_claim(
            aid_claim="I need shelter assistance",
            campaign_id="emergency_2024_q1",
            claim_id="claim_001_recipient_abc",
            package_id="pkg_shelter_emergency",
        )

        metadata = result["metadata"]
        assert metadata["campaign_id"] == "emergency_2024_q1"
        assert metadata["claim_id"] == "claim_001_recipient_abc"
        assert metadata["package_id"] == "pkg_shelter_emergency"
        assert isinstance(metadata["verification_timestamp"], int)
        assert metadata["verification_timestamp"] > 0

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_metadata_timestamp_reasonable(self, mock_call_provider, verification_service):
        """Test metadata timestamp is reasonable (within last minute)."""
        before_time = int(time.time())
        mock_call_provider.return_value = json.dumps({"verdict": "credible"})

        result = verification_service.verify_claim(
            aid_claim="I need water access",
            campaign_id="water_2024",
            claim_id="water_claim_001",
        )

        after_time = int(time.time())
        timestamp = result["metadata"]["verification_timestamp"]
        assert before_time <= timestamp <= after_time

    @patch("services.humanitarian_verification.HumanitarianVerificationService._call_provider")
    def test_verify_claim_metadata_verification_id_unique(self, mock_call_provider, verification_service):
        """Test metadata verification_id is unique for each call."""
        mock_call_provider.return_value = json.dumps({"verdict": "credible"})

        result1 = verification_service.verify_claim(
            aid_claim="Claim 1",
            campaign_id="camp_001",
            claim_id="claim_001",
        )

        result2 = verification_service.verify_claim(
            aid_claim="Claim 2",
            campaign_id="camp_001",
            claim_id="claim_002",
        )

        id1 = result1["metadata"]["verification_id"]
        id2 = result2["metadata"]["verification_id"]
        assert id1 != id2

    def test_humanitarian_request_serialization_with_metadata(self):
        """Test request serialization includes all metadata."""
        request = HumanitarianVerificationRequest(
            aid_claim="I need assistance",
            campaign_id="camp_test",
            claim_id="claim_test",
            package_id="pkg_test",
        )
        data = request.dict()
        assert data["campaign_id"] == "camp_test"
        assert data["claim_id"] == "claim_test"
        assert data["package_id"] == "pkg_test"
