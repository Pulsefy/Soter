import pytest
import re

PATTERNS = {
    "name": [
        r"(?:Full\s+)?[Nn]ame[:\s]+\n?([A-Z][a-z]+(?:[ \t]+(?!(?:Date|DOB|Birth|ID|Passport))[A-Z][a-z]+)+)",
        r"(?:Full\s+)?[Nn]ame[:\s]+\n?([A-Z]+(?:[ \t]+(?!(?:DATE|DOB|BIRTH|ID|PASSPORT))[A-Z]+)+)",
    ],
}

@pytest.mark.parametrize("text,expected", [
    ("Name: John Doe Date of Birth: 15 Jan 1990", "John Doe"),
    ("Full Name: JANE SMITH DOB: 01/01/1980", "JANE SMITH"),
    ("name: Robert Paulson ID: 12345", "Robert Paulson"),
    ("Name: John Doe", "John Doe"),
])
def test_pattern(text, expected):
    print(f"Testing text: {text}")
    matched_value = None
    for pattern in PATTERNS["name"]:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            matched_value = match.group(1).strip()
            print(f"Matched: '{matched_value}'")
            break
    
    assert matched_value == expected, f"Expected {expected}, but got {matched_value} for text: {text}"
