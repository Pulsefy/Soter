"""
Tests for AnchorMetadata identifier field validation (schemas/common.py).

Acceptance criteria verified here:
  ✓ All three fields are validated against an explicit pattern and max length
  ✓ Validation failures raise ValidationError with the offending field named
  ✓ Constraints appear in the generated JSON/OpenAPI schema
  ✓ Empty strings are rejected; omitted (None) values remain valid
  ✓ Valid values, over-length values, and disallowed characters are all covered
"""

from __future__ import annotations

import string

import pytest
from pydantic import ValidationError

from schemas.common import AnchorMetadata

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FIELDS = ("campaign_ref", "claim_id", "package_id")
MAX_LEN = 128


def make(**kwargs) -> AnchorMetadata:
    return AnchorMetadata(**kwargs)


def assert_field_error(exc_info: pytest.ExceptionInfo, field: str) -> None:
    """Assert that a ValidationError names *field* in at least one error."""
    errors = exc_info.value.errors()
    locs = [e["loc"] for e in errors]
    assert any(field in loc for loc in locs), (
        f"Expected error on field '{field}', got locations: {locs}"
    )


# ---------------------------------------------------------------------------
# Valid value tests
# ---------------------------------------------------------------------------


class TestValidValues:
    """Values that must be accepted without error."""

    @pytest.mark.parametrize("field", FIELDS)
    def test_typical_identifier(self, field):
        obj = make(**{field: "campaign-2024-001"})
        assert getattr(obj, field) == "campaign-2024-001"

    @pytest.mark.parametrize("field", FIELDS)
    def test_single_alphanumeric_character(self, field):
        obj = make(**{field: "A"})
        assert getattr(obj, field) == "A"

    @pytest.mark.parametrize("field", FIELDS)
    def test_alphanumeric_only(self, field):
        obj = make(**{field: "abc123XYZ"})
        assert getattr(obj, field) == "abc123XYZ"

    @pytest.mark.parametrize("field", FIELDS)
    def test_hyphens_allowed(self, field):
        obj = make(**{field: "claim-abc-123"})
        assert getattr(obj, field) == "claim-abc-123"

    @pytest.mark.parametrize("field", FIELDS)
    def test_underscores_allowed(self, field):
        obj = make(**{field: "package_x7y8z9"})
        assert getattr(obj, field) == "package_x7y8z9"

    @pytest.mark.parametrize("field", FIELDS)
    def test_mixed_separators(self, field):
        obj = make(**{field: "a1-b2_c3"})
        assert getattr(obj, field) == "a1-b2_c3"

    @pytest.mark.parametrize("field", FIELDS)
    def test_exactly_max_length(self, field):
        # MAX_LEN chars starting with a letter
        value = "a" + "b" * (MAX_LEN - 1)
        assert len(value) == MAX_LEN
        obj = make(**{field: value})
        assert getattr(obj, field) == value

    @pytest.mark.parametrize("field", FIELDS)
    def test_none_is_valid(self, field):
        """Omitting a field (passing None explicitly) must be valid."""
        obj = make(**{field: None})
        assert getattr(obj, field) is None

    def test_all_fields_none(self):
        """Completely empty AnchorMetadata is valid (all fields optional)."""
        obj = AnchorMetadata()
        assert obj.campaign_ref is None
        assert obj.claim_id is None
        assert obj.package_id is None

    def test_all_fields_populated(self):
        obj = make(
            campaign_ref="campaign-2024-001",
            claim_id="claim-abc123",
            package_id="package-x7y8z9",
        )
        assert obj.campaign_ref == "campaign-2024-001"
        assert obj.claim_id == "claim-abc123"
        assert obj.package_id == "package-x7y8z9"


# ---------------------------------------------------------------------------
# Over-length tests
# ---------------------------------------------------------------------------


class TestOverLength:
    """Values that exceed max_length=128 must be rejected."""

    @pytest.mark.parametrize("field", FIELDS)
    def test_one_over_max(self, field):
        value = "a" * (MAX_LEN + 1)
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: value})
        assert_field_error(exc_info, field)

    @pytest.mark.parametrize("field", FIELDS)
    def test_far_over_max(self, field):
        value = "a" * 500
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: value})
        assert_field_error(exc_info, field)

    @pytest.mark.parametrize("field", FIELDS)
    def test_error_type_is_string_too_long(self, field):
        value = "a" * (MAX_LEN + 1)
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: value})
        types = [e["type"] for e in exc_info.value.errors()]
        assert any("too_long" in t or "max_length" in t for t in types), (
            f"Expected a 'too_long' / 'max_length' error, got: {types}"
        )


# ---------------------------------------------------------------------------
# Empty string tests
# ---------------------------------------------------------------------------


class TestEmptyString:
    """Empty string must be rejected for every field."""

    @pytest.mark.parametrize("field", FIELDS)
    def test_empty_string_rejected(self, field):
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: ""})
        assert_field_error(exc_info, field)

    @pytest.mark.parametrize("field", FIELDS)
    def test_error_type_is_string_too_short_or_pattern(self, field):
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: ""})
        types = [e["type"] for e in exc_info.value.errors()]
        # Pydantic raises string_too_short (min_length) OR pattern mismatch
        assert any(
            "too_short" in t or "min_length" in t or "pattern" in t for t in types
        ), f"Unexpected error types for empty string: {types}"


# ---------------------------------------------------------------------------
# Disallowed character tests
# ---------------------------------------------------------------------------


