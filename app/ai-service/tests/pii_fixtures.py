"""Fixtures for PII scrubbing regression tests."""

# TRUE POSITIVES: Real PII that should be scrubbed
PII_FIXTURES = [
    {
        "name": "email_standard",
        "text": "Please contact us at support@pulsefy.org or john.doe123@gmail.com",
        "expected_tokens": ["[EMAIL_ADDRESS]"],
        "min_count": 2,
    },
    {
        "name": "phone_nigeria",
        "text": "Call me at +234 803 123 4567 or 08029876543.",
        "expected_tokens": ["[PHONE_NUMBER]"],
        "min_count": 2,
    },
    {
        "name": "id_nin",
        "text": "My NIN is 12345678901 and my Voter ID is AB12345678.",
        "expected_tokens": ["[ID_NUMBER]"],
        "min_count": 2,
    },
    {
        "name": "address_complex",
        "text": "Deliver to 1234 Ahmadu Bello Way, Victoria Island, Lagos, Nigeria.",
        "expected_tokens": ["[LOCATION]"],
        "min_count": 1,
    },
    {
        "name": "names_multi",
        "text": "Dr. Sarah Ahmed met with Mr. Olusegun Obasanjo and Alice Green.",
        "expected_tokens": ["[RECIPIENT_NAME]"],
        "min_count": 3,
    },
    {
        "name": "dates_mixed",
        "text": "Scheduled for 12/05/2024, postponed to June 15, 2024.",
        "expected_tokens": ["[EVENT_DATE]"],
        "min_count": 2,
    },
]

# TRUE NEGATIVES: Safe text that should NOT be scrubbed
SAFE_TEXT_FIXTURES = [
    {
        "name": "product_names",
        "text": "The Soter mobile app is built on the Stellar network.",
        "should_not_contain": ["[RECIPIENT_NAME]", "[LOCATION]"],
    },
    {
        "name": "job_titles",
        "text": "The Project Manager sent the Humanitarian Coordinator a report.",
        "should_not_contain": ["[RECIPIENT_NAME]"],
    },
    {
        "name": "technical_terms",
        "text": "The hash was 0x123456789abcdef and the block height is 55021.",
        "should_not_contain": ["[ID_NUMBER]"],
    },
]

# FALSE POSITIVES: Should NOT be scrubbed but look like PII
# These are common patterns in legitimate non-PII content
FALSE_POSITIVE_GUARDS = [
    {
        "name": "not_a_name",
        "text": "Crystal Clear Water is a good brand.",
        "should_not_redact": "Crystal Clear Water",
    },
    {
        "name": "not_an_address",
        "text": "In the beginning, God created the heavens.",
        "should_not_redact": "In the beginning",
    },
    {
        "name": "semantic_version",
        "text": "Version ^1.23.456 is now available in our package manager.",
        "should_not_redact": "1.23.456",
    },
    {
        "name": "port_number",
        "text": "Connect to the development server at localhost:3000 for debugging.",
        "should_not_redact": "3000",
    },
    {
        "name": "hex_color",
        "text": "The design system uses hex color #FF5733 for alerts.",
        "should_not_redact": "#FF5733",
    },
    {
        "name": "product_sku",
        "text": "Order SKU-123-45-6789 for inventory management.",
        "should_not_redact": "SKU-123-45-6789",
    },
    {
        "name": "error_code",
        "text": "HTTP error code 404-123-4567 was returned from the API.",
        "should_not_redact": "404-123-4567",
    },
    {
        "name": "file_path",
        "text": "Save the file to /home/user/documents/file.123.45.6789.txt",
        "should_not_redact": ".123.45.6789",
    },
    {
        "name": "region_code",
        "text": "The region code TX-123-456 identifies the service area.",
        "should_not_redact": "TX-123-456",
    },
    {
        "name": "mathematical_pi",
        "text": "Pi equals 3.14159 in mathematical notation.",
        "should_not_redact": "3.14159",
    },
]

# FALSE NEGATIVES: Should BE scrubbed but might be missed by current patterns
# These are real PII that the scrubber might not catch
FALSE_NEGATIVE_FIXTURES = [
    {
        "name": "email_unusual_tld",
        "text": "Contact me at researcher@example.museum for details.",
        "should_contain": "[EMAIL_ADDRESS]",
        "original_text": "researcher@example.museum",
    },
    {
        "name": "email_plus_addressing",
        "text": "My work email is alice.smith+notifications@company.co.uk",
        "should_contain": "[EMAIL_ADDRESS]",
        "original_text": "alice.smith+notifications@company.co.uk",
    },
    {
        "name": "email_in_brackets",
        "text": "Please reply to <sarah.johnson@example.org> with confirmation.",
        "should_contain": "[EMAIL_ADDRESS]",
        "original_text": "sarah.johnson@example.org",
    },
    {
        "name": "phone_international_uk",
        "text": "Call the UK office at +44 20 7946 0958 during business hours.",
        "should_contain": "[PHONE_NUMBER]",
        "original_text": "+44 20 7946 0958",
    },
    {
        "name": "phone_with_dots",
        "text": "My number is 234.567.8901 for the callback.",
        "should_contain": "[PHONE_NUMBER]",
        "original_text": "234.567.8901",
    },
    {
        "name": "phone_country_prefix",
        "text": "International dialing: +234 801 234 5678 reaches Lagos.",
        "should_contain": "[PHONE_NUMBER]",
        "original_text": "+234 801 234 5678",
    },
    {
        "name": "ssn_with_spaces",
        "text": "Social security number: 123 45 6789 (format with spaces).",
        "should_contain": "[ID_NUMBER]",
        "original_text": "123 45 6789",
    },
    {
        "name": "nin_with_spaces",
        "text": "National ID with spaces: 12345 67890 1 in the system.",
        "should_contain": "[ID_NUMBER]",
        "original_text": "12345 67890 1",
    },
    {
        "name": "name_with_accents",
        "text": "The beneficiary is José María García from the Andes region.",
        "should_contain": "[RECIPIENT_NAME]",
        "original_text": "José María García",
    },
    {
        "name": "name_single_unicode",
        "text": "Mr. Kwame Asante received aid and Ms. Nia Okonkwo confirmed it.",
        "should_contain": "[RECIPIENT_NAME]",
        "original_text": "Kwame Asante",
    },
    {
        "name": "date_iso_format",
        "text": "The incident occurred on 2024-08-15 at the facility.",
        "should_contain": "[EVENT_DATE]",
        "original_text": "2024-08-15",
    },
    {
        "name": "date_european_format",
        "text": "Report date: 15.08.2024 for the quarter.",
        "should_contain": "[EVENT_DATE]",
        "original_text": "15.08.2024",
    },
]

# COMPREHENSIVE TEST DATASET: All fixtures combined with categorization
ALL_FIXTURES = {
    "true_positives": PII_FIXTURES,
    "true_negatives": SAFE_TEXT_FIXTURES,
    "false_positives": FALSE_POSITIVE_GUARDS,
    "false_negatives": FALSE_NEGATIVE_FIXTURES,
}
