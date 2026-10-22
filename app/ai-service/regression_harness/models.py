import json
import os
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any


@dataclass
class BoundingBox:
    x: int
    y: int
    width: int
    height: int

    def to_dict(self):
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}

    @classmethod
    def from_dict(cls, data: dict):
        return cls(**data)


@dataclass
class EvaluationSample:
    id: str
    image_path: str
    expected_fields: Dict[str, str]
    expected_bboxes: Dict[str, BoundingBox] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FieldEvaluation:
    field_name: str
    expected_value: Optional[str]
    actual_value: Optional[str]
    is_match: bool
    error_type: Optional[str] = (
        None  # 'missing_field', 'incorrect_value', 'unexpected_field'
    )
    confidence: float = 0.0


@dataclass
class SampleResult:
    sample_id: str
    field_evaluations: List[FieldEvaluation]
    passed: bool
    raw_text: str
    processing_time_ms: int


@dataclass
class RegressionReport:
    total_samples: int
    passed_samples: int
    failed_samples: int
    accuracy_percentage: float
    error_counts: Dict[str, int]
    sample_results: List[SampleResult]

    def to_dict(self):
        return {
            "summary": {
                "total": self.total_samples,
                "passed": self.passed_samples,
                "failed": self.failed_samples,
                "accuracy": self.accuracy_percentage,
                "error_breakdown": self.error_counts,
            },
            "details": [
                {
                    "sample_id": r.sample_id,
                    "passed": r.passed,
                    "fields": [
                        {
                            "name": f.field_name,
                            "expected": f.expected_value,
                            "actual": f.actual_value,
                            "match": f.is_match,
                            "error": f.error_type,
                            "confidence": f.confidence,
                        }
                        for f in r.field_evaluations
                    ],
                }
                for r in self.sample_results
            ],
        }


class Verdict(str, Enum):
    PASS = "pass"
    REVIEW = "review"
    REJECT = "reject"


def verdict_from_sample_result(result: SampleResult) -> Verdict:
    """Derive a coarse verdict from a sample result.

    A sample that fully passes is PASS. A sample with any incorrect or
    missing field is REVIEW (needs human attention). A sample with no
    matched fields at all, or an unexpected field, is REJECT.
    """
    if result.passed:
        return Verdict.PASS
    if not result.field_evaluations:
        return Verdict.REJECT
    matched = sum(1 for f in result.field_evaluations if f.is_match)
    if matched == 0:
        return Verdict.REJECT
    if any(f.error_type == "unexpected_field" for f in result.field_evaluations):
        return Verdict.REJECT
    return Verdict.REVIEW


@dataclass
class DryRunCaseDiff:
    sample_id: str
    active_verdict: Verdict
    draft_verdict: Verdict
    verdict_changed: bool
    active_raw_text: str
    draft_raw_text: str
    field_changes: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self):
        return {
            "sample_id": self.sample_id,
            "active_verdict": self.active_verdict.value,
            "draft_verdict": self.draft_verdict.value,
            "verdict_changed": self.verdict_changed,
            "active_raw_text": self.active_raw_text,
            "draft_raw_text": self.draft_raw_text,
            "field_changes": self.field_changes,
        }


@dataclass
class DryRunReport:
    active_version: str
    draft_version: str
    total_cases: int
    verdict_changed_count: int
    case_diffs: List[DryRunCaseDiff]

    @property
    def verdict_changed_cases(self) -> List[DryRunCaseDiff]:
        return [c for c in self.case_diffs if c.verdict_changed]

    def to_dict(self):
        return {
            "summary": {
                "active_version": self.active_version,
                "draft_version": self.draft_version,
                "total_cases": self.total_cases,
                "verdict_changed_count": self.verdict_changed_count,
            },
            "verdict_changed_cases": [
                c.to_dict() for c in self.verdict_changed_cases
            ],
            "all_cases": [c.to_dict() for c in self.case_diffs],
        }

    def to_text(self) -> str:
        lines = [
            f"Dry-run: active={self.active_version} draft={self.draft_version}",
            f"Cases: {self.total_cases}  Verdict changes: {self.verdict_changed_count}",
        ]
        if not self.verdict_changed_cases:
            lines.append("No verdict changes detected.")
            return "\n".join(lines)
        lines.append("")
        lines.append("Verdict changes:")
        for case in self.verdict_changed_cases:
            lines.append(
                f"  {case.sample_id}: "
                f"{case.active_verdict.value} -> {case.draft_verdict.value}"
            )
            for change in case.field_changes:
                lines.append(
                    f"    {change.get('name')}: "
                    f"{change.get('active')!r} -> {change.get('draft')!r}"
                )
        return "\n".join(lines)


def diff_sample_results(
    active: SampleResult, draft: SampleResult
) -> DryRunCaseDiff:
    """Diff a single sample's active vs draft results, keyed by field name."""
    active_by_name = {f.field_name: f for f in active.field_evaluations}
    draft_by_name = {f.field_name: f for f in draft.field_evaluations}
    field_changes: List[Dict[str, Any]] = []
    for name in sorted(set(active_by_name) | set(draft_by_name)):
        a = active_by_name.get(name)
        d = draft_by_name.get(name)
        a_val = a.actual_value if a else None
        d_val = d.actual_value if d else None
        if a_val != d_val:
            field_changes.append(
                {"name": name, "active": a_val, "draft": d_val}
            )
    active_verdict = verdict_from_sample_result(active)
    draft_verdict = verdict_from_sample_result(draft)
    return DryRunCaseDiff(
        sample_id=active.sample_id,
        active_verdict=active_verdict,
        draft_verdict=draft_verdict,
        verdict_changed=active_verdict != draft_verdict,
        active_raw_text=active.raw_text,
        draft_raw_text=draft.raw_text,
        field_changes=field_changes,
    )


def build_dry_run_report(
    active_version: str,
    draft_version: str,
    active_results: List[SampleResult],
    draft_results: List[SampleResult],
) -> DryRunReport:
    """Build a dry-run report comparing active vs draft results by sample id."""
    draft_by_id = {r.sample_id: r for r in draft_results}
    case_diffs: List[DryRunCaseDiff] = []
    for active in active_results:
        draft = draft_by_id.get(active.sample_id)
        if draft is None:
            continue
        case_diffs.append(diff_sample_results(active, draft))
    return DryRunReport(
        active_version=active_version,
        draft_version=draft_version,
        total_cases=len(case_diffs),
        verdict_changed_count=sum(1 for c in case_diffs if c.verdict_changed),
        case_diffs=case_diffs,
    )
