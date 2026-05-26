"""Tests for fraud detection with metadata propagation."""

import pytest
import time
from schemas.fraud import (
    ClaimMetadata,
    ClaimFraudResult,
    FraudDetectionRequest,
    FraudDetectionResponse,
)
from services.fraud_detection import detect_fraud


class TestFraudDetectionWithMetadata:
    """Test fraud detection with on-chain metadata."""

    def test_claim_metadata_includes_identifiers(self):
        """Test ClaimMetadata schema includes on-chain identifiers."""
        claim = ClaimMetadata(
            claim_id="claim_123",
            ip_address="192.168.1.1",
            amount=100.0,
            campaign_id="camp_abc123",
            package_id="pkg_def456",
        )
        assert claim.claim_id == "claim_123"
        assert claim.campaign_id == "camp_abc123"
        assert claim.package_id == "pkg_def456"

    def test_claim_metadata_identifiers_optional(self):
        """Test campaign_id and package_id are optional in ClaimMetadata."""
        claim = ClaimMetadata(
            claim_id="claim_123",
            ip_address="192.168.1.1",
        )
        assert claim.campaign_id is None
        assert claim.package_id is None

    def test_claim_metadata_claim_id_validation_empty(self):
        """Test claim_id validation rejects empty string."""
        with pytest.raises(ValueError, match="claim_id cannot be empty"):
            ClaimMetadata(
                claim_id="",
                ip_address="192.168.1.1",
            )

    def test_claim_metadata_claim_id_validation_whitespace(self):
        """Test claim_id validation rejects whitespace-only."""
        with pytest.raises(ValueError, match="claim_id cannot be empty"):
            ClaimMetadata(
                claim_id="   ",
                ip_address="192.168.1.1",
            )

    def test_claim_fraud_result_includes_identifiers(self):
        """Test ClaimFraudResult includes on-chain identifiers."""
        result = ClaimFraudResult(
            claim_id="claim_123",
            fraud_risk_score=0.45,
            is_flagged=False,
            campaign_id="camp_abc123",
            package_id="pkg_def456",
        )
        assert result.claim_id == "claim_123"
        assert result.campaign_id == "camp_abc123"
        assert result.package_id == "pkg_def456"

    def test_fraud_detection_propagates_metadata(self):
        """Test fraud detection propagates metadata from input to output."""
        claims = [
            ClaimMetadata(
                claim_id="claim_001",
                amount=100.0,
                ip_address="1.1.1.1",
                campaign_id="camp_123",
                package_id="pkg_001",
            ),
            ClaimMetadata(
                claim_id="claim_002",
                amount=105.0,
                ip_address="1.1.1.2",
                campaign_id="camp_123",
                package_id="pkg_001",
            ),
            ClaimMetadata(
                claim_id="claim_003",
                amount=110.0,
                ip_address="1.1.1.3",
                campaign_id="camp_123",
                package_id="pkg_001",
            ),
        ]

        results = detect_fraud(claims)

        assert len(results) == 3
        # Verify metadata is propagated
        for result, original_claim in zip(results, claims):
            assert result.claim_id == original_claim.claim_id
            assert result.campaign_id == original_claim.campaign_id
            assert result.package_id == original_claim.package_id

    def test_fraud_detection_handles_mixed_metadata(self):
        """Test fraud detection handles claims with and without metadata."""
        claims = [
            ClaimMetadata(
                claim_id="claim_001",
                amount=100.0,
                campaign_id="camp_123",
            ),
            ClaimMetadata(
                claim_id="claim_002",
                amount=105.0,
                campaign_id=None,  # No campaign_id
            ),
            ClaimMetadata(
                claim_id="claim_003",
                amount=110.0,
                package_id="pkg_002",
            ),
        ]

        results = detect_fraud(claims)

        assert results[0].campaign_id == "camp_123"
        assert results[1].campaign_id is None
        assert results[2].package_id == "pkg_002"

    def test_fraud_detection_request_includes_campaign_id(self):
        """Test FraudDetectionRequest includes campaign_id."""
        request = FraudDetectionRequest(
            claims=[
                ClaimMetadata(claim_id="c1", ip_address="1.1.1.1"),
            ],
            campaign_id="camp_batch_001",
        )
        assert request.campaign_id == "camp_batch_001"

    def test_fraud_detection_request_campaign_id_validation(self):
        """Test FraudDetectionRequest campaign_id validation."""
        with pytest.raises(ValueError, match="campaign_id cannot be empty"):
            FraudDetectionRequest(
                claims=[
                    ClaimMetadata(claim_id="c1", ip_address="1.1.1.1"),
                ],
                campaign_id="   ",  # Whitespace only
            )

    def test_fraud_detection_response_includes_verification_metadata(self):
        """Test FraudDetectionResponse includes verification_metadata."""
        response = FraudDetectionResponse(
            results=[
                ClaimFraudResult(
                    claim_id="claim_001",
                    fraud_risk_score=0.2,
                    is_flagged=False,
                ),
            ],
            flagged_count=0,
            verification_metadata={
                "campaign_id": "camp_batch_001",
                "claim_id": "fraud_batch_1234567890",
                "verification_timestamp": int(time.time()),
                "verification_id": "uuid-verification-001",
            }
        )
        assert response.verification_metadata["campaign_id"] == "camp_batch_001"
        assert response.flagged_count == 0

    def test_fraud_detection_single_claim_preserves_metadata(self):
        """Test single claim detection preserves metadata."""
        claims = [
            ClaimMetadata(
                claim_id="solo_claim",
                amount=500.0,
                campaign_id="camp_solo",
                package_id="pkg_solo",
            ),
        ]

        results = detect_fraud(claims)

        assert len(results) == 1
        assert results[0].claim_id == "solo_claim"
        assert results[0].campaign_id == "camp_solo"
        assert results[0].package_id == "pkg_solo"
        assert results[0].fraud_risk_score == 0.0
        assert results[0].is_flagged is False

    def test_fraud_detection_with_multiple_claims_different_campaigns(self):
        """Test fraud detection with claims from different campaigns."""
        claims = [
            ClaimMetadata(
                claim_id="claim_camp_a_001",
                amount=100.0,
                campaign_id="camp_a",
            ),
            ClaimMetadata(
                claim_id="claim_camp_a_002",
                amount=105.0,
                campaign_id="camp_a",
            ),
            ClaimMetadata(
                claim_id="claim_camp_b_001",
                amount=200.0,
                campaign_id="camp_b",
            ),
        ]

        results = detect_fraud(claims)

        # Verify each result has correct campaign_id
        results_by_id = {r.claim_id: r for r in results}
        assert results_by_id["claim_camp_a_001"].campaign_id == "camp_a"
        assert results_by_id["claim_camp_a_002"].campaign_id == "camp_a"
        assert results_by_id["claim_camp_b_001"].campaign_id == "camp_b"

    def test_fraud_detection_response_serialization(self):
        """Test FraudDetectionResponse serialization with metadata."""
        response = FraudDetectionResponse(
            results=[
                ClaimFraudResult(
                    claim_id="claim_001",
                    fraud_risk_score=0.3,
                    is_flagged=False,
                    campaign_id="camp_001",
                ),
            ],
            flagged_count=0,
            verification_metadata={
                "campaign_id": "camp_001",
                "claim_id": "batch_fraud_check",
                "verification_timestamp": 1672531200,
                "verification_id": "uuid-001",
            }
        )
        
        data = response.dict()
        assert data["flagged_count"] == 0
        assert len(data["results"]) == 1
        assert data["results"][0]["campaign_id"] == "camp_001"
        assert data["verification_metadata"]["campaign_id"] == "camp_001"

    def test_fraud_detection_end_to_end_with_metadata(self):
        """Test end-to-end fraud detection flow with metadata preservation."""
        # Create diverse claims with metadata
        claims = [
            ClaimMetadata(
                claim_id=f"claim_{i:03d}",
                amount=float(100 + i * 5),
                ip_address=f"192.168.1.{i+1}",
                campaign_id="emergency_relief_2024",
                package_id="food_aid_batch_001",
            )
            for i in range(5)
        ]

        results = detect_fraud(claims)

        # Verify shape and metadata propagation
        assert len(results) == 5
        for i, result in enumerate(results):
            assert result.claim_id == f"claim_{i:03d}"
            assert result.campaign_id == "emergency_relief_2024"
            assert result.package_id == "food_aid_batch_001"
            assert 0.0 <= result.fraud_risk_score <= 1.0
            assert isinstance(result.is_flagged, bool)
