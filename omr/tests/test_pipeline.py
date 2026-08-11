"""Pipeline tests: source image, raw output, and normalized rep all reachable."""

from pathlib import Path

import pytest
from conftest import FAKE_ABC, FakeBackend

from omr.pipeline import transcribe_file


def test_bundle_keeps_all_three_layers(png_score: Path, fake_backend: FakeBackend) -> None:
    bundle = transcribe_file(png_score, fake_backend)

    # 1. original source
    assert bundle.source.path == png_score
    assert bundle.source.pages[0].image.size[0] > 0
    # 2. raw output, verbatim
    assert bundle.result.raw_transcription == FAKE_ABC
    # 3. normalized representation
    assert bundle.normalized.title == "Fake Tune"
    assert [c.raw for c in bundle.normalized.measures[0].chords] == ["C"]
    assert bundle.normalized.measures[1].chords[0].raw == "G7"


def test_pipeline_runs_validation(png_score: Path) -> None:
    # 3 beats declared in a 4/4 measure -> deterministic duration warning
    bad_abc = "X:1\nM:4/4\nL:1/4\nK:C\nCDEF | GAB | CDEF |]\n"
    bundle = transcribe_file(png_score, FakeBackend(abc=bad_abc))

    assert any(w.code == "MEASURE_DURATION_MISMATCH" for w in bundle.validation_warnings)


def test_pipeline_multipage_pdf(pdf_score: Path, fake_backend: FakeBackend) -> None:
    bundle = transcribe_file(pdf_score, fake_backend)

    assert bundle.source.kind == "pdf"
    assert len(bundle.source.pages) == 2
    assert len(bundle.result.raw_pages) == 2


def test_backend_failure_propagates(png_score: Path) -> None:
    with pytest.raises(RuntimeError, match="fake backend failure"):
        transcribe_file(png_score, FakeBackend(fail=True))
