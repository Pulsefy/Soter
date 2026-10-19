import pytest
from pydantic import ValidationError

from schemas.humanitarian import AID_CLAIM_MAX_LENGTH, HumanitarianVerificationRequest


def test_aid_claim_at_max_length_is_accepted():
    req = HumanitarianVerificationRequest(aid_claim="x" * AID_CLAIM_MAX_LENGTH)
    assert len(req.aid_claim) == AID_CLAIM_MAX_LENGTH


def test_aid_claim_over_max_length_is_rejected_naming_limit():
    with pytest.raises(ValidationError) as exc_info:
        HumanitarianVerificationRequest(aid_claim="x" * (AID_CLAIM_MAX_LENGTH + 1))
    errors = exc_info.value.errors()
    assert errors[0]["type"] == "string_too_long"
    assert str(AID_CLAIM_MAX_LENGTH) in errors[0]["msg"]
