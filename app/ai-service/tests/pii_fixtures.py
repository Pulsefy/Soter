"""Fixtures for PII scrubbing regression tests."""

PII_FIXTURES = [
    {
        "name": "email_standard",
        "text": "Please contact us at support@pulsefy.org or john.doe123@gmail.com",
        "expected_tokens": ["[EMAIL_ADDRESS]"],
        "min_count": 2
    },
    {
        "name": "phone_nigeria",
        "text": "Call me at +234 803 123 4567 or 08029876543.",
        "expected_tokens": ["[PHONE_NUMBER]"],
        "min_count": 2
    },
    {
        "name": "id_nin",
        "text": "My NIN is 12345678901 and my Voter ID is AB12345678.",
        "expected_tokens": ["[ID_NUMBER]"],
        "min_count": 2
    },
    {
        "name": "address_complex",
        "text": "Deliver to 1234 Ahmadu Bello Way, Victoria Island, Lagos, Nigeria.",
        "expected_tokens": ["[LOCATION]"],
        "min_count": 1
    },
    {
        "name": "names_multi",
        "text": "Dr. Sarah Ahmed met with Mr. Olusegun Obasanjo and Alice Green.",
        "expected_tokens": ["[RECIPIENT_NAME]"],
        "min_count": 3
    },
    {
        "name": "dates_mixed",
        "text": "Scheduled for 12/05/2024, postponed to June 15, 2024.",
        "expected_tokens": ["[EVENT_DATE]"],
        "min_count": 2
    }
]

SAFE_TEXT_FIXTURES = [
    {
        "name": "product_names",
        "text": "The Soter mobile app is built on the Stellar network.",
        "should_not_contain": ["[RECIPIENT_NAME]", "[LOCATION]"]
    },
    {
        "name": "job_titles",
        "text": "The Project Manager sent the Humanitarian Coordinator a report.",
        "should_not_contain": ["[RECIPIENT_NAME]"]
    },
    {
        "name": "technical_terms",
        "text": "The hash was 0x123456789abcdef and the block height is 55021.",
        "should_not_contain": ["[ID_NUMBER]"]
    }
]

FALSE_POSITIVE_GUARDS = [
    {
        "name": "not_a_name",
        "text": "Crystal Clear Water is a good brand.",
        "should_not_redact": "Crystal Clear Water"
    },
    {
        "name": "not_an_address",
        "text": "In the beginning, God created the heavens.",
        "should_not_redact": "In the beginning"
    }
]
