"""Pipeline tests: source image, raw output, and normalized rep all reachable."""

from pathlib import Path

import pytest
from conftest import FAKE_ABC, FakeBackend

from omr.models import BackendInfo, OMRResult, ScoreInput
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


def test_page_selection_keeps_only_the_requested_source_pages(
    pdf_score: Path, fake_backend: FakeBackend
) -> None:
    bundle = transcribe_file(pdf_score, fake_backend, pages=[2])

    assert [p.source_page for p in bundle.source.pages] == [1]
    assert len(bundle.result.raw_pages) == 1


def test_preprocess_flag_controls_page_preprocessing(
    png_score: Path, fake_backend: FakeBackend
) -> None:
    # The fixture is 200x150: preprocessing upscales it to the 1200 px floor.
    assert min(transcribe_file(png_score, fake_backend).source.pages[0].image.size) >= 1200
    untouched = transcribe_file(png_score, fake_backend, preprocess=False)
    assert untouched.source.pages[0].image.size == (200, 150)


class _CappedBackend(FakeBackend):
    """Declares its own output cap and reports a token count on every page."""

    def __init__(self, max_length: int | None) -> None:
        super().__init__()
        self._max_length = max_length

    def model_info(self) -> BackendInfo:
        info = super().model_info()
        if self._max_length is not None:
            info.details["max_length"] = self._max_length
        return info

    def transcribe(self, source: ScoreInput) -> OMRResult:
        result = super().transcribe(source)
        for page in result.raw_pages:
            page.token_count = 100
        return result


def test_generation_limit_comes_from_the_backend_details(png_score: Path) -> None:
    # Validation judges truncation against the cap the backend declares in
    # model_info().details, not against LEGATO's 2048 default.
    capped = transcribe_file(png_score, _CappedBackend(max_length=100))
    assert any(w.code == "POSSIBLE_TRUNCATION" for w in capped.validation_warnings)

    default = transcribe_file(png_score, _CappedBackend(max_length=None))
    assert not any(w.code == "POSSIBLE_TRUNCATION" for w in default.validation_warnings)
