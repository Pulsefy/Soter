import pytest
from pydantic import ValidationError
from schemas.common import AnchorMetadata


def test_valid_anchor_metadata():
    metadata = AnchorMetadata(
        campaign_ref="campaign-123",
        claim_id="claim_456",
        package_id="package-789"
    )
    assert metadata.campaign_ref == "campaign-123"
    assert metadata.claim_id == "claim_456"
    assert metadata.package_id == "package-789"


def test_none_values_are_valid():
    metadata = AnchorMetadata()
    assert metadata.campaign_ref is None
    assert metadata.claim_id is None
    assert metadata.package_id is None


def test_empty_string_is_invalid():
    with pytest.raises(ValidationError):
        AnchorMetadata(campaign_ref="")


def test_invalid_characters():
    with pytest.raises(ValidationError):
        AnchorMetadata(campaign_ref="campaign!123")

    with pytest.raises(ValidationError):
        AnchorMetadata(claim_id="claim@456")


def test_over_length_values():
    long_val = "a" * 65
    with pytest.raises(ValidationError):
        AnchorMetadata(package_id=long_val)


def test_valid_boundary_length():
    valid_val = "a" * 64
    metadata = AnchorMetadata(package_id=valid_val)
    assert metadata.package_id == valid_val
