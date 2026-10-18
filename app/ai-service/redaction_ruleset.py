"""Versioned identity and changelog for the redaction rule set (issue #1428).

Both redaction engines in this service - the spaCy/regex scrubber in
``services/pii_scrubber.py`` (and the redaction preview endpoint built on it)
and the logging/audit redactor in ``logging_redaction.py`` - are governed by
one rule-set version. Every redacted output, and every record that persists a
redacted result (including decision audit records), is stamped with
``REDACTION_RULESET_VERSION`` so that, after the fact, it is possible to tell
which rules redacted a given piece of archived output.

This module is intentionally dependency-free so it can be imported from the
logging hot path as well as from the service layer.

When to bump the version
------------------------
Bump ``REDACTION_RULESET_VERSION`` and add a ``REDACTION_RULESET_CHANGELOG``
entry whenever redaction behaviour changes: a pattern is added, removed,
tightened or loosened, the allowlist changes, a field-name mapping changes, or
a replacement token changes. Use semver-style numbering: MAJOR for changes
that stop redacting something previously redacted, MINOR for new rules, PATCH
for fixes that do not change what is redacted in practice.
"""

from __future__ import annotations

from typing import Dict, Tuple

__all__ = ["REDACTION_RULESET_VERSION", "REDACTION_RULESET_CHANGELOG"]

#: Version of the redaction rule set currently in force.
REDACTION_RULESET_VERSION = "1.0.0"

#: Newest entry first. The first entry's ``version`` must equal
#: ``REDACTION_RULESET_VERSION`` (enforced by tests).
REDACTION_RULESET_CHANGELOG: Tuple[Dict[str, object], ...] = (
    {
        "version": "1.0.0",
        "summary": "Initial explicitly versioned rule set (baseline).",
        "changes": (
            "services/pii_scrubber.py: PERSON, LOCATION, DATE, EMAIL, PHONE and "
            "ID (NIN, voter ID) detection via spaCy entity ruler plus regexes, "
            "with the existing allowlist and OCR field-name mapping.",
            "logging_redaction.py: secret key/value, bearer token, JWT, "
            "sk- key, email, SSN, card number, phone and IPv4 patterns, used "
            "for decision audit record redaction.",
        ),
    },
)
