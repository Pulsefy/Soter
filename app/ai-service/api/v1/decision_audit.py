"""Decision audit query endpoints (issue #990, export #1206).

Satisfies the "records are queryable by trace id, claim id, and campaign
reference" acceptance criterion: an operator reconstructing why a claim was
rejected weeks later hits ``GET /v1/ai/decision-audit?claim_id=...`` (or by
``trace_id`` / ``campaign_ref``) and gets the inputs, provider, model, prompt
version, outcome, and reasons behind every decision made for that claim.

Issue #1206 adds an export mode (``format=csv`` or ``format=ndjson``) that
streams a downloadable filtered set for compliance review without paging
individual record lookups. Records are already redacted at write time (see
``services/decision_audit.py``), so these endpoints expose no raw PII.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from typing import Any, Dict, Iterator, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from schemas.common import ResultEnvelope
from services.decision_audit import DecisionAuditRecord, get_store

logger = logging.getLogger(__name__)

router = APIRouter(tags=["decision-audit"])

#: Upper bound on how many records one JSON query can return, so a broad query
#: cannot serialise an entire retention window into a single response.
_MAX_LIMIT = 500

#: Page size cap for export mode. Exports stream, so larger pages are safe; the
#: client still paginates with ``offset`` / ``limit`` when the full set is huge.
_MAX_EXPORT_LIMIT = 5000

_EXPORT_FORMATS = frozenset({"csv", "ndjson"})

#: Flat CSV columns. Nested ``inputs`` / ``reasons`` / ``metadata`` are
#: serialised as JSON strings so the download stays one row per record.
_CSV_COLUMNS = (
    "record_id",
    "created_at",
    "decision_type",
    "outcome",
    "trace_id",
    "claim_id",
    "campaign_ref",
    "package_id",
    "org_id",
    "provider",
    "model",
    "prompt_version",
    "prompt_variant",
    "confidence",
    "reasons",
    "inputs",
    "metadata",
    "schema_version",
)


def _resolve_store(http_request: Request):
    """Resolve the audit store from app state, falling back to the module store."""
    store = getattr(http_request.app.state, "decision_audit_store", None)
    if store is None:
        store = get_store()
    if store is None:
        raise HTTPException(
            status_code=503, detail="Decision audit store is not configured"
        )
    return store


def _require_query_identifier(
    trace_id: Optional[str],
    claim_id: Optional[str],
    campaign_ref: Optional[str],
) -> None:
    if not any([trace_id, claim_id, campaign_ref]):
        raise HTTPException(
            status_code=400,
            detail="At least one of trace_id, claim_id, or campaign_ref is required",
        )


def _record_to_csv_row(record: DecisionAuditRecord) -> Dict[str, Any]:
    data = record.to_dict()
    row: Dict[str, Any] = {}
    for col in _CSV_COLUMNS:
        value = data.get(col)
        if col in ("reasons", "inputs", "metadata"):
            row[col] = json.dumps(value, sort_keys=True, default=str)
        else:
            row[col] = "" if value is None else value
    return row


def _stream_ndjson(records: Iterator[DecisionAuditRecord]) -> Iterator[str]:
    """Yield one NDJSON line at a time so large exports are not buffered."""
    for record in records:
        # Records were redacted at write time; export must not undo that.
        yield json.dumps(record.to_dict(), sort_keys=True, default=str) + "\n"


def _stream_csv(records: Iterator[DecisionAuditRecord]) -> Iterator[str]:
    """Yield CSV header then one row per record without loading the full file."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(_CSV_COLUMNS), extrasaction="ignore")
    writer.writeheader()
    yield buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)
    for record in records:
        writer.writerow(_record_to_csv_row(record))
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)


@router.get(
    "/ai/decision-audit",
    response_model=None,
)
async def query_decision_audit(
    http_request: Request,
    trace_id: Optional[str] = Query(
        None, description="Correlation/trace ID echoed on the original response."
    ),
    claim_id: Optional[str] = Query(
        None, description="Claim ID from anchor_metadata or fraud claim metadata."
    ),
    campaign_ref: Optional[str] = Query(
        None, description="Campaign reference from anchor_metadata."
    ),
    decision_type: Optional[str] = Query(
        None,
        description="Filter by decision type, e.g. humanitarian_verification "
        "or fraud_detection.",
    ),
    created_after: Optional[float] = Query(
        None,
        description="Include only records with created_at >= this Unix timestamp.",
    ),
    created_before: Optional[float] = Query(
        None,
        description="Include only records with created_at <= this Unix timestamp.",
    ),
    format: Optional[str] = Query(
        None,
        description="Response format: omit/json for ResultEnvelope JSON; "
        "csv or ndjson for a downloadable streamed export (issue #1206).",
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Number of matching records to skip (pagination for export).",
    ),
    limit: int = Query(100, ge=1, le=_MAX_EXPORT_LIMIT),
):
    """Return or export decision audit records matching the supplied filters.

    At least one of ``trace_id``, ``claim_id``, or ``campaign_ref`` is
    required. Supplying several narrows the result (logical AND). Records
    come back newest first.

    Set ``format=csv`` or ``format=ndjson`` for a streamed downloadable export
    that uses the same filters and redaction as the JSON query. Paginate large
    exports with ``offset`` and ``limit`` (export limit cap is higher than the
    JSON query cap).
    """
    _require_query_identifier(trace_id, claim_id, campaign_ref)

    export_format = (format or "json").strip().lower()
    if export_format not in ("json", "csv", "ndjson"):
        raise HTTPException(
            status_code=400,
            detail="format must be one of: json, csv, ndjson",
        )

    # JSON responses keep the tighter cap so a broad query cannot dump the
    # whole retention window into one envelope.
    if export_format == "json" and limit > _MAX_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"limit must be <= {_MAX_LIMIT} for JSON responses",
        )

    store = _resolve_store(http_request)
    records = store.query(
        trace_id=trace_id,
        claim_id=claim_id,
        campaign_ref=campaign_ref,
        decision_type=decision_type,
        created_after=created_after,
        created_before=created_before,
        offset=offset,
        limit=limit,
    )

    if export_format in _EXPORT_FORMATS:
        # Stream so large exports are not loaded fully into a response buffer.
        filename = f"decision-audit.{export_format}"
        if export_format == "ndjson":
            media_type = "application/x-ndjson"
            body = _stream_ndjson(iter(records))
        else:
            media_type = "text/csv; charset=utf-8"
            body = _stream_csv(iter(records))
        return StreamingResponse(
            body,
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Export-Count": str(len(records)),
                "X-Export-Offset": str(offset),
                "X-Export-Limit": str(limit),
            },
        )

    return ResultEnvelope[List[Dict[str, Any]]](
        result=[r.to_dict() for r in records],
        confidence=None,
        reasons=None,
        anchor_metadata=None,
        trace_id=getattr(http_request.state, "correlation_id", "") or None,
    )


@router.get(
    "/ai/decision-audit/{record_id}",
    response_model=ResultEnvelope[Dict[str, Any]],
)
async def get_decision_audit_record(
    http_request: Request,
    record_id: str,
) -> ResultEnvelope[Dict[str, Any]]:
    """Return a single decision audit record by its ``record_id``."""
    store = _resolve_store(http_request)
    record = store.get(record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit record not found")

    return ResultEnvelope[Dict[str, Any]](
        result=record.to_dict(),
        confidence=None,
        reasons=None,
        anchor_metadata=None,
        trace_id=getattr(http_request.state, "correlation_id", "") or None,
    )
