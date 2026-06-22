import re

def scrub_pii(text):

    # Redact emails
    text = re.sub(
        r'[\w\.-]+@[\w\.-]+',
        '[REDACTED_EMAIL]',
        text
    )

    # Redact phone numbers
    text = re.sub(
        r'\+?\d[\d\s\-]{7,}\d',
        '[REDACTED_PHONE]',
        text
    )

    # Redact IDs
    text = re.sub(
        r'\b\d{4,}\b',
        '[REDACTED_ID]',
        text
    )

    return text
