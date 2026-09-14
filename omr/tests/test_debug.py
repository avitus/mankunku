"""Debug artifact tests: every layer traceable, nothing fabricated."""

import json
from pathlib import Path

from conftest import FakeBackend
from PIL import Image

from omr.models import OMRResult, ScoreInput, normalized_score_from_dict
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


class _SegmentingBackend(FakeBackend):
    """Claims system segmentation; ships crops only when given some."""

    def __init__(self, crops: list[tuple[str, Image.Image]]) -> None:
        super().__init__()
        self._crops = crops

    def supports_system_segmentation(self) -> bool:
        return True

    def transcribe(self, source: ScoreInput) -> OMRResult:
        result = super().transcribe(source)
        if self._crops:
            result.metadata["system_images"] = self._crops
        return result


def test_system_crops_are_written_only_from_real_segmentation_output(
    png_score: Path, tmp_path: Path
) -> None:
    # Claiming segmentation is not enough: crops are written only when the
    # backend actually put images in its result — nothing is fabricated.
    with_crops = tmp_path / "with"
    crop = ("system-001.png", Image.new("L", (10, 10), 255))
    transcribe_file(png_score, _SegmentingBackend([crop]), debug_dir=with_crops)
    assert (with_crops / "systems" / "system-001.png").exists()

    without = tmp_path / "without"
    transcribe_file(png_score, _SegmentingBackend([]), debug_dir=without)
    assert not (without / "systems").exists()


def test_normalized_and_validation_artifacts_round_trip(png_score: Path, tmp_path: Path) -> None:
    debug_dir = tmp_path / "run-006"
    bad_abc = "X:1\nM:4/4\nL:1/4\nK:C\nCDEF | GAB |]\n"
    bundle = transcribe_file(png_score, FakeBackend(abc=bad_abc), debug_dir=debug_dir)

    normalized = json.loads((debug_dir / "normalized.json").read_text(encoding="utf-8"))
    assert normalized_score_from_dict(normalized) == bundle.normalized
    validation = json.loads((debug_dir / "validation.json").read_text(encoding="utf-8"))
    assert validation == [w.to_dict() for w in bundle.validation_warnings]
    assert [w["code"] for w in validation] == ["MEASURE_DURATION_MISMATCH"]
