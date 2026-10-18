import pytest
from pydantic import ValidationError
from schemas.common import AnchorMetadata


def test_valid_anchor_metadata():
    metadata = AnchorMetadata(
        campaign_ref="campaign-2024-001",
        claim_id="claim-abc123",
        package_id="package-x7y8z9",
    )
    assert metadata.campaign_ref == "campaign-2024-001"
    assert metadata.claim_id == "claim-abc123"
    assert metadata.package_id == "package-x7y8z9"


def test_omitted_values():
    metadata = AnchorMetadata()
    assert metadata.campaign_ref is None
    assert metadata.claim_id is None
    assert metadata.package_id is None


def test_empty_string_invalid():
    with pytest.raises(ValidationError):
        AnchorMetadata(campaign_ref="")
    with pytest.raises(ValidationError):
        AnchorMetadata(claim_id="")
    with pytest.raises(ValidationError):
        AnchorMetadata(package_id="")


def test_invalid_characters():
    with pytest.raises(ValidationError):
        AnchorMetadata(campaign_ref="campaign!@#")
    with pytest.raises(ValidationError):
        AnchorMetadata(claim_id="claim space")
    with pytest.raises(ValidationError):
        AnchorMetadata(package_id="package$")


def test_too_long():
    long_value = "a" * 65
    with pytest.raises(ValidationError):
        AnchorMetadata(campaign_ref=long_value)
    with pytest.raises(ValidationError):
        AnchorMetadata(claim_id=long_value)
    with pytest.raises(ValidationError):
        AnchorMetadata(package_id=long_value)


def test_valid_long_value():
    long_value = "a" * 64
    metadata = AnchorMetadata(
        campaign_ref=long_value, claim_id=long_value, package_id=long_value
    )
    assert metadata.campaign_ref == long_value
    assert metadata.claim_id == long_value
    assert metadata.package_id == long_value
