#!/usr/bin/env python3
"""Regenerate the committed static OpenAPI artefacts for the AI service.

``main.py`` serves ``/openapi.json`` at runtime via FastAPI's built-in
support.  This script re-derives that exact document from the live app
object and writes two committed files:

1. ``openapi.json``        — raw OpenAPI 3.1 spec (machine-readable)
2. ``API_REFERENCE.md``    — human-readable markdown reference rendered
                             from the spec (browsable without running the
                             service)

Usage (from the repo root or ``app/ai-service``)::

    python app/ai-service/scripts/generate_openapi.py
    # or
    cd app/ai-service && python scripts/generate_openapi.py

CI (``.github/workflows/ai-service-ci.yml`` -> ``openapi-drift`` job) runs
this script and fails the build if ``git diff --exit-code`` reports a change
to either ``openapi.json`` or ``API_REFERENCE.md``.  When the API surface
changes, regenerate and commit both files in the same PR.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Make ``main`` importable whether this script is invoked from the repo
# root or directly from ``app/ai-service``.
SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

# Importing the module is enough: building the OpenAPI document only needs
# the router registrations; the lifespan (and its side effects) never runs.
from main import app  # noqa: E402  (sys.path setup must run first)

OPENAPI_PATH = SERVICE_DIR / "openapi.json"
REFERENCE_PATH = SERVICE_DIR / "API_REFERENCE.md"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_lf(path: Path, text: str) -> None:
    """Write *text* with LF line endings so CI byte-comparison is stable."""
    path.write_text(text, encoding="utf-8", newline="\n")


def _resolve_ref(spec: dict, ref: str) -> dict:
    parts = ref.lstrip("#/").split("/")
    node: Any = spec
    for p in parts:
        node = node.get(p, {}) if isinstance(node, dict) else {}
    return node  # type: ignore[return-value]


def _type_str(spec: dict, schema: dict) -> str:
    if not schema:
        return ""
    if "$ref" in schema:
        return schema["$ref"].split("/")[-1]
    t = schema.get("type", "")
    fmt = schema.get("format", "")
    any_of = schema.get("anyOf", [])
    if any_of:
        non_null = [_type_str(spec, s) for s in any_of if s.get("type") != "null"]
        nullable = any(s.get("type") == "null" for s in any_of)
        result = " | ".join(non_null) if non_null else "any"
        return result + " | null" if nullable else result
    if t == "array":
        return f"array[{_type_str(spec, schema.get('items', {}))}]"
    return f"{t} ({fmt})" if fmt else t or "object"


def _schema_table(spec: dict, schema_name: str) -> str:
    schema = _resolve_ref(spec, f"#/components/schemas/{schema_name}")
    if not schema:
        return f"_Schema `{schema_name}` not found_\n"

    description = schema.get("description", "")
    props = schema.get("properties", {})
    required_fields = schema.get("required", [])
    enum_vals = schema.get("enum", [])

    lines: list[str] = []
    if description:
        lines.append(f"> {description}\n")

    if enum_vals:
        lines.append(
            "Enum values: `"
            + "` | `".join(str(v) for v in enum_vals)
            + "`\n"
        )
        return "\n".join(lines)

    if not props:
        return "\n".join(lines) if lines else "_No properties_\n"

    lines += [
        "| Field | Type | Required | Description |",
        "|-------|------|----------|-------------|",
    ]
    for field_name, field_schema in props.items():
        resolved = (
            _resolve_ref(spec, field_schema["$ref"])
            if "$ref" in field_schema
            else field_schema
        )
        ts = _type_str(spec, field_schema)
        req = "✓" if field_name in required_fields else ""
        desc = resolved.get("description", field_schema.get("description", ""))
        default = field_schema.get("default")
        if default is not None:
            desc = f"{desc} Default: `{default}`".strip()
        enums = field_schema.get("enum") or resolved.get("enum")
        if enums:
            desc = (
                f"{desc} One of: `"
                + "` | `".join(str(e) for e in enums)
                + "`"
            ).strip()
        lines.append(f"| `{field_name}` | `{ts}` | {req} | {desc} |")
    return "\n".join(lines) + "\n"


_METHOD_LABEL = {
    "get": "**GET**",
    "post": "**POST**",
    "put": "**PUT**",
    "patch": "**PATCH**",
    "delete": "**DELETE**",
}

_TAG_ORDER = [
    ("health", "Health"),
    ("ocr", "OCR"),
    ("proof-of-life", "Proof-of-Life"),
    ("anonymization", "Anonymization"),
    ("humanitarian", "Humanitarian Verification"),
    ("fraud", "Fraud Detection"),
    ("inference", "Async Inference"),
    ("evidence-uploads", "Evidence Uploads"),
    ("verification-artifacts", "Verification Artifacts"),
    ("decision-audit", "Decision Audit"),
    ("dead-letter", "Dead-Letter Queue"),
    ("ai", "Legacy Endpoints (v0)"),
    ("", "Utility"),
]

_KEY_SCHEMAS = [
    "ResultEnvelope_OCRData_",
    "ResultEnvelope_AnonymizeResult_",
    "ResultEnvelope_ProofOfLifeResult_",
    "ResultEnvelope_List_ClaimFraudResult__",
    "ResultEnvelope_RedactionPreviewResult_",
    "AnchorMetadata",
    "ContractMetadata",
    "OCRData",
    "OCRFieldResult",
    "OCRConfidenceBand",
    "TaskStatusResponse",
    "AnonymizeResult",
    "ProofOfLifeResult",
    "ClaimFraudResult",
    "FraudBand",
    "HumanitarianVerificationRequest",
    "UploadSessionResponse",
    "ChunkUploadResponse",
    "FinalizeUploadResponse",
]


def _render_operation(spec: dict, path_key: str, method: str, op: dict) -> str:
    lines: list[str] = []
    summary = op.get("summary", "")
    desc = op.get("description", "")
    params = op.get("parameters", [])
    req_body = op.get("requestBody", {})
    responses = op.get("responses", {})

    label = _METHOD_LABEL.get(method, method.upper())
    lines.append(f"### {label} `{path_key}`")
    if summary:
        lines.append(f"**{summary}**")
    if desc:
        lines.append(f"\n{desc.strip()}")

    path_params = [p for p in params if p.get("in") == "path"]
    query_params = [p for p in params if p.get("in") == "query"]
    header_params = [p for p in params if p.get("in") == "header"]

    if path_params:
        lines += [
            "\n**Path parameters**",
            "| Name | Type | Description |",
            "|------|------|-------------|",
        ]
        for p in path_params:
            s = p.get("schema", {})
            d = p.get("description", s.get("description", ""))
            lines.append(f"| `{p['name']}` | `{_type_str(spec, s)}` | {d} |")

    if query_params:
        lines += [
            "\n**Query parameters**",
            "| Name | Type | Required | Description |",
            "|------|------|----------|-------------|",
        ]
        for p in query_params:
            s = p.get("schema", {})
            req = "✓" if p.get("required") else ""
            d = p.get("description", s.get("description", ""))
            default = s.get("default")
            if default is not None:
                d = f"{d} Default: `{default}`".strip()
            lines.append(
                f"| `{p['name']}` | `{_type_str(spec, s)}` | {req} | {d} |"
            )

    if header_params:
        lines += [
            "\n**Headers**",
            "| Name | Required | Description |",
            "|------|----------|-------------|",
        ]
        for p in header_params:
            s = p.get("schema", {})
            req = "✓" if p.get("required") else ""
            d = p.get("description", s.get("description", ""))
            default = s.get("default")
            if default is not None:
                d = f"{d} Default: `{default}`".strip()
            lines.append(f"| `{p['name']}` | {req} | {d} |")

    if req_body:
        for content_type, ct_schema in req_body.get("content", {}).items():
            schema_ref = ct_schema.get("schema", {})
            if "$ref" in schema_ref:
                sname = schema_ref["$ref"].split("/")[-1]
                lines.append(
                    f"\n**Request body** (`{content_type}`) — `{sname}`"
                )
                lines.append(_schema_table(spec, sname))
            elif schema_ref:
                lines.append(f"\n**Request body** (`{content_type}`)")
                props = schema_ref.get("properties", {})
                if props:
                    lines += [
                        "| Field | Type | Required | Description |",
                        "|-------|------|----------|-------------|",
                    ]
                    req_fields = schema_ref.get("required", [])
                    for fn, fs in props.items():
                        ts = _type_str(spec, fs)
                        req = "✓" if fn in req_fields else ""
                        d = fs.get("description", "")
                        lines.append(f"| `{fn}` | `{ts}` | {req} | {d} |")

    if responses:
        lines += [
            "\n**Responses**",
            "| Status | Description |",
            "|--------|-------------|",
        ]
        for status, resp in sorted(responses.items()):
            lines.append(f"| `{status}` | {resp.get('description', '')} |")

    lines.append("")
    return "\n".join(lines)


def _build_reference(spec: dict) -> str:
    """Render the full API_REFERENCE.md content from *spec*."""
    info = spec.get("info", {})
    paths = spec.get("paths", {})
    schemas = spec.get("components", {}).get("schemas", {})

    # --- group paths by tag ---
    tagged: dict[str, list[tuple[str, str, dict]]] = {
        tag: [] for tag, _ in _TAG_ORDER
    }

    for path_key, methods in sorted(paths.items()):
        for method, op in methods.items():
            tag = (op.get("tags") or [""])[0]
            if tag not in tagged:
                tagged[tag] = []
            tagged[tag].append((path_key, method, op))

    # --- TOC ---
    doc: list[str] = [
        "# Soter AI Service — API Reference",
        "",
        f"> **Version:** {info.get('version', '1.0.0')}  ",
        f"> {info.get('description', '')}",
        "",
        "This document is a static rendering of the service's OpenAPI specification",
        "([`openapi.json`](openapi.json)), auto-generated by",
        "[`scripts/generate_openapi.py`](scripts/generate_openapi.py).",
        "The CI `openapi-drift` job regenerates it on every push and fails if",
        "the committed copy diverges — see [CI / Drift check](#ci--drift-check).",
        "",
        "Interactive docs are also available at runtime:",
        "",
        "| UI | URL |",
        "|----|-----|",
        "| Swagger UI | `http://localhost:8000/docs` |",
        "| ReDoc | `http://localhost:8000/redoc` |",
        "| Raw OpenAPI JSON | `http://localhost:8000/openapi.json` |",
        "",
        "---",
        "",
        "## Table of Contents",
        "",
    ]

    for tag_id, tag_label in _TAG_ORDER:
        ops = tagged.get(tag_id, [])
        if not ops:
            continue
        anchor = (
            tag_label.lower()
            .replace(" ", "-")
            .replace("(", "")
            .replace(")", "")
            .replace("/", "")
        )
        doc.append(f"- [{tag_label}](#{anchor})")
        for path_key, method, op in ops:
            op_anchor = (
                f"{method}-{path_key}"
                .replace("/", "")
                .replace("{", "")
                .replace("}", "")
                .replace(" ", "-")
                .lower()
            )
            doc.append(f"  - [{method.upper()} `{path_key}`](#{op_anchor})")

    doc += [
        "",
        "- [Common schemas](#common-schemas)",
        "- [CI / Drift check](#ci--drift-check)",
        "",
        "---",
        "",
    ]

    # --- operations ---
    for tag_id, tag_label in _TAG_ORDER:
        ops = tagged.get(tag_id, [])
        if not ops:
            continue
        doc += [f"## {tag_label}", ""]
        for path_key, method, op in ops:
            doc.append(_render_operation(spec, path_key, method, op))

    # --- common schemas ---
    doc += [
        "## Common schemas",
        "",
        "The schemas below appear across multiple endpoints as request or response bodies.",
        "",
    ]
    for sname in _KEY_SCHEMAS:
        if sname not in schemas:
            continue
        doc += [f"### `{sname}`", "", _schema_table(spec, sname)]

    # --- CI section ---
    doc += [
        "---",
        "",
        "## CI / Drift check",
        "",
        "The `openapi-drift` job in",
        "[`.github/workflows/ai-service-ci.yml`](../../.github/workflows/ai-service-ci.yml)",
        "keeps this document in sync:",
        "",
        "```text",
        "openapi-drift job:",
        "  1. pip install -r requirements.txt",
        "  2. python scripts/generate_openapi.py   # rewrites openapi.json + API_REFERENCE.md",
        "  3. git diff --exit-code -- app/ai-service/openapi.json app/ai-service/API_REFERENCE.md",
        "     fails if either committed file drifted from the live app",
        "```",
        "",
        "When you add or change a route or Pydantic schema, regenerate and commit",
        "both files in the same PR:",
        "",
        "```bash",
        "cd app/ai-service",
        "python scripts/generate_openapi.py",
        "git add openapi.json API_REFERENCE.md",
        "```",
        "",
    ]

    return "\n".join(doc)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> int:
    spec = app.openapi()

    # 1. Write openapi.json
    openapi_payload = json.dumps(spec, indent=2, sort_keys=True) + "\n"
    _write_lf(OPENAPI_PATH, openapi_payload)
    print(f"Wrote OpenAPI spec  ({len(openapi_payload):>7,} bytes) → {OPENAPI_PATH}")

    # 2. Write API_REFERENCE.md
    reference_payload = _build_reference(spec)
    _write_lf(REFERENCE_PATH, reference_payload)
    print(f"Wrote API reference ({len(reference_payload):>7,} bytes) → {REFERENCE_PATH}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
