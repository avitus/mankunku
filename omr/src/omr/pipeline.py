"""End-to-end transcription: load -> preprocess -> backend -> normalize -> validate.

The bundle keeps every layer reachable — original source, verbatim raw
output, normalized representation, validation warnings — so a recognition
error is traceable from the normalized note back to the pixels.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from omr.abc_parser import parse_abc
from omr.backends.base import OMRBackend
from omr.ingest import load_score
from omr.models import NormalizedScore, OMRResult, OMRWarning, ScoreInput
from omr.normalize import normalize
from omr.preprocessing import preprocess_page
from omr.validation import validate


@dataclass
class TranscriptionBundle:
    source: ScoreInput
    result: OMRResult
    normalized: NormalizedScore
    validation_warnings: list[OMRWarning]


def transcribe_file(
    path: Path,
    backend: OMRBackend,
    *,
    dpi: float = 300.0,
    preprocess: bool = True,
    pages: list[int] | None = None,
    debug_dir: Path | None = None,
) -> TranscriptionBundle:
    timings: dict[str, float] = {}

    start = time.monotonic()
    source = load_score(Path(path), dpi=dpi)
    if pages:
        wanted = set(pages)  # 1-based page numbers
        kept = tuple(p for p in source.pages if p.source_page + 1 in wanted)
        source = ScoreInput(path=source.path, kind=source.kind, pages=kept)
    if preprocess:
        source = ScoreInput(
            path=source.path,
            kind=source.kind,
            pages=tuple(preprocess_page(p) for p in source.pages),
        )
    timings["load_s"] = time.monotonic() - start

    start = time.monotonic()
    result = backend.transcribe(source)
    timings["transcribe_s"] = time.monotonic() - start

    start = time.monotonic()
    abc_score, parse_warnings = parse_abc(result.raw_transcription)
    normalized = normalize(abc_score, parse_warnings)
    generation_limit = int(result.backend.details.get("max_length", 2048))
    validation_warnings = validate(normalized, result, generation_limit=generation_limit)
    timings["normalize_s"] = time.monotonic() - start

    bundle = TranscriptionBundle(
        source=source,
        result=result,
        normalized=normalized,
        validation_warnings=validation_warnings,
    )

    if debug_dir is not None:
        from omr.debug import write_debug_artifacts

        write_debug_artifacts(Path(debug_dir), bundle, backend, timings)

    return bundle