class TestDisallowedCharacters:
    """Characters outside [A-Za-z0-9\-_] must be rejected."""

    # Each tuple: (label, value_template) — {c} replaced with the bad char
    DISALLOWED_CHARS = [
        ("space", "valid {c}value"),
        ("tab", "valid{c}value"),
        ("newline", "valid{c}value"),
        ("carriage_return", "valid{c}value"),
        ("null_byte", "valid{c}value"),
        ("slash_forward", "valid{c}value"),
        ("slash_back", "valid{c}value"),
        ("dot", "valid{c}value"),
        ("at_sign", "valid{c}value"),
        ("hash", "valid{c}value"),
        ("dollar", "valid{c}value"),
        ("percent", "valid{c}value"),
        ("ampersand", "valid{c}value"),
        ("plus", "valid{c}value"),
        ("equals", "valid{c}value"),
        ("semicolon", "valid{c}value"),
        ("colon", "valid{c}value"),
        ("comma", "valid{c}value"),
        ("exclamation", "valid{c}value"),
        ("question_mark", "valid{c}value"),
        ("open_paren", "valid{c}value"),
        ("close_paren", "valid{c}value"),
        ("open_bracket", "valid{c}value"),
        ("close_bracket", "valid{c}value"),
        ("open_brace", "valid{c}value"),
        ("close_brace", "valid{c}value"),
        ("pipe", "valid{c}value"),
        ("caret", "valid{c}value"),
        ("tilde", "valid{c}value"),
        ("backtick", "valid{c}value"),
        ("single_quote", "valid{c}value"),
        ("double_quote", "valid{c}value"),
        ("less_than", "valid{c}value"),
        ("greater_than", "valid{c}value"),
    ]

    _CHAR_MAP: dict[str, str] = {
        "space": " ",
        "tab": "\t",
        "newline": "\n",
        "carriage_return": "\r",
        "null_byte": "\x00",
        "slash_forward": "/",
        "slash_back": "\\",
        "dot": ".",
        "at_sign": "@",
        "hash": "#",
        "dollar": "$",
        "percent": "%",
        "ampersand": "&",
        "plus": "+",
        "equals": "=",
        "semicolon": ";",
        "colon": ":",
        "comma": ",",
        "exclamation": "!",
        "question_mark": "?",
        "open_paren": "(",
        "close_paren": ")",
        "open_bracket": "[",
        "close_bracket": "]",
        "open_brace": "{",
        "close_brace": "}",
        "pipe": "|",
        "caret": "^",
        "tilde": "~",
        "backtick": "`",
        "single_quote": "'",
        "double_quote": '"',
        "less_than": "<",
        "greater_than": ">",
    }

    @pytest.mark.parametrize("field", FIELDS)
    @pytest.mark.parametrize("label,template", DISALLOWED_CHARS)
    def test_disallowed_char_rejected(self, field, label, template):
        bad_char = self._CHAR_MAP[label]
        value = template.format(c=bad_char)
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: value})
        assert_field_error(exc_info, field)

    @pytest.mark.parametrize("field", FIELDS)
    def test_leading_hyphen_rejected(self, field):
        """Identifier must start with alphanumeric, not a separator."""
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: "-bad-start"})
        assert_field_error(exc_info, field)

    @pytest.mark.parametrize("field", FIELDS)
    def test_leading_underscore_rejected(self, field):
        """Identifier must start with alphanumeric, not a separator."""
        with pytest.raises(ValidationError) as exc_info:
            make(**{field: "_bad_start"})
        assert_field_error(exc_info, field)


# ---------------------------------------------------------------------------
# JSON schema / OpenAPI contract tests
# ---------------------------------------------------------------------------


class TestOpenAPISchema:
    """Constraints must be reflected in the generated JSON Schema."""

    def _schema(self) -> dict:
        return AnchorMetadata.model_json_schema()

    def test_schema_has_properties(self):
        schema = self._schema()
        assert "properties" in schema or "$defs" in schema or "anyOf" in schema

    @pytest.mark.parametrize("field", FIELDS)
    def test_field_has_max_length(self, field):
        schema = self._schema()
        props = schema.get("properties", {})
        # Fields may be wrapped in anyOf for Optional — drill into the str subschema
        field_schema = props.get(field, {})
        field_str_schema = _unwrap_optional(field_schema)
        assert "maxLength" in field_str_schema, (
            f"Expected maxLength in schema for '{field}': {field_str_schema}"
        )
        assert field_str_schema["maxLength"] == MAX_LEN

    @pytest.mark.parametrize("field", FIELDS)
    def test_field_has_min_length(self, field):
        schema = self._schema()
        props = schema.get("properties", {})
        field_schema = props.get(field, {})
        field_str_schema = _unwrap_optional(field_schema)
        assert "minLength" in field_str_schema, (
            f"Expected minLength in schema for '{field}': {field_str_schema}"
        )
        assert field_str_schema["minLength"] == 1

    @pytest.mark.parametrize("field", FIELDS)
    def test_field_has_pattern(self, field):
        schema = self._schema()
        props = schema.get("properties", {})
        field_schema = props.get(field, {})
        field_str_schema = _unwrap_optional(field_schema)
        assert "pattern" in field_str_schema, (
            f"Expected pattern in schema for '{field}': {field_str_schema}"
        )
        # Pattern must reference alphanumeric characters
        pat = field_str_schema["pattern"]
        assert "A-Za-z0-9" in pat, f"Pattern does not restrict to alphanumeric: {pat}"


def _unwrap_optional(field_schema: dict) -> dict:
    """
    Pydantic renders Optional[Annotated[str, ...]] as::

        {"anyOf": [<str schema>, {"type": "null"}], "default": null}

    Unwrap the anyOf to return the actual string sub-schema.
    """
    if "anyOf" in field_schema:
        for sub in field_schema["anyOf"]:
            if sub.get("type") == "string":
                return sub
        # Fall back to first non-null schema
        for sub in field_schema["anyOf"]:
            if sub.get("type") != "null":
                return sub
    return field_schema
