"""PII scrubbing service for privacy-preserving anonymization before LLM use."""

import re
from dataclasses import dataclass
from typing import Dict, List, Tuple
import time
import metrics

import spacy
from spacy.language import Language


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
        r"\b(?:in|at|from|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s+(?:Camp|State|Region|District|City|Village))?)\b",
    ]

    def __init__(self):
        self.nlp = self._build_nlp()

    def anonymize(self, text: str) -> Dict[str, object]:
        """Return privacy-preserving anonymized text and summary metadata."""
        start_time = time.time()
        try:
            if not text:
                return {
                    "original_length": 0,
                    "anonymized_text": "",
                    "pii_summary": {"names": 0, "locations": 0, "dates": 0, "total": 0},
                    "token_counts": {},
                }

            spans = self._detect_spans(text)
            anonymized_text, token_counts = self._mask_spans(text, spans)

            names = sum(1 for span in spans if span.label == "PERSON")
            locations = sum(1 for span in spans if span.label == "LOCATION")
            dates = sum(1 for span in spans if span.label == "DATE")

            return {
                "original_length": len(text),
                "anonymized_text": anonymized_text,
                "pii_summary": {
                    "names": names,
                    "locations": locations,
                    "dates": dates,
                    "total": len(spans),
                },
                "token_counts": token_counts,
            }
        finally:
            latency = time.time() - start_time
            metrics.PIPELINE_STEP_LATENCY.labels(step_name='scrub').observe(latency)

    def _build_nlp(self) -> Language:
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
                                "IN": ["camp", "state", "region", "district", "city", "village"]
                            },
                            "OP": "?",
                        },
                    ],
                },
                {
                    "label": "DATE",
                    "pattern": [{"SHAPE": "dd/dd/dddd"}],
                },
                {
                    "label": "DATE",
                    "pattern": [{"SHAPE": "dd-dd-dddd"}],
                },
                {
                    "label": "DATE",
                    "pattern": [
                        {"IS_DIGIT": True},
                        {"LOWER": {"IN": ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]}},
                        {"IS_DIGIT": True},
                    ],
                },
            ]
        )
        return nlp

    def _detect_spans(self, text: str) -> List[PIISpan]:
        doc = self.nlp(text)
        spans: List[PIISpan] = []

        for ent in doc.ents:
            mapped = self._normalize_label(ent.label_)
            if mapped:
                spans.append(PIISpan(start=ent.start_char, end=ent.end_char, label=mapped, text=ent.text))

        for pattern in self.DATE_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "DATE"))

        for pattern in self.NAME_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "PERSON"))

        for pattern in self.LOCATION_REGEXES:
            spans.extend(self._spans_from_regex(text, pattern, "LOCATION", capture_group=1))

        return self._dedupe_and_sort_spans(spans)

    def _normalize_label(self, label: str) -> str:
        if label in {"PERSON"}:
            return "PERSON"
        if label in {"GPE", "LOC", "FAC", "LOCATION"}:
            return "LOCATION"
        if label in {"DATE"}:
            return "DATE"
        return ""

    def _spans_from_regex(self, text: str, pattern: str, label: str, capture_group: int = 0) -> List[PIISpan]:
        spans: List[PIISpan] = []
        for match in re.finditer(pattern, text):
            if capture_group:
                start, end = match.start(capture_group), match.end(capture_group)
                value = match.group(capture_group)
            else:
                start, end = match.start(), match.end()
                value = match.group(0)

            spans.append(PIISpan(start=start, end=end, label=label, text=value))
        return spans

    def _dedupe_and_sort_spans(self, spans: List[PIISpan]) -> List[PIISpan]:
        if not spans:
            return []

        sorted_spans = sorted(spans, key=lambda span: (span.start, -(span.end - span.start)))
        filtered: List[PIISpan] = []
        current_end = -1

        for span in sorted_spans:
            if span.start < current_end:
                continue
            filtered.append(span)
            current_end = span.end

        return filtered

    def _mask_spans(self, text: str, spans: List[PIISpan]) -> Tuple[str, Dict[str, int]]:
        if not spans:
            return text, {}

        counters: Dict[str, int] = {"PERSON": 0, "LOCATION": 0, "DATE": 0}
        token_counts: Dict[str, int] = {}
        chunks: List[str] = []
        cursor = 0

        for span in spans:
            chunks.append(text[cursor:span.start])
            counters[span.label] += 1
            token_base = self.TOKEN_BASE_BY_LABEL[span.label]
            token = f"[{token_base}]"
            token_counts[token] = token_counts.get(token, 0) + 1
            chunks.append(token)
            cursor = span.end

        chunks.append(text[cursor:])
        return "".join(chunks), token_counts
