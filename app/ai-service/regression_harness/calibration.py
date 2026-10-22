"""Confidence calibration reporting for the golden-set accuracy harness.

Verification and fraud responses report a *confidence* (or score) alongside
their decision, but a confidence of 0.9 is only useful if the prediction is
actually right about 90% of the time. This module turns the harness outcomes
into a calibration report: it buckets each prediction by the confidence the
service reported for its verdict and compares the band's mean stated
confidence against the band's measured accuracy.

A band whose accuracy sits far from its stated confidence is *miscalibrated*
(e.g. claiming ~0.9 confidence but only being correct half the time). Bands
that drift past ``DEFAULT_TOLERANCE`` are actively **flagged** rather than
silently tabulated, so a regression in the service's self-assessment shows up
next to the accuracy metrics instead of hiding in a raw per-case table.

The report is rendered as Markdown by :func:`render_calibration_markdown` and
committed alongside ``reports/fraud_threshold_calibration.md`` so the numbers
in the document are always backed by a real harness run.
"""

import os
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

#: ``(label, low, high)`` bands. Bounds are half-open ``[low, high)`` except
#: the last band, which also includes its upper bound so a confidence of
#: exactly 1.0 is bucketed rather than dropped.
DEFAULT_BANDS: Sequence[Tuple[str, float, float]] = (
    ("low (0.00-0.50)", 0.0, 0.5),
    ("medium (0.50-0.70)", 0.5, 0.7),
    ("high (0.70-0.90)", 0.7, 0.9),
    ("very high (0.90-1.00)", 0.9, 1.0),
)

#: A band is flagged when ``abs(mean_confidence - accuracy)`` exceeds this.
DEFAULT_TOLERANCE = 0.2

#: Label used for outcomes that carry no usable confidence value.
UNSCORED = "unscored"

_HARNESS_DIR = os.path.dirname(os.path.abspath(__file__))
_AI_SERVICE_DIR = os.path.dirname(_HARNESS_DIR)
_REPO_ROOT = os.path.dirname(os.path.dirname(_AI_SERVICE_DIR))

#: Default committed location of the generated reference report.
DEFAULT_CALIBRATION_REPORT = os.path.join(
    _REPO_ROOT, "reports", "confidence_calibration.md"
)

#: Default committed location of the rolling-window outcome feedback report.
DEFAULT_OUTCOME_REPORT = os.path.join(
    _REPO_ROOT, "reports", "fraud_outcome_feedback.md"
)


