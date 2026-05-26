"""Tests for verification metadata schemas and validation."""

import pytest
import time
import uuid
from schemas.metadata import VerificationMetadata


class TestVerificationMetadata:
    """Test VerificationMetadata schema validation."""

    def test_valid_metadata_creation(self):
        """Test creating valid metadata with all fields."""
        metadata = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            package_id="pkg_def456",
            verification_timestamp=int(time.time()),
        )
        assert metadata.campaign_id == "camp_abc123"
        assert metadata.claim_id == "claim_xyz789"
        assert metadata.package_id == "pkg_def456"
        assert metadata.verification_id is not None
        assert isinstance(metadata.verification_id, str)

    def test_metadata_without_package_id(self):
        """Test creating metadata with required fields only."""
        metadata = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            verification_timestamp=int(time.time()),
        )
        assert metadata.campaign_id == "camp_abc123"
        assert metadata.claim_id == "claim_xyz789"
        assert metadata.package_id is None

    def test_metadata_campaign_id_validation_empty_string(self):
        """Test campaign_id validation rejects empty string."""
        with pytest.raises(ValueError, match="campaign_id cannot be empty"):
            VerificationMetadata(
                campaign_id="",
                claim_id="claim_xyz789",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_campaign_id_validation_whitespace(self):
        """Test campaign_id validation rejects whitespace-only string."""
        with pytest.raises(ValueError, match="campaign_id cannot be empty"):
            VerificationMetadata(
                campaign_id="   ",
                claim_id="claim_xyz789",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_claim_id_validation_empty_string(self):
        """Test claim_id validation rejects empty string."""
        with pytest.raises(ValueError, match="claim_id cannot be empty"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_claim_id_validation_whitespace(self):
        """Test claim_id validation rejects whitespace-only string."""
        with pytest.raises(ValueError, match="claim_id cannot be empty"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="   ",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_package_id_validation_empty_string(self):
        """Test package_id validation rejects empty string (must be None or non-empty)."""
        with pytest.raises(ValueError, match="package_id cannot be empty or whitespace"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="claim_xyz789",
                package_id="",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_package_id_validation_whitespace(self):
        """Test package_id validation rejects whitespace-only string."""
        with pytest.raises(ValueError, match="package_id cannot be empty or whitespace"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="claim_xyz789",
                package_id="   ",
                verification_timestamp=int(time.time()),
            )

    def test_metadata_timestamp_validation_zero(self):
        """Test verification_timestamp validation rejects zero."""
        with pytest.raises(ValueError, match="verification_timestamp must be positive"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="claim_xyz789",
                verification_timestamp=0,
            )

    def test_metadata_timestamp_validation_negative(self):
        """Test verification_timestamp validation rejects negative values."""
        with pytest.raises(ValueError, match="verification_timestamp must be positive"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="claim_xyz789",
                verification_timestamp=-100,
            )

    def test_metadata_timestamp_validation_future_bounds(self):
        """Test verification_timestamp validation rejects unreasonably far future."""
        with pytest.raises(ValueError, match="verification_timestamp appears to be unreasonably"):
            VerificationMetadata(
                campaign_id="camp_abc123",
                claim_id="claim_xyz789",
                verification_timestamp=5000000000,  # Year 2128
            )

    def test_metadata_verification_id_auto_generated(self):
        """Test verification_id is auto-generated if not provided."""
        metadata1 = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            verification_timestamp=int(time.time()),
        )
        metadata2 = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            verification_timestamp=int(time.time()),
        )
        assert metadata1.verification_id != metadata2.verification_id
        # Verify it's a valid UUID
        uuid.UUID(metadata1.verification_id)

    def test_metadata_whitespace_trimming(self):
        """Test that whitespace is trimmed from identifiers."""
        metadata = VerificationMetadata(
            campaign_id="  camp_abc123  ",
            claim_id="  claim_xyz789  ",
            package_id="  pkg_def456  ",
            verification_timestamp=int(time.time()),
        )
        assert metadata.campaign_id == "camp_abc123"
        assert metadata.claim_id == "claim_xyz789"
        assert metadata.package_id == "pkg_def456"

    def test_metadata_serialization(self):
        """Test metadata serialization to dict."""
        metadata = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            package_id="pkg_def456",
            verification_timestamp=1672531200,
        )
        data = metadata.dict()
        assert data["campaign_id"] == "camp_abc123"
        assert data["claim_id"] == "claim_xyz789"
        assert data["package_id"] == "pkg_def456"
        assert data["verification_timestamp"] == 1672531200
        assert "verification_id" in data

    def test_metadata_json_serialization(self):
        """Test metadata serialization to JSON."""
        metadata = VerificationMetadata(
            campaign_id="camp_abc123",
            claim_id="claim_xyz789",
            verification_timestamp=int(time.time()),
        )
        json_str = metadata.json()
        assert "camp_abc123" in json_str
        assert "claim_xyz789" in json_str
