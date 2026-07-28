"""
PII scrubber for Soter AI service.

Redacts three categories of personally-identifiable information:
  - Email addresses
  - Phone numbers
  - Numeric IDs (8+ digit standalone numbers not caught by phone pass)

Design notes
------------
Email:
  Handles sub-domains and plus-addressing.

Phone:
  Phone numbers are detected using a two-step approach:
    1. A broad pattern captures any digit-group token that uses common phone
       separators (space, dash, dot, parentheses) but NOT slashes (which are
       used in date strings like 2001/03/15).
    2. A digit-count filter rejects tokens with fewer than 7 digits — this
       eliminates years (4 digits), port numbers (4 digits), prices ($4500),
       version components, and similar short sequences.
    3. ISO 8601 date strings (YYYY-MM-DD) are explicitly excluded before the
       phone pass to avoid false-positives such as "2024-07-28".

  Additional lookbehind rules:
    - Preceded by '$','£','€','#','%','/' → not a phone (currency/path)
    - Preceded by a digit → continuation of prior token, skip

Numeric ID:
  Standalone 8+ digit numbers that weren't caught as phones.
  8-digit minimum keeps years, prices, and ports safe.
"""

import re
from typing import Match

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)

# ---------------------------------------------------------------------------
# ISO date placeholder pass
# Replace ISO dates with a safe token before phone matching so their
# digit groups don't get flagged as phone numbers.
# Matches: YYYY-MM-DD, YYYY-MM-DDTHH:MM, YYYY-MM-DDTHH:MM:SS variants
# ---------------------------------------------------------------------------

_ISO_DATE_RE = re.compile(
    r"\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?"
    r"\b"
)

_ISO_DATE_PLACEHOLDER = "\x00DATE\x00"  # null-byte bookends are safe sentinels

# ---------------------------------------------------------------------------
# Phone – broad capture, digit-count filter
# ---------------------------------------------------------------------------
# Captures tokens built from:
#   - optional leading '+'
#   - digit groups separated by spaces, dashes, dots, or parentheses
#   - NOT slashes (avoids dates like 2024/07/28)
#
# Negative lookbehind: skip if immediately preceded by $£€#%/ or a digit

_PHONE_BROAD_RE = re.compile(
    r"(?<![/$£€#%\d])"         # not preceded by currency, slash, or digit
    r"\+?"                      # optional country-code '+'
    r"\(?\d+\)?"                # first digit cluster (optional parens)
    r"(?:[ \-.]?\(?\d+\)?)+"   # one or more further clusters
    r"(?!\d)"                   # not immediately followed by digit
)

_MIN_PHONE_DIGITS = 7


def _phone_sub(m: Match) -> str:
    token = m.group()
    # Skip sentinel-wrapped date placeholders that leaked through
    if "\x00" in token:
        return token
    digits = sum(c.isdigit() for c in token)
    return "[REDACTED_PHONE]" if digits >= _MIN_PHONE_DIGITS else token


# ---------------------------------------------------------------------------
# Numeric ID (8+ digits not already caught by phone pass)
# ---------------------------------------------------------------------------

_ID_RE = re.compile(r"\b\d{8,}\b")

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def scrub_pii(text: str) -> str:
    """Return *text* with emails, phone numbers, and numeric IDs redacted."""
    # 1. Redact emails (removes '@' before digit passes)
    text = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)

    # 2. Temporarily replace ISO dates so their digit groups are invisible
    #    to the phone-number regex.
    dates_found: list[str] = []

    def _stash_date(m: Match) -> str:
        dates_found.append(m.group())
        return f"{_ISO_DATE_PLACEHOLDER}{len(dates_found) - 1}{_ISO_DATE_PLACEHOLDER}"

    text = _ISO_DATE_RE.sub(_stash_date, text)

    # 3. Redact phone numbers
    text = _PHONE_BROAD_RE.sub(_phone_sub, text)

    # 4. Restore ISO dates
    for idx, date_str in enumerate(dates_found):
        text = text.replace(
            f"{_ISO_DATE_PLACEHOLDER}{idx}{_ISO_DATE_PLACEHOLDER}",
            date_str,
        )

    # 5. Redact 8+ digit IDs (catches anything the phone pass missed)
    text = _ID_RE.sub("[REDACTED_ID]", text)

    return text
