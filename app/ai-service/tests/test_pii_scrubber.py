from services.pii_scrubber import PIIScrubberService


class TestPIIScrubberService:
    def setup_method(self):
        self.service = PIIScrubberService()

    def test_anonymize_detects_and_masks_name_location_date(self):
        text = "On 15 Jan 2025, Mary Johnson received aid in Maiduguri Camp."
        result = self.service.anonymize(text)

        assert "[EVENT_DATE]" in result["anonymized_text"]
        assert "[RECIPIENT_NAME]" in result["anonymized_text"]
        assert "[LOCATION]" in result["anonymized_text"]
        assert result["pii_summary"]["total"] >= 3

    def test_anonymize_preserves_context_words(self):
        text = "John Doe reported food assistance delays in Kano State on 2024-07-12."
        result = self.service.anonymize(text)

        anonymized = result["anonymized_text"]
        assert "reported food assistance delays" in anonymized
        assert "[RECIPIENT_NAME]" in anonymized

    def test_anonymize_empty_like_content(self):
        result = self.service.anonymize("")
        assert result["anonymized_text"] == ""
        assert result["pii_summary"]["total"] == 0
