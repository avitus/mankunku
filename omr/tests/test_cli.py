"""CLI tests, run in-process against the registry with a FakeBackend."""

import json
from pathlib import Path

import pytest
from conftest import FAKE_ABC, FakeBackend

from omr.backends import register_backend, unregister_backend
from omr.cli import main


@pytest.fixture(autouse=True)
def _fake_registry():
    register_backend("fake", FakeBackend)
    register_backend("fake-fail", lambda **opts: FakeBackend(fail=True))
    yield
    unregister_backend("fake")
    unregister_backend("fake-fail")


def test_transcribe_writes_output_json(png_score: Path, tmp_path: Path, capsys) -> None:
    out = tmp_path / "result.json"
    code = main(["transcribe", str(png_score), "--backend", "fake", "--output", str(out)])

    assert code == 0
    data = json.loads(out.read_text())
    assert data["backend"]["name"] == "fake"
    assert data["result"]["raw_transcription"] == FAKE_ABC
    assert data["normalized"]["title"] == "Fake Tune"
    assert "validation_warnings" in data

    stderr = capsys.readouterr().err
    assert "backend=fake" in stderr
    assert "fake/model" in stderr


def test_raw_flag_prints_verbatim_abc(png_score: Path, tmp_path: Path, capsys) -> None:
    out = tmp_path / "r.json"
    code = main(["transcribe", str(png_score), "--backend", "fake", "--output", str(out), "--raw"])

    assert code == 0
    assert capsys.readouterr().out.strip() == FAKE_ABC.strip()


def test_debug_flag_writes_artifacts(png_score: Path, tmp_path: Path) -> None:
    debug_root = tmp_path / "dbg"
    out = tmp_path / "r.json"
    code = main(
        [
            "transcribe",
            str(png_score),
            "--backend",
            "fake",
            "--output",
            str(out),
            "--debug",
            "--debug-dir",
            str(debug_root),
        ]
    )

    assert code == 0
    runs = list(debug_root.iterdir())
    assert len(runs) == 1
    assert (runs[0] / "normalized.json").exists()


def test_unsupported_input_exits_2(tmp_path: Path, capsys) -> None:
    bad = tmp_path / "x.txt"
    bad.write_text("nope")
    code = main(["transcribe", str(bad), "--backend", "fake"])

    assert code == 2
    assert "unsupported" in capsys.readouterr().err


def test_missing_file_exits_2(tmp_path: Path) -> None:
    assert main(["transcribe", str(tmp_path / "ghost.png"), "--backend", "fake"]) == 2


def test_unknown_backend_exits_2(png_score: Path, capsys) -> None:
    code = main(["transcribe", str(png_score), "--backend", "nope"])

    assert code == 2
    assert "available" in capsys.readouterr().err


def test_legato2_stub_exits_3_with_blocker(png_score: Path, capsys) -> None:
    code = main(["transcribe", str(png_score), "--backend", "legato2"])

    assert code == 3
    err = capsys.readouterr().err
    assert "LEGATO 2" in err
    assert "not been released" in err


def test_backend_failure_exits_4(png_score: Path, capsys) -> None:
    code = main(["transcribe", str(png_score), "--backend", "fake-fail"])

    assert code == 4
    assert "fake backend failure" in capsys.readouterr().err


def test_benchmark_subcommand_writes_report(pdf_score: Path, tmp_path: Path, capsys) -> None:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    (gt_dir / "fake-chart.json").write_text(
        json.dumps(
            {
                "slug": "fake-chart",
                "source_pdf": pdf_score.name,
                "reviewed": False,
                "key_signature": "C",
                "time_signature": [4, 4],
                "measures": [
                    {
                        "number": 1,
                        "chords": [{"beat": 0, "symbol": "C"}],
                        "melody": [
                            {"beat": 0, "duration_beats": 1, "pitch": "C4"},
                            {"beat": 1, "duration_beats": 1, "pitch": "E4"},
                        ],
                    }
                ],
            }
        )
    )
    out_dir = tmp_path / "results"
    code = main(
        [
            "benchmark",
            "--backend",
            "fake",
            "--gt-dir",
            str(gt_dir),
            "--repo-root",
            str(pdf_score.parent),
            "--out",
            str(out_dir),
        ]
    )

    assert code == 0
    report = (out_dir / "report.md").read_text()
    assert "fake-chart" in report
    assert (out_dir / "report.json").exists()
    assert (out_dir / "fake-chart.raw.abc").exists()
    assert "report" in capsys.readouterr().err


def test_benchmark_no_ground_truth_exits_2(tmp_path: Path, capsys) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    code = main(["benchmark", "--backend", "fake", "--gt-dir", str(empty)])

    assert code == 2
    assert "ground truth" in capsys.readouterr().err


def test_transcribe_creates_missing_output_directory(png_score: Path, tmp_path: Path) -> None:
    out = tmp_path / "nested" / "dir" / "result.json"
    code = main(["transcribe", str(png_score), "--backend", "fake", "--output", str(out)])
    assert code == 0
    assert out.exists()


def test_unwritable_output_maps_to_exit_2(png_score: Path, tmp_path: Path, capsys) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("a file, not a directory")
    out = blocker / "result.json"  # parent is a file — the write cannot succeed
    code = main(["transcribe", str(png_score), "--backend", "fake", "--output", str(out)])
    assert code == 2
    assert "cannot write" in capsys.readouterr().err


def test_out_of_range_page_selection_exits_2(pdf_score: Path, tmp_path: Path, capsys) -> None:
    out = tmp_path / "r.json"
    code = main(
        ["transcribe", str(pdf_score), "--backend", "fake", "--output", str(out), "--pages", "9"]
    )
    assert code == 2
    assert "matches no page" in capsys.readouterr().err