def _is_confidence(value: Any) -> bool:
    """Return True when ``value`` is a real confidence in the closed [0, 1]."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return 0.0 <= float(value) <= 1.0



def _band_for(confidence: float, bands: Sequence[Tuple[str, float, float]]) -> str:
    """Return the band label that ``confidence`` falls into."""
    last = len(bands) - 1
    for idx, (label, low, high) in enumerate(bands):
        if confidence >= low and (confidence < high or idx == last):
            return label
    # Confidence values above the top bound (e.g. a misreported 1.5) clamp to
    # the highest band rather than being silently dropped.
    return bands[last][0]



def compute_calibration(
    outcomes: Sequence[Dict[str, Any]],
    bands: Sequence[Tuple[str, float, float]] = DEFAULT_BANDS,
    tolerance: float = DEFAULT_TOLERANCE,
) -> Dict[str, Any]:
    """Bucket outcomes by confidence band and measure accuracy per band.

    Args:
        outcomes: Harness outcomes, each with ``confidence`` (float or None)
            and ``correct`` (bool).
        bands: ``(label, low, high)`` confidence bands.
        tolerance: Absolute gap between a band's mean stated confidence and
            its accuracy beyond which the band is flagged as miscalibrated.

    Returns:
        A JSON-serialisable dict describing every band, the aggregate
        calibration error, and the list of flagged (miscalibrated) bands.
    """
    buckets: Dict[str, Dict[str, Any]] = {
        label: {"count": 0, "correct": 0, "confidence_sum": 0.0}
        for label, _, _ in bands
    }
    unscored: Dict[str, Any] = {"count": 0, "correct": 0, "ids": []}
    scored_total = 0

    for outcome in outcomes:
        correct = bool(outcome.get("correct"))
        confidence = outcome.get("confidence")
        if not _is_confidence(confidence):
            unscored["count"] += 1
            unscored["correct"] += 1 if correct else 0
            if outcome.get("id") is not None:
                unscored["ids"].append(outcome["id"])
            continue
        bucket = buckets[_band_for(float(confidence), bands)]
        bucket["count"] += 1
        bucket["correct"] += 1 if correct else 0
        bucket["confidence_sum"] += float(confidence)
        scored_total += 1

    band_reports: List[Dict[str, Any]] = []
    flagged: List[Dict[str, Any]] = []
    weighted_error = 0.0
    max_error = 0.0

    for label, low, high in bands:
        bucket = buckets[label]
        count = bucket["count"]
        accuracy = round(bucket["correct"] / count, 4) if count else 0.0
        mean_confidence = round(bucket["confidence_sum"] / count, 4) if count else 0.0
        gap = round(mean_confidence - accuracy, 4)
        if count == 0:
            status = "empty"
        elif abs(gap) > tolerance:
            status = "miscalibrated"
        else:
            status = "ok"
        band_report = {
            "band": label,
            "low": low,
            "high": high,
            "count": count,
            "correct": bucket["correct"],
            "accuracy": accuracy,
            "mean_confidence": mean_confidence,
            "gap": gap,
            "status": status,
        }
        band_reports.append(band_report)
        if count:
            weighted_error += count * abs(gap)
            max_error = max(max_error, abs(gap))
        if status == "miscalibrated":
            flagged.append(
                {
                    "band": label,
                    "count": count,
                    "accuracy": accuracy,
                    "mean_confidence": mean_confidence,
                    "gap": gap,
                    "direction": ("overconfident" if gap > 0 else "underconfident"),
                }
            )

    unscored_accuracy = (
        round(unscored["correct"] / unscored["count"], 4) if unscored["count"] else 0.0
    )
    unscored["accuracy"] = unscored_accuracy

    return {
        "tolerance": tolerance,
        "total_cases": len(outcomes),
        "scored_cases": scored_total,
        "expected_calibration_error": (
            round(weighted_error / scored_total, 4) if scored_total else 0.0
        ),
        "max_calibration_error": round(max_error, 4),
        "is_calibrated": not flagged,
        "flagged_bands": flagged,
        "bands": band_reports,
        "unscored": unscored,
    }


def _signed(value: float) -> str:
    """Format a gap with an explicit sign so direction is obvious."""
    return f"{value:+.4f}"


def render_calibration_markdown(
    calibration: Dict[str, Any],
    *,
    generated_at: str,
    fixture_count: Optional[int] = None,
    overall_accuracy: Optional[float] = None,
) -> str:
    """Render a calibration report as the committed reference Markdown."""
    lines: List[str] = [
        "# Confidence Calibration Report",
        "",
        "Generated by `regression_harness/run_accuracy_harness.py` — do not "
        "edit by hand; re-run the harness and commit the regenerated file.",
        "",
        f"Generated at: `{generated_at}`",
        f"Confidence bands: {len(calibration['bands'])} | "
        f"Miscalibration tolerance: {calibration['tolerance']}",
    ]
    if fixture_count is not None:
        lines.append(f"Golden fixture cases: {fixture_count}")
    if overall_accuracy is not None:
        lines.append(f"Overall accuracy: {overall_accuracy:.4f}")
    lines += [
        "",
        "## Band calibration",
        "",
        "| Band | Cases | Correct | Accuracy | Mean stated confidence | Gap | Status |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for band in calibration["bands"]:
        lines.append(
            f"| {band['band']} | {band['count']} | {band['correct']} | "
            f"{band['accuracy']:.4f} | {band['mean_confidence']:.4f} | "
            f"{_signed(band['gap'])} | {band['status']} |"
        )

    lines += [
        "",
        "The **gap** is mean stated confidence minus measured accuracy. A "
        "positive gap means the service was overconfident in that band; a "
        "negative gap means it was underconfident.",
        "",
        f"- Expected calibration error (case-weighted): "
        f"`{calibration['expected_calibration_error']:.4f}`",
        f"- Max band calibration error: "
        f"`{calibration['max_calibration_error']:.4f}`",
        f"- Calibrated: **{'yes' if calibration['is_calibrated'] else 'no'}**",
        "",
    ]

    flagged = calibration.get("flagged_bands", [])
    lines.append("## Miscalibration flags")
    lines.append("")
    if flagged:
        lines.append(
            "The following bands have an accuracy that is more than "
            f"`{calibration['tolerance']}` away from their stated confidence:"
        )
        lines.append("")
        lines.append(
            "| Band | Cases | Accuracy | Mean stated confidence | Gap | Direction |"
        )
        lines.append("| --- | ---: | ---: | ---: | ---: | --- |")
        for flag in flagged:
            lines.append(
                f"| {flag['band']} | {flag['count']} | {flag['accuracy']:.4f} | "
                f"{flag['mean_confidence']:.4f} | {_signed(flag['gap'])} | "
                f"{flag['direction']} |"
            )
    else:
        lines.append(
            "No band exceeds the miscalibration tolerance — stated confidence "
            "tracks measured accuracy."
        )

    unscored = calibration.get("unscored", {})
    if unscored.get("count"):
        lines += [
            "",
            "## Unscored cases",
            "",
            f"{unscored['count']} case(s) carried no usable confidence value "
            f"(accuracy `{unscored['accuracy']:.4f}`): "
            + ", ".join(f"`{case_id}`" for case_id in unscored.get("ids", [])),
        ]

    lines += [
        "",
        "## Notes",
        "",
        "- Confidence here is the value the verification service reports for "
        "its predicted verdict, measured against the human-annotated golden "
        'label; the report therefore answers "when the service says 0.9, is '
        'it right roughly 90% of the time?"',
        "- The deterministic fixture provider always runs offline, so the "
        "report is fully reproducible.",
        "- Re-run the harness (or the scheduled `.github/workflows/ai-regression.yml` "
        "job) after any change to the verification logic or golden set, and commit "
        "the updated report alongside the change.",
        "",
    ]
    return "\n".join(lines)



def write_calibration_report(
    calibration: Dict[str, Any],
    output_path: str = DEFAULT_CALIBRATION_REPORT,
    *,
    generated_at: str,
    fixture_count: Optional[int] = None,
    overall_accuracy: Optional[float] = None,
) -> str:
    """Write the Markdown reference report and return the path written."""
    markdown = render_calibration_markdown(
        calibration,
        generated_at=generated_at,
        fixture_count=fixture_count,
        overall_accuracy=overall_accuracy,
    )
    directory = os.path.dirname(os.path.abspath(output_path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(output_path, "w") as handle:
        handle.write(markdown)
    return output_path


#: Reviewer decisions that count as a "flagged" outcome for feedback purposes.
FLAGGED_BANDS: Sequence[str] = ("review", "reject")

#: Reviewer decisions that are considered a positive (fraud) outcome.
POSITIVE_OUTCOMES: Sequence[str] = ("reject", "confirmed_fraud")


def record_reviewer_feedback(
    *,
    claim_id: str,
    decision_audit_id: str,
    predicted_band: str,
    fraud_score: float,
    reviewer_decision: str,
    reviewer_id: Optional[str] = None,
    decided_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Capture a reviewer's final decision on a flagged claim.

    The returned record deliberately does **not** embed any claim content
    (narrative, amounts, parties, etc.). It references the existing decision
    audit entry via ``decision_audit_id`` so sensitive data stays in the
    audit trail and is not duplicated into the feedback store.

    Args:
        claim_id: Identifier of the scored claim.
        decision_audit_id: Identifier of the existing decision audit entry
            that holds the sensitive claim content.
        predicted_band: The band the fraud service assigned (``pass``,
            ``review``, or ``reject``).
        fraud_score: The fraud score reported by the service.
        reviewer_decision: The reviewer's final decision (e.g. ``approve``,
            ``reject``, ``confirmed_fraud``, ``false_positive``).
        reviewer_id: Optional reviewer identifier.
        decided_at: Optional ISO-8601 timestamp of the decision.

    Returns:
        A JSON-serialisable feedback record linking the decision back to the
        original score and band.
    """
    if not decision_audit_id:
        raise ValueError("decision_audit_id is required to link feedback")
    return {
        "claim_id": claim_id,
        "decision_audit_id": decision_audit_id,
        "predicted_band": predicted_band,
        "fraud_score": float(fraud_score),
        "reviewer_decision": reviewer_decision,
        "reviewer_id": reviewer_id,
        "decided_at": decided_at,
        "is_positive": reviewer_decision in POSITIVE_OUTCOMES,
    }


