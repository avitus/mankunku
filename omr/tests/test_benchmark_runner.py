"""Hermetic runner tests: artifact encoding contract with the FakeBackend."""

import json
from pathlib import Path

from conftest import FakeBackend
from PIL import Image

from omr.benchmark.runner import run_benchmark


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
    import pytest

    gt_path = _write_gt(tmp_path)
    dup = tmp_path / "fake-tune-copy.json"
    dup.write_text(gt_path.read_text(encoding="utf-8"), encoding="utf-8")

    with pytest.raises(ValueError, match="fake-tune"):
        run_benchmark(
            FakeBackend(), [gt_path, dup], repo_root=tmp_path, out_dir=tmp_path / "out"
        )
