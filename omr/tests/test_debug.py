"""Debug artifact tests: every layer traceable, nothing fabricated."""

import json
from pathlib import Path

from conftest import FakeBackend

from omr.pipeline import transcribe_file


def test_debug_dir_contents(png_score: Path, tmp_path: Path, fake_backend: FakeBackend) -> None:
    debug_dir = tmp_path / "run-001"
    transcribe_file(png_score, fake_backend, debug_dir=debug_dir)

    assert (debug_dir / "source.png").exists()
    assert (debug_dir / "pages" / "page-001.png").exists()
    assert (debug_dir / "raw" / "page-001.abc").exists()
    assert (debug_dir / "raw" / "full.abc").exists()
    assert (debug_dir / "normalized.json").exists()
    assert (debug_dir / "validation.json").exists()
    assert (debug_dir / "run.json").exists()


def test_no_fake_system_crops_for_whole_page_backend(
    png_score: Path, tmp_path: Path, fake_backend: FakeBackend
) -> None:
    debug_dir = tmp_path / "run-002"
    transcribe_file(png_score, fake_backend, debug_dir=debug_dir)

    # FakeBackend (like LEGATO v1) does whole-page recognition: a systems/
    # directory here would be fabricated evidence.
    assert not (debug_dir / "systems").exists()


def test_raw_artifact_is_verbatim(
    png_score: Path, tmp_path: Path, fake_backend: FakeBackend
) -> None:
    debug_dir = tmp_path / "run-003"
    bundle = transcribe_file(png_score, fake_backend, debug_dir=debug_dir)

    assert (debug_dir / "raw" / "full.abc").read_text() == bundle.result.raw_transcription


def test_run_json_identifies_backend(
    png_score: Path, tmp_path: Path, fake_backend: FakeBackend
) -> None:
    debug_dir = tmp_path / "run-004"
    transcribe_file(png_score, fake_backend, debug_dir=debug_dir)

    run = json.loads((debug_dir / "run.json").read_text())
    assert run["backend"]["name"] == "fake"
    assert run["backend"]["model_id"] == "fake/model"
    assert "timings" in run


def test_multipage_debug_pages(pdf_score: Path, tmp_path: Path, fake_backend: FakeBackend) -> None:
    debug_dir = tmp_path / "run-005"
    transcribe_file(pdf_score, fake_backend, debug_dir=debug_dir)

    assert (debug_dir / "source.pdf").exists()
    assert (debug_dir / "pages" / "page-001.png").exists()
    assert (debug_dir / "pages" / "page-002.png").exists()
    assert (debug_dir / "raw" / "page-002.abc").exists()