def _outcome_correct(predicted_band: str, reviewer_decision: str) -> bool:
    """Return True when the predicted band agrees with the actual outcome."""
    if predicted_band in FLAGGED_BANDS:
        return reviewer_decision in POSITIVE_OUTCOMES
    # ``pass`` band predicted no fraud; correct when the reviewer agreed.
    return reviewer_decision not in POSITIVE_OUTCOMES


def compute_outcome_feedback(
    feedback_records: Sequence[Dict[str, Any]],
    bands: Sequence[Tuple[str, float, float]] = DEFAULT_BANDS,
    tolerance: float = DEFAULT_TOLERANCE,
) -> Dict[str, Any]:
    """Compare predicted bands against actual reviewer outcomes.

    This is distinct from :func:`compute_calibration`: that report measures
    stated confidence against the static golden fixture set, whereas this
    report measures predicted *bands* against real-world reviewer decisions
    over a rolling window of feedback records.

    Args:
        feedback_records: Records produced by
            :func:`record_reviewer_feedback`.
        bands: Confidence bands used to bucket by fraud score.
        tolerance: Gap beyond which a band is flagged as miscalibrated.

    Returns:
        A JSON-serialisable dict describing per-band agreement between the
        predicted band and the reviewer's actual decision.
    """
    buckets: Dict[str, Dict[str, Any]] = {
        label: {"count": 0, "correct": 0, "score_sum": 0.0}
        for label, _, _ in bands
    }
    band_agreement: Dict[str, Dict[str, int]] = {}
    total = 0
    correct_total = 0

    for record in feedback_records:
        predicted_band = record.get("predicted_band")
        reviewer_decision = record.get("reviewer_decision")
        score = record.get("fraud_score")
        if predicted_band is None or reviewer_decision is None:
            continue
        total += 1
        correct = _outcome_correct(predicted_band, reviewer_decision)
        correct_total += 1 if correct else 0
        agreement = band_agreement.setdefault(
            predicted_band, {"count": 0, "correct": 0}
        )
        agreement["count"] += 1
        agreement["correct"] += 1 if correct else 0
        if _is_confidence(score):
            bucket = buckets[_band_for(float(score), bands)]
            bucket["count"] += 1
            bucket["correct"] += 1 if correct else 0
            bucket["score_sum"] += float(score)

    band_reports: List[Dict[str, Any]] = []
    flagged: List[Dict[str, Any]] = []
    for label, low, high in bands:
        bucket = buckets[label]
        count = bucket["count"]
        accuracy = round(bucket["correct"] / count, 4) if count else 0.0
        mean_score = round(bucket["score_sum"] / count, 4) if count else 0.0
        gap = round(mean_score - accuracy, 4)
        if count == 0:
            status = "empty"
        elif abs(gap) > tolerance:
            status = "miscalibrated"
        else:
            status = "ok"
        band_reports.append(
            {
                "band": label,
                "low": low,
                "high": high,
                "count": count,
                "correct": bucket["correct"],
                "accuracy": accuracy,
                "mean_score": mean_score,
                "gap": gap,
                "status": status,
            }
        )
        if status == "miscalibrated":
            flagged.append(
                {
                    "band": label,
                    "count": count,
                    "accuracy": accuracy,
                    "mean_score": mean_score,
                    "gap": gap,
                    "direction": ("overconfident" if gap > 0 else "underconfident"),
                }
            )

    predicted_band_reports: List[Dict[str, Any]] = []
    for predicted_band, agreement in sorted(band_agreement.items()):
        count = agreement["count"]
        predicted_band_reports.append(
            {
                "predicted_band": predicted_band,
                "count": count,
                "correct": agreement["correct"],
                "accuracy": round(agreement["correct"] / count, 4) if count else 0.0,
            }
        )

    return {
        "tolerance": tolerance,
        "total_feedback": total,
        "overall_accuracy": round(correct_total / total, 4) if total else 0.0,
        "is_calibrated": not flagged,
        "flagged_bands": flagged,
        "bands": band_reports,
        "predicted_bands": predicted_band_reports,
    }


