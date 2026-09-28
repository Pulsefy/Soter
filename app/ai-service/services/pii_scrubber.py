"""PII scrubbing service for privacy-preserving anonymization before LLM use."""

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple
import time
import metrics

try:
    import spacy
    from spacy.language import Language
except Exception:  # pragma: no cover - spaCy may be unavailable or incompatible
    spacy = None
    Language = Any

from config import settings
from services.test_provider import TestProvider


@dataclass
class PIISpan:
    start: int
    end: int
    label: str
    text: str


class PIIScrubberService:
    """Detects and masks names, locations, and dates in free text."""

    TOKEN_BASE_BY_LABEL = {
        "PERSON": "RECIPIENT_NAME",
        "LOCATION": "LOCATION",
        "DATE": "EVENT_DATE",
        "EMAIL": "EMAIL_ADDRESS",
        "PHONE": "PHONE_NUMBER",
        "ID": "ID_NUMBER",
    }

    FIELD_REDACTION_BY_NAME = {
        "name": "RECIPIENT_NAME",
        "full_name": "RECIPIENT_NAME",
        "first_name": "RECIPIENT_NAME",
        "last_name": "RECIPIENT_NAME",
        "date_of_birth": "EVENT_DATE",
        "dob": "EVENT_DATE",
        "birth_date": "EVENT_DATE",
        "date": "EVENT_DATE",
        "national_id": "ID_NUMBER",
        "id_number": "ID_NUMBER",
        "passport_number": "ID_NUMBER",
        "passport_no": "ID_NUMBER",
        "document_id": "ID_NUMBER",
        "phone_number": "PHONE_NUMBER",
        "phone": "PHONE_NUMBER",
        "email": "EMAIL_ADDRESS",
        "email_address": "EMAIL_ADDRESS",
        "address": "LOCATION",
        "location": "LOCATION",
        "city": "LOCATION",
        "state": "LOCATION",
        "country": "LOCATION",
    }

    ALLOWLIST = {
        "Soter",
        "Pulsefy",
        "Stellar",
        "Humanitarian",
        "Coordinator",
        "Manager",
        "Project",
        "Water",
        "Clear",
        "Crystal",
        "HTTP",  # HTTP error codes like 404-123-4567 should not match
    }

    DATE_REGEXES = [
        r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
        r"\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b",
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b",
        r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}\b",
    ]

    NAME_REGEXES = [
        r"\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b",
        r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b",
    ]

    LOCATION_REGEXES = [
        r"\b(?:in|at|from|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s+(?:Camp|State|Region|District|City|Village|Way|Island))?)\b",
        r"\d+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:Way|Street|Avenue|Road|Island)\b",
    ]

    EMAIL_REGEXES = [
        r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    ]

    PHONE_REGEXES = [
        r"\+?\d{1,4}[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{3}[-.\s]?\d{4}\b",
        r"\b0\d{10}\b",
        r"\+234\s?\d{3}\s?\d{3}\s?\d{4}\b",
    ]

    ID_REGEXES = [
        r"\b\d{11}\b",  # NIN (Nigeria)
        r"\b[A-Z]{2}\d{8}\b",  # Voter ID
    ]

    def __init__(self):
        self.nlp = self._build_nlp()
        self.test_provider = TestProvider()

    def anonymize(self, text: str) -> Dict[str, object]:
        """Return privacy-preserving anonymized text and summary metadata."""
        if settings.test_provider_mode:
            return self.test_provider.get_response("anonymize", {"text": text})

        start_time = time.time()
        try:
            if not text:
                return {
                    "original_length": 0,
                    "anonymized_text": "",
                    "pii_summary": {"names": 0, "locations": 0, "dates": 0, "total": 0},
                    "token_counts": {},
                }

            spans = self.detect_spans(text)
            anonymized_text, token_counts = self._mask_spans(text, spans)

            names = sum(1 for span in spans if span.label == "PERSON")
            locations = sum(1 for span in spans if span.label == "LOCATION")
            dates = sum(1 for span in spans if span.label == "DATE")
            emails = sum(1 for span in spans if span.label == "EMAIL")
            phones = sum(1 for span in spans if span.label == "PHONE")
            ids = sum(1 for span in spans if span.label == "ID")

            return {
                "original_length": len(text),
                "anonymized_text": anonymized_text,
                "pii_summary": {
                    "names": names,
                    "locations": locations,
                    "dates": dates,
                    "emails": emails,
                    "phones": phones,
                    "ids": ids,
                    "total": len(spans),
                },
                "token_counts": token_counts,
            }
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name="scrub").observe(latency)

    def detect_spans(self, text: str) -> List[PIISpan]:
        """Public accessor for detected PII spans.

        Used by both `anonymize()` (which masks them) and the redaction
        preview-diff endpoint (which needs the spans without masking).
        """
        if not text:
            return []
        return self._detect_spans(text)

    def build_preview_segments(
        self, text: str, spans: List[PIISpan]
    ) -> List[Dict[str, object]]:
        """Turn detected spans into kept/redacted segments covering the full text."""
        segments: List[Dict[str, object]] = []
        cursor = 0

        for span in spans:
            if span.start > cursor:
                segments.append(
                    {
                        "type": "kept",
                        "start": cursor,
                        "end": span.start,
                        "category": None,
                    }
                )
            segments.append(
                {
                    "type": "redacted",
                    "start": span.start,
                    "end": span.end,
                    "category": self.TOKEN_BASE_BY_LABEL[span.label],
                }
            )
            cursor = span.end

        if cursor < len(text):
            segments.append(
                {"type": "kept", "start": cursor, "end": len(text), "category": None}
            )

        return segments

    def preview_structured_fields(self, fields: Dict[str, object]) -> Dict[str, object]:
        """Build a redaction preview for structured OCR field payloads."""
        if not fields:
            return {
                "original_length": 0,
                "segments": [],
                "pii_summary": {
                    "names": 0,
                    "locations": 0,
                    "dates": 0,
                    "emails": 0,
                    "phones": 0,
                    "ids": 0,
                    "total": 0,
                },
            }

        rendered_text = ""
        segments: List[Dict[str, object]] = []
        pii_summary = {
            "names": 0,
            "locations": 0,
            "dates": 0,
            "emails": 0,
            "phones": 0,
            "ids": 0,
            "total": 0,
        }
        cursor = 0

        for field_name, field_value in fields.items():
            value = self._coerce_structured_value(field_value)
            label_prefix = f"{field_name}: "
            rendered_value = value if value else ""
            rendered_entry = f"{label_prefix}{rendered_value}\n"
            entry_start = len(rendered_text)
            entry_end = entry_start + len(rendered_entry)
            rendered_text += rendered_entry

            if not rendered_value:
                continue

            category = self._map_ocr_field_to_category(str(field_name))
            value_start = entry_start + len(label_prefix)
            value_end = entry_end - 1 if rendered_entry.endswith("\n") else entry_end

            if value_start > cursor:
                segments.append(
                    {
                        "type": "kept",
                        "start": cursor,
                        "end": value_start,
                        "category": None,
                    }
                )

            if category is not None:
                segments.append(
                    {
                        "type": "redacted",
                        "start": value_start,
                        "end": value_end,
                        "category": category,
                    }
                )
                if category == "RECIPIENT_NAME":
                    pii_summary["names"] += 1
                elif category == "LOCATION":
                    pii_summary["locations"] += 1
                elif category == "EVENT_DATE":
                    pii_summary["dates"] += 1
                elif category == "EMAIL_ADDRESS":
                    pii_summary["emails"] += 1
                elif category == "PHONE_NUMBER":
                    pii_summary["phones"] += 1
                elif category == "ID_NUMBER":
                    pii_summary["ids"] += 1
                cursor = value_end
            else:
                cursor = value_end

        if cursor < len(rendered_text):
            segments.append(
                {
                    "type": "kept",
                    "start": cursor,
                    "end": len(rendered_text),
                    "category": None,
                }
            )

        pii_summary["total"] = sum(pii_summary.values())
        return {
            "original_length": len(rendered_text),
            "segments": segments,
            "pii_summary": pii_summary,
        }

    def redact_structured_fields(self, fields: Dict[str, object]) -> Dict[str, object]:
        """Return the same OCR fields with sensitive values replaced by their category token."""
        redacted: Dict[str, object] = {}
        for field_name, field_value in fields.items():
            value = self._coerce_structured_value(field_value)
            category = self._map_ocr_field_to_category(str(field_name))
            if category is None:
                redacted[field_name] = field_value
                continue
            token = f"[{category}]"
            if isinstance(field_value, dict):
                redacted[field_name] = {**field_value, "value": token}
            else:
                redacted[field_name] = token
        return redacted

    def _coerce_structured_value(self, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, dict):
            nested_value = value.get("value")
            if nested_value is not None:
                return str(nested_value)
            return ""
        return str(value)

    def _map_ocr_field_to_category(self, field_name: str) -> str | None:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(field_name).lower()).strip("_")
        exact = self.FIELD_REDACTION_BY_NAME.get(normalized)
        if exact:
            return exact

        if "name" in normalized:
            return "RECIPIENT_NAME"
        if "dob" in normalized or "birth" in normalized or "date" in normalized:
            return "EVENT_DATE"
        if "passport" in normalized or "national" in normalized or "id" in normalized:
            return "ID_NUMBER"
        if "phone" in normalized:
            return "PHONE_NUMBER"
        if "email" in normalized:
            return "EMAIL_ADDRESS"
        if "address" in normalized or "location" in normalized or "city" in normalized:
            return "LOCATION"
        return None

    def _build_nlp(self) -> Language | None:
        if spacy is None:
            return None

        nlp = spacy.blank("en")
        ruler = nlp.add_pipe("entity_ruler")
        ruler.add_patterns(
            [
                {
                    "label": "PERSON",
                    "pattern": [
                        {"LOWER": {"IN": ["mr", "mrs", "ms", "miss", "dr", "prof"]}},
                        {"IS_TITLE": True},
                        {"IS_TITLE": True, "OP": "?"},
                    ],
                },
                {
                    "label": "PERSON",
                    "pattern": [
                        {"IS_TITLE": True},
                        {"IS_TITLE": True},
                    ],
                },
                {
                    "label": "LOCATION",
                    "pattern": [
                        {"LOWER": {"IN": ["in", "at", "from", "near"]}},
                        {"IS_TITLE": True},
                        {"IS_TITLE": True, "OP": "?"},
                        {"IS_TITLE": True, "OP": "?"},
                        {
                            "LOWER": {
                                "IN": [
                                    "camp",
                                    "state",
                                    "region",
                                    "district",
                                    "city",
                                    "village",
                                ]
                            },
                            "OP": "?",
                        },
                    ],
                },
                {"label": "DATE", "pattern": [{"SHAPE": "dd/dd/dddd"}]},
                {"label": "DATE", "pattern": [{"SHAPE": "dd-dd-dddd"}]},
                {
                    "label": "DATE",
                    "pattern": [
                        {"IS_DIGIT": True},
                        {
                            "LOWER": {
                                "IN": [
                                    "jan",
                                    "feb",
                                    "mar",
                                    "apr",
                                    "may",
                                    "jun",
                                    "jul",
                                    "aug",
                                    "sep",
                                    "sept",
                                    "oct",
                                    "nov",
                                    "dec",
                                ]
                            }
                        },
                        {"IS_DIGIT": True},
                    ],
                },
            ]
        )
        return nlp

    def _detect_spans(self, text: str) -> List[PIISpan]:
        spans: List[PIISpan] = []

        # Check for emails FIRST to prioritize them over names
        email_spans = []
        for pattern in self.EMAIL_REGEXES:
            email_spans.extend(self._spans_from_regex(text, pattern, "EMAIL"))
        spans.extend(email_spans)

        email_ranges = {(span.start, span.end) for span in email_spans}

        if self.nlp is not None:
            doc = self.nlp(text)

            for ent in doc.ents:
                if any(
                    not (ent.end_char <= start or ent.start_char >= end)
                    for start, end in email_ranges
                ):
                    continue

                mapped = self._normalize_label(ent.label_)
                if mapped:
                    spans.append(
                        PIISpan(
                            start=ent.start_char,
                            end=ent.end_char,
                            label=mapped,
                            text=ent.text,
                        )
                    )

        for pattern in self.DATE_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "DATE"))
        for pattern in self.NAME_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "PERSON"))
        for pattern in self.LOCATION_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "LOCATION"))
        for pattern in self.PHONE_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "PHONE"))
        for pattern in self.ID_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "ID"))

        return self._dedupe_and_sort_spans(spans)

    def _normalize_label(self, label: str) -> str:
        if label in {"PERSON"}:
            return "PERSON"
        if label in {"GPE", "LOC", "FAC", "LOCATION"}:
            return "LOCATION"
        if label in {"DATE"}:
            return "DATE"
        return ""

    def _spans_from_regex(
        self, text: str, pattern: str, label: str, capture_group: int = 0
    ) -> List[PIISpan]:
        spans: List[PIISpan] = []
        for match in re.finditer(pattern, text):
            if capture_group:
                start, end = match.start(capture_group), match.end(capture_group)
                value = match.group(capture_group)
            else:
                start, end = match.start(), match.end()
                value = match.group(0)

            if label == "PHONE":
                context_start = max(0, start - 20)
                context = text[context_start:start].lower()
                if "error" in context or "http" in context:
                    continue

            spans.append(PIISpan(start=start, end=end, label=label, text=value))
        return spans

    def _dedupe_and_sort_spans(self, spans: List[PIISpan]) -> List[PIISpan]:
        if not spans:
            return []

        filtered_by_allowlist = [
            span
            for span in spans
            if not any(word in self.ALLOWLIST for word in span.text.split())
        ]

        sorted_spans = sorted(
            filtered_by_allowlist,
            key=lambda span: (
                span.start,
                -(span.end - span.start),
                0 if span.label == "EMAIL" else 1,
            ),
        )
        filtered: List[PIISpan] = []
        current_end = -1

        for span in sorted_spans:
            if span.start < current_end:
                continue
            filtered.append(span)
            current_end = span.end

        return filtered

    def _mask_spans(
        self, text: str, spans: List[PIISpan]
    ) -> Tuple[str, Dict[str, int]]:
        if not spans:
            return text, {}

        counters: Dict[str, int] = {k: 0 for k in self.TOKEN_BASE_BY_LABEL.keys()}
        token_counts: Dict[str, int] = {}
        chunks: List[str] = []
        cursor = 0

        for span in spans:
            chunks.append(text[cursor : span.start])
            counters[span.label] += 1
            token_base = self.TOKEN_BASE_BY_LABEL[span.label]
            token = f"[{token_base}]"
            token_counts[token] = token_counts.get(token, 0) + 1
            chunks.append(token)
            cursor = span.end

        chunks.append(text[cursor:])
        return "".join(chunks), token_counts
