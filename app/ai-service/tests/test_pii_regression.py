import pytest
from services.pii_scrubber import PIIScrubberService
from tests.pii_fixtures import PII_FIXTURES, SAFE_TEXT_FIXTURES, FALSE_POSITIVE_GUARDS

class TestPIIRegression:
    @pytest.fixture(autouse=True)
    def setup_service(self):
        self.service = PIIScrubberService()

    @pytest.mark.parametrize("fixture", PII_FIXTURES)
    def test_pii_detection_coverage(self, fixture):
        """Test that various types of PII are detected and replaced with correct tokens."""
        result = self.service.anonymize(fixture["text"])
        anonymized = result["anonymized_text"]
        
        for token in fixture["expected_tokens"]:
            assert token in anonymized, f"Token {token} missing in anonymized text for {fixture['name']}"
        
        # Check total count if specified
        if "min_count" in fixture:
            total_redacted = sum(result["token_counts"].values())
            assert total_redacted >= fixture["min_count"], \
                f"Expected at least {fixture['min_count']} redactions for {fixture['name']}, got {total_redacted}"

    @pytest.mark.parametrize("fixture", SAFE_TEXT_FIXTURES)
    def test_safe_text_is_not_redacted(self, fixture):
        """Test that non-PII text is preserved and not over-redacted."""
        result = self.service.anonymize(fixture["text"])
        anonymized = result["anonymized_text"]
        
        for token in fixture["should_not_contain"]:
            assert token not in anonymized, f"False positive: {token} found in {fixture['name']}"
        
        assert anonymized == fixture["text"], f"Safe text was modified in {fixture['name']}"

    @pytest.mark.parametrize("guard", FALSE_POSITIVE_GUARDS)
    def test_false_positive_guards(self, guard):
        """Specifically guard against known false positives."""
        result = self.service.anonymize(guard["text"])
        anonymized = result["anonymized_text"]
        
        assert guard["should_not_redact"] in anonymized, \
            f"False positive redaction of '{guard['should_not_redact']}' in {guard['name']}"
