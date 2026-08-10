"""Standalone CLI: evaluate OMR independently of the application.

    python -m omr transcribe path/to/leadsheet.pdf [--output x.json] [--raw] [--debug]

Exit codes: 0 success (warnings allowed), 2 bad input/arguments,
3 backend unavailable, 4 transcription failure.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import omr
from omr.backends import available_backends, get_backend
from omr.errors import BackendUnavailableError, CorruptedInputError, UnsupportedInputError
from omr.pipeline import transcribe_file

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # omr/


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="omr", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    t = sub.add_parser("transcribe", help="transcribe a lead-sheet PDF or image")
    t.add_argument("path", type=Path)
    t.add_argument("--backend", default="legato_v1", help="OMR backend name")
    t.add_argument("--output", type=Path, default=None, help="output JSON path")
    t.add_argument("--raw", action="store_true", help="print the verbatim raw transcription")
    t.add_argument("--debug", action="store_true", help="write a debug artifact directory")
    t.add_argument(
        "--debug-dir",
        type=Path,
        default=None,
        help=f"debug artifact root (default: {_PROJECT_ROOT / 'debug_runs'})",
    )
    t.add_argument("--device", default=None, help="inference device (auto/cpu/mps/cuda)")
    t.add_argument("--beams", type=int, default=None, help="beam size for generation")
    t.add_argument("--pages", default=None, help="1-based page selection, e.g. '1' or '1,3'")
    t.add_argument("--dpi", type=float, default=300.0, help="PDF render resolution")
    t.add_argument("--no-preprocess", action="store_true", help="skip conservative preprocessing")
    t.set_defaults(func=_cmd_transcribe)

    b = sub.add_parser("benchmark", help="run the lead-sheet benchmark against a backend")
    b.add_argument("--backend", default="legato_v1", help="OMR backend name")
    b.add_argument(
        "--gt-dir",
        type=Path,
        default=_PROJECT_ROOT / "tests" / "benchmark" / "ground_truth",
        help="directory of ground-truth JSON files",
    )
    b.add_argument("--charts", default=None, help="comma-separated slugs to run (default: all)")
    b.add_argument(
        "--repo-root",
        type=Path,
        default=_PROJECT_ROOT.parent,
        help="root that ground-truth source_pdf paths are relative to",
    )
    b.add_argument("--out", type=Path, default=None, help="results directory")
    b.add_argument("--device", default=None)
    b.add_argument("--beams", type=int, default=None)
    b.add_argument("--dpi", type=float, default=300.0)
    b.set_defaults(func=_cmd_benchmark)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


def _cmd_transcribe(args: argparse.Namespace) -> int:
    options: dict[str, object] = {}
    if args.device is not None:
        options["device"] = args.device
    if args.beams is not None:
        options["num_beams"] = args.beams

    try:
        backend = get_backend(args.backend, **options)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except TypeError as e:
        print(f"error: backend '{args.backend}' rejected options: {e}", file=sys.stderr)
        return 2

    info = backend.model_info()
    model = f"{info.model_id}@{info.revision}" if info.model_id else "(no released model)"
    print(
        f"omr {omr.__version__} · backend={info.name} · model={model} · device={info.device}",
        file=sys.stderr,
    )

    pages = None
    if args.pages:
        try:
            pages = [int(p) for p in str(args.pages).split(",")]
        except ValueError:
            print(f"error: --pages must be 1-based integers, got '{args.pages}'", file=sys.stderr)
            return 2

    debug_dir = None
    if args.debug:
        root = args.debug_dir or (_PROJECT_ROOT / "debug_runs")
        stamp = time.strftime("%Y%m%d-%H%M%S")
        debug_dir = root / f"{args.path.stem}-{stamp}"

    try:
        bundle = transcribe_file(
            args.path,
            backend,
            dpi=args.dpi,
            preprocess=not args.no_preprocess,
            pages=pages,
            debug_dir=debug_dir,
        )
    except (UnsupportedInputError, CorruptedInputError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except BackendUnavailableError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    except Exception as e:  # noqa: BLE001 — CLI boundary: report, don't crash
        print(f"error: transcription failed: {e}", file=sys.stderr)
        return 4

    output = args.output or Path.cwd() / f"{args.path.stem}.omr.json"
    payload = {
        "omr_version": omr.__version__,
        "backend": bundle.result.backend.to_dict(),
        "result": bundle.result.to_dict(),
        "normalized": bundle.normalized.to_dict(),
        "validation_warnings": [w.to_dict() for w in bundle.validation_warnings],
    }
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False))

    if args.raw:
        print(bundle.result.raw_transcription)

    warning_count = len(bundle.result.warnings) + len(bundle.normalized.warnings) + len(
        bundle.validation_warnings
    )
    print(
        f"{len(bundle.source.pages)} page(s) · {warning_count} warning(s) · wrote {output}",
        file=sys.stderr,
    )
    if debug_dir is not None:
        print(f"debug artifacts: {debug_dir}", file=sys.stderr)
    return 0


def _cmd_benchmark(args: argparse.Namespace) -> int:
    options: dict[str, object] = {}
    if args.device is not None:
        options["device"] = args.device
    if args.beams is not None:
        options["num_beams"] = args.beams

    try:
        backend = get_backend(args.backend, **options)
    except (ValueError, TypeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    gt_paths = sorted(args.gt_dir.glob("*.json")) if args.gt_dir.is_dir() else []
    if args.charts:
        wanted = {slug.strip() for slug in args.charts.split(",")}
        gt_paths = [p for p in gt_paths if p.stem in wanted]
    if not gt_paths:
        print(f"error: no ground truth found in {args.gt_dir}", file=sys.stderr)
        return 2

    info = backend.model_info()
    model = f"{info.model_id}@{info.revision}" if info.model_id else "(no released model)"
    print(
        f"omr {omr.__version__} · backend={info.name} · model={model} · device={info.device}",
        file=sys.stderr,
    )

    out_dir = args.out or (
        _PROJECT_ROOT / "benchmark_results" / time.strftime("%Y%m%d-%H%M%S")
    )

    from omr.benchmark.runner import run_benchmark

    try:
        outcome = run_benchmark(
            backend, gt_paths, repo_root=args.repo_root, out_dir=out_dir, dpi=args.dpi
        )
    except BackendUnavailableError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 — CLI boundary: report, don't crash
        print(f"error: benchmark failed: {e}", file=sys.stderr)
        return 4

    aggregate = outcome["aggregate"]
    for key in ("pitch_strict", "pitch_midi", "rhythm_exact", "chord_exact"):
        value = aggregate.get(key)
        print(f"  {key}: {value:.3f}" if value is not None else f"  {key}: n/a", file=sys.stderr)
    print(f"report: {outcome['report_md']}", file=sys.stderr)
    return 0


def _available() -> str:
    return ", ".join(available_backends())
