"""Benchmark report rendering: markdown for humans, JSON for machines."""

from __future__ import annotations

from typing import Any

from omr.benchmark.metrics import ChartMetrics, Ratio
from omr.models import BackendInfo

_METRIC_ROWS: list[tuple[str, str]] = [
    ("measure_alignment", "Measure alignment"),
    ("pitch_strict", "Pitch (strict spelling)"),
    ("pitch_midi", "Pitch (MIDI)"),
    ("accidental", "Accidental spelling (of MIDI-matched)"),
    ("rhythm_exact", "Rhythm (onset+duration exact)"),
    ("onset_only", "Onset only"),
    ("duration_only", "Duration only"),
    ("chord_exact", "Chord exact symbol"),
    ("chord_root", "Chord root (enharmonic-strict)"),
    ("chord_quality", "Chord quality class"),
    ("chord_alterations", "Chord alterations (of root+quality matches)"),
]
_SCALAR_ROWS: list[tuple[str, str]] = [
    ("measure_count_error", "Measure count error"),
    ("chord_insertions", "Inserted chords"),
    ("key_signature_match", "Key signature match"),
    ("time_signature_match", "Time signature match"),
    ("repeat_f1", "Repeat events F1"),
    ("rehearsal_f1", "Rehearsal marks F1"),
]


def _fmt(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return "yes" if value else "NO"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def render_markdown(results: list[dict[str, Any]], backend: BackendInfo) -> str:
    lines: list[str] = []
    lines.append("# OMR benchmark report")
    lines.append("")
    model = f"{backend.model_id}@{backend.revision}" if backend.model_id else "(no model)"
    lines.append(
        f"Backend: **{backend.name}** · model `{model}` · device `{backend.device}` "
        f"· omr {backend.version}"
    )
    lines.append("")
    note = backend.details.get("note") if backend.details else None
    if note:
        lines.append(f"> {note}")
        lines.append("")

    for result in results:
        metrics: ChartMetrics = result["metrics"]
        lines.append(f"## {result['slug']}")
        lines.append("")
        if not result.get("reviewed", False):
            lines.append(
                "> ⚠️ Ground truth has **NOT been human-reviewed** against the printed "
                "page — treat these numbers as provisional."
            )
            lines.append("")
        lines.append("| Metric | Score | Count |")
        lines.append("|---|---|---|")
        for attr, label in _METRIC_ROWS:
            ratio: Ratio = getattr(metrics, attr)
            lines.append(f"| {label} | {_fmt(ratio.value)} | {ratio} |")
        for attr, label in _SCALAR_ROWS:
            lines.append(f"| {label} | {_fmt(getattr(metrics, attr))} | |")
        lines.append("")
        for extra in result.get("notes", []):
            lines.append(f"- {extra}")
        if result.get("notes"):
            lines.append("")

    lines.append("## Aggregate")
    lines.append("")
    lines.append("Unweighted macro-average across charts; `n/a` values excluded.")
    lines.append("")
    aggregate = _aggregate(results)
    lines.append("| Metric | Mean |")
    lines.append("|---|---|")
    for attr, label in _METRIC_ROWS + _SCALAR_ROWS:
        lines.append(f"| {label} | {_fmt(aggregate.get(attr))} |")
    lines.append("")
    return "\n".join(lines)


def render_json(results: list[dict[str, Any]], backend: BackendInfo) -> dict[str, Any]:
    return {
        "backend": backend.to_dict(),
        "charts": {
            result["slug"]: {
                **result["metrics"].to_dict(),
                "reviewed": result.get("reviewed", False),
                "notes": result.get("notes", []),
            }
            for result in results
        },
        "aggregate": _aggregate(results),
    }


def _aggregate(results: list[dict[str, Any]]) -> dict[str, float | None]:
    aggregate: dict[str, float | None] = {}
    for attr, _ in _METRIC_ROWS + _SCALAR_ROWS:
        values: list[float] = []
        for result in results:
            value = getattr(result["metrics"], attr)
            if isinstance(value, Ratio):
                value = value.value
            if isinstance(value, bool):
                value = 1.0 if value else 0.0
            if value is not None:
                values.append(float(value))
        aggregate[attr] = sum(values) / len(values) if values else None
    return aggregate