def render_outcome_feedback_markdown(
    feedback: Dict[str, Any],
    *,
    generated_at: str,
    window_days: Optional[int] = None,
) -> str:
    """Render the rolling-window outcome feedback report as Markdown."""
    lines: List[str] = [
        "# Fraud Outcome Feedback Report",
        "",
        "Generated from reviewer decisions on flagged claims — do not edit by "
        "hand; re-run the feedback report and commit the regenerated file.",
        "",
        f"Generated at: `{generated_at}`",
        f"Miscalibration tolerance: {feedback['tolerance']}",
    ]
    if window_days is not None:
        lines.append(f"Rolling window: {window_days} day(s)")
    lines += [
        f"Feedback records: {feedback['total_feedback']}",
        f"Overall band accuracy: {feedback['overall_accuracy']:.4f}",
        "",
        "## Band agreement",
        "",
        "| Band | Cases | Correct | Accuracy | Mean fraud score | Gap | Status |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for band in feedback["bands"]:
        lines.append(
            f"| {band['band']} | {band['count']} | {band['correct']} | "
            f"{band['accuracy']:.4f} | {band['mean_score']:.4f} | "
            f"{_signed(band['gap'])} | {band['status']} |"
        )

    lines += [
        "",
        "## Predicted band vs. actual outcome",
        "",
        "| Predicted band | Cases | Correct | Accuracy |",
        "| --- | ---: | ---: | ---: |",
    ]
    for predicted in feedback["predicted_bands"]:
        lines.append(
            f"| {predicted['predicted_band']} | {predicted['count']} | "
            f"{predicted['correct']} | {predicted['accuracy']:.4f} |"
        )

    flagged = feedback.get("flagged_bands", [])
    lines += ["", "## Miscalibration flags", ""]
    if flagged:
        lines.append(
            "The following score bands disagree with actual reviewer outcomes "
            f"by more than `{feedback['tolerance']}`:"
        )
        lines.append("")
        lines.append(
            "| Band | Cases | Accuracy | Mean fraud score | Gap | Direction |"
        )
        lines.append("| --- | ---: | ---: | ---: | ---: | --- |")
        for flag in flagged:
            lines.append(
                f"| {flag['band']} | {flag['count']} | {flag['accuracy']:.4f} | "
                f"{flag['mean_score']:.4f} | {_signed(flag['gap'])} | "
                f"{flag['direction']} |"
            )
    else:
        lines.append(
            "No band exceeds the miscalibration tolerance — predicted bands "
            "track actual reviewer outcomes."
        )

    lines += [
        "",
        "## Notes",
        "",
        "- Feedback records reference the existing decision audit entry via "
        "`decision_audit_id`; sensitive claim content is not duplicated here.",
        "- This report is distinct from `confidence_calibration.md`, which is "
        "computed against the static golden fixture set.",
        "",
    ]
    return "\n".join(lines)


def write_outcome_feedback_report(
    feedback: Dict[str, Any],
    output_path: str = DEFAULT_OUTCOME_REPORT,
    *,
    generated_at: str,
    window_days: Optional[int] = None,
) -> str:
    """Write the Markdown outcome feedback report and return the path."""
    markdown = render_outcome_feedback_markdown(
        feedback,
        generated_at=generated_at,
        window_days=window_days,
    )
    directory = os.path.dirname(os.path.abspath(output_path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(output_path, "w") as handle:
        handle.write(markdown)
    return output_path


def load_feedback_records(path: str) -> List[Dict[str, Any]]:
    """Load reviewer feedback records from a JSON-lines file."""
    records: List[Dict[str, Any]] = []
    with open(path, "r") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records
