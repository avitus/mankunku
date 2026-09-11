"""Hermetic runner tests: artifact encoding contract with the FakeBackend."""

import json
import re
from pathlib import Path

import pytest
from conftest import FAKE_ABC, FakeBackend
from PIL import Image

from omr.benchmark.runner import run_benchmark
from omr.models import OMRWarning


def _write_gt(root: Path) -> Path:
    pdf = root / "score.pdf"
    Image.new("RGB", (200, 280), "white").save(pdf)
    gt = {
        "slug": "fake-tune",
        "source_pdf": "score.pdf",
        "reviewed": False,
        "key_signature": "C",
        "time_signature": [4, 4],
        "measures": [
            {"number": 1, "chords": [{"beat": 0, "symbol": "DΔ7"}]},
            {"number": 2, "chords": [{"beat": 0, "symbol": "G7"}]},
        ],
    }
    gt_path = root / "fake-tune.json"
    gt_path.write_text(json.dumps(gt, ensure_ascii=False), encoding="utf-8")
    return gt_path


def test_benchmark_artifacts_use_explicit_utf8(tmp_path, monkeypatch) -> None:
    # The report holds non-ASCII (DΔ7, ·, ⚠️). Every artifact read/write must
    # pin UTF-8 or the benchmark dies on a non-UTF-8-locale runner AFTER the
    # model inference has already been paid for.
    gt_path = _write_gt(tmp_path)

    writes: list[tuple[str, str | None]] = []
    reads: list[tuple[str, str | None]] = []
    original_write = Path.write_text
    original_read = Path.read_text

    def spy_write(self, data, *args, **kwargs):
        writes.append((self.name, kwargs.get("encoding")))
        return original_write(self, data, *args, **kwargs)

    def spy_read(self, *args, **kwargs):
        reads.append((self.name, kwargs.get("encoding")))
        return original_read(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", spy_write)
    monkeypatch.setattr(Path, "read_text", spy_read)

    outcome = run_benchmark(
        FakeBackend(), [gt_path], repo_root=tmp_path, out_dir=tmp_path / "out"
    )

    assert outcome["results"][0]["slug"] == "fake-tune"
    assert writes, "runner wrote no artifacts"
    non_utf8_writes = [name for name, enc in writes if enc != "utf-8"]
    assert non_utf8_writes == []
    non_utf8_reads = [name for name, enc in reads if enc != "utf-8"]
    assert non_utf8_reads == []


def test_duplicate_ground_truth_slugs_are_rejected(tmp_path: Path) -> None:
    gt_path = _write_gt(tmp_path)
    dup = tmp_path / "fake-tune-copy.json"
    dup.write_text(gt_path.read_text(encoding="utf-8"), encoding="utf-8")

    with pytest.raises(ValueError, match="fake-tune"):
        run_benchmark(
            FakeBackend(), [gt_path, dup], repo_root=tmp_path, out_dir=tmp_path / "out"
        )


def test_parse_detected_text_elision_adds_the_chord_metrics_note(tmp_path: Path) -> None:
    # The elision warning can come from the BACKEND (LEGATO's standing
    # warning, in result.warnings) or from the PARSER spotting <|text|>
    # tokens (normalized.warnings). The report note must fire for both.
    gt_path = _write_gt(tmp_path)
    abc = 'X:1\nT:Fake Tune\nM:4/4\nL:1/8\nK:C\n"<|text|>" C2 E2 G2 E2 | D2 F2 A2 F2 |]\n'

    outcome = run_benchmark(
        FakeBackend(abc=abc), [gt_path], repo_root=tmp_path, out_dir=tmp_path / "out"
    )

    notes = outcome["results"][0]["notes"]
    assert any("does not transcribe text" in n for n in notes)


def test_backend_standing_elision_warning_adds_the_note(tmp_path: Path) -> None:
    # The other elision source: a backend's own standing warning in
    # result.warnings (LEGATO v1's behavior), with no tokens in the ABC.
    class ElidingBackend(FakeBackend):
        def transcribe(self, source):
            result = super().transcribe(source)
            result.warnings.append(
                OMRWarning(code="TEXT_ELIDED_BY_MODEL", message="standing backend warning")
            )
            return result

    gt_path = _write_gt(tmp_path)

    outcome = run_benchmark(
        ElidingBackend(), [gt_path], repo_root=tmp_path, out_dir=tmp_path / "out"
    )

    notes = outcome["results"][0]["notes"]
    assert sum("does not transcribe text" in n for n in notes) == 1


def test_missing_source_pdf_is_an_error_naming_the_chart(tmp_path: Path) -> None:
    gt_path = _write_gt(tmp_path)
    (tmp_path / "score.pdf").unlink()

    with pytest.raises(FileNotFoundError, match="fake-tune"):
        run_benchmark(FakeBackend(), [gt_path], repo_root=tmp_path, out_dir=tmp_path / "out")


def test_per_chart_artifacts_and_a_single_summary_note_without_elision(tmp_path: Path) -> None:
    gt_path = _write_gt(tmp_path)
    out_dir = tmp_path / "out"

    outcome = run_benchmark(FakeBackend(), [gt_path], repo_root=tmp_path, out_dir=out_dir)

    assert (out_dir / "fake-tune.raw.abc").read_text(encoding="utf-8") == FAKE_ABC
    normalized = json.loads((out_dir / "fake-tune.normalized.json").read_text(encoding="utf-8"))
    assert normalized["title"] == "Fake Tune"
    assert outcome["report_md"] == out_dir / "report.md"
    assert outcome["report_json"].exists()
    assert "pitch_strict" in outcome["aggregate"]

    # No elision anywhere: the only note is the warning-count summary.
    [note] = outcome["results"][0]["notes"]
    assert re.fullmatch(
        r"\d+ backend warning\(s\), \d+ parse warning\(s\), \d+ validation warning\(s\)", note
    )
