"""Benchmark runner: transcribe each ground-truth chart, score, report."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from omr.backends.base import OMRBackend
from omr.benchmark.ground_truth import load_ground_truth
from omr.benchmark.metrics import evaluate_chart
from omr.benchmark.report import render_json, render_markdown
from omr.pipeline import transcribe_file


def run_benchmark(
    backend: OMRBackend,
    ground_truth_paths: list[Path],
    *,
    repo_root: Path,
    out_dir: Path,
    dpi: float = 300.0,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    # Slugs key both the report's chart map and the artifact filenames — a
    # duplicate would silently overwrite an earlier chart's results.
    loaded = [load_ground_truth(p) for p in ground_truth_paths]
    seen: dict[str, int] = {}
    for gt in loaded:
        seen[gt.slug] = seen.get(gt.slug, 0) + 1
    duplicates = sorted(slug for slug, n in seen.items() if n > 1)
    if duplicates:
        raise ValueError(f"duplicate ground-truth slug(s): {', '.join(duplicates)}")

    for gt in loaded:
        pdf_path = repo_root / gt.source_pdf
        if not pdf_path.exists():
            raise FileNotFoundError(f"{gt.slug}: source PDF not found at {pdf_path}")

        bundle = transcribe_file(pdf_path, backend, dpi=dpi)
        metrics = evaluate_chart(
            gt.measures,
            bundle.normalized.measures,
            gt_key=gt.key_signature,
            pred_key=bundle.normalized.key_signature,
            gt_ts=gt.time_signature,
            pred_ts=bundle.normalized.time_signature,
        )

        notes = [
            f"{len(bundle.result.warnings)} backend warning(s), "
            f"{len(bundle.normalized.warnings)} parse warning(s), "
            f"{len(bundle.validation_warnings)} validation warning(s)"
        ]
        for warning in bundle.result.warnings:
            if warning.code == "TEXT_ELIDED_BY_MODEL":
                notes.append(
                    "chord metrics reflect a model limitation: this backend does not "
                    "transcribe text, so chord symbols cannot appear in its output"
                )
                break

        (out_dir / f"{gt.slug}.normalized.json").write_text(
            json.dumps(bundle.normalized.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        (out_dir / f"{gt.slug}.raw.abc").write_text(
            bundle.result.raw_transcription, encoding="utf-8"
        )

        results.append(
            {"slug": gt.slug, "reviewed": gt.reviewed, "metrics": metrics, "notes": notes}
        )

    backend_info = backend.model_info()
    report_md = render_markdown(results, backend_info)
    report_json = render_json(results, backend_info)
    (out_dir / "report.md").write_text(report_md, encoding="utf-8")
    (out_dir / "report.json").write_text(
        json.dumps(report_json, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "results": results,
        "aggregate": report_json["aggregate"],
        "report_md": out_dir / "report.md",
        "report_json": out_dir / "report.json",
    }
