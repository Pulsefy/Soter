"""Field-level redaction for structured data such as OCR output.

Free-text scrubbing (``services/pii_scrubber.py``) detects PII from the
surrounding sentence, which is a poor fit for structured field data where
the field's own label already states what it holds.  This service redacts
those values by the field's *known type*: a ``national_id`` value is
masked as an identity number, ``full_name`` as a name, ``date_of_birth``
as a date, and so on.
"""

from typing import Any, Dict, Optional

from services.pii_scrubber import PIIScrubberService


class StructuredRedactionService:
    """Redacts structured field values according to the field's known type.

    Category labels mirror :class:`PIIScrubberService` so both redaction
    paths share the same token vocabulary (``PERSON`` -> ``[RECIPIENT_NAME]``,
    ``ID`` -> ``[ID_NUMBER]``, ``DATE`` -> ``[EVENT_DATE]``, ...).
    """

    TOKEN_BASE_BY_LABEL = PIIScrubberService.TOKEN_BASE_BY_LABEL

    #: Map a structured/OCR field name to the PII category of its value.
    FIELD_CATEGORY_MAP: Dict[str, str] = {
        # Personal names
        "full_name": "PERSON",
        "name": "PERSON",
        "first_name": "PERSON",
        "last_name": "PERSON",
        "middle_name": "PERSON",
        "recipient_name": "PERSON",
        "beneficiary_name": "PERSON",
        "holder_name": "PERSON",
        "applicant_name": "PERSON",
        # Identity numbers
        "national_id": "ID",
        "national_id_number": "ID",
        "id_number": "ID",
        "id": "ID",
        "nin": "ID",
        "nin_number": "ID",
        "passport_number": "ID",
        "passport_no": "ID",
        "voter_id": "ID",
        "voter_id_number": "ID",
        "driver_license_number": "ID",
        "license_number": "ID",
        # Dates
        "date_of_birth": "DATE",
        "dob": "DATE",
        "birth_date": "DATE",
        "issue_date": "DATE",
        "issued_on": "DATE",
        "expiry_date": "DATE",
        "expires_on": "DATE",
        "valid_until": "DATE",
        # Locations
        "address": "LOCATION",
        "city": "LOCATION",
        "state": "LOCATION",
        "region": "LOCATION",
        "district": "LOCATION",
        "country": "LOCATION",
        "lga": "LOCATION",
        "place_of_birth": "LOCATION",
        # Contact details
        "email": "EMAIL",
        "email_address": "EMAIL",
        "phone": "PHONE",
        "phone_number": "PHONE",
        "mobile": "PHONE",
        "telephone": "PHONE",
        "telephone_number": "PHONE",
    }

    def category_for_field(self, field_name: str) -> Optional[str]:
        """Resolve the PII category indicated by a field's name.

        The lookup is case-insensitive so OCR providers that return
        ``National_ID`` or ``FULL_NAME`` still resolve correctly.
        """
        if not field_name:
            return None
        return self.FIELD_CATEGORY_MAP.get(str(field_name).strip().lower())

    def masked_token_for(self, field_name: str) -> Optional[str]:
        """Return the masking token for a field, or ``None`` when unknown."""
        category = self.category_for_field(field_name)
        if category is None:
            return None
        token_base = self.TOKEN_BASE_BY_LABEL.get(category)
        if token_base is None:
            return None
        return f"[{token_base}]"

    def mask_value(self, field_name: str, value: str) -> str:
        """Return ``value`` masked to the token for its field's category.

        Fields whose type is not known are returned unchanged so callers
        never lose data for unclassified OCR output.
        """
        token = self.masked_token_for(field_name)
        if token is None:
            return value
        return token

    def redact_fields(self, fields: Dict[str, str]) -> Dict[str, str]:
        """Return a copy of ``fields`` with sensitive values masked per type."""
        return {
            field_name: self.mask_value(field_name, value)
            for field_name, value in fields.items()
        }

    def build_preview(self, fields: Dict[str, str]) -> Dict[str, Any]:
        """Summarize how structured fields would be redacted.

        Returns a dict carrying the per-field preview status (category,
        ``redacted`` flag and the replacement token) together with a
        ``pii_summary`` of per-category counts.  Field values themselves
        are never echoed back – only their masked replacement is.
        """
        statuses: Dict[str, Dict[str, Any]] = {}
        counts: Dict[str, int] = {}
        redacted_count = 0

        for field_name, value in fields.items():
            category = self.category_for_field(field_name)
            token = self.masked_token_for(field_name)
            is_redacted = token is not None

            if is_redacted:
                redacted_count += 1
                counts[category] = counts.get(category, 0) + 1

            statuses[field_name] = {
                "field_name": field_name,
                "category": category,
                "redacted": is_redacted,
                "masked_value": token if is_redacted else None,
            }

        return {
            "total_fields": len(fields),
            "redacted_fields": redacted_count,
            "fields": statuses,
            "pii_summary": counts,
        }