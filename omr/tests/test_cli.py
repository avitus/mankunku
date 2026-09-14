"""CLI tests, run in-process against the registry with a FakeBackend."""

import json
import sys
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


@pytest.mark.parametrize("exists", [True, False])
def test_benchmark_no_ground_truth_exits_2(tmp_path: Path, capsys, exists: bool) -> None:
    gt_dir = tmp_path / "gt"
    if exists:
        gt_dir.mkdir()  # present but empty; otherwise absent altogether
    code = main(["benchmark", "--backend", "fake", "--gt-dir", str(gt_dir)])

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


def test_bad_pages_argument_exits_2(png_score: Path, capsys) -> None:
    code = main(["transcribe", str(png_score), "--backend", "fake", "--pages", "1,x"])

    assert code == 2
    assert "1-based integers" in capsys.readouterr().err


def test_pages_selection_reaches_the_pipeline(pdf_score: Path, tmp_path: Path) -> None:
    out = tmp_path / "r.json"
    code = main(
        ["transcribe", str(pdf_score), "--backend", "fake", "--output", str(out), "--pages", "2"]
    )

    assert code == 0
    data = json.loads(out.read_text())
    assert [p["page_index"] for p in data["result"]["raw_pages"]] == [1]


def test_default_output_path_is_the_stem_omr_json_in_cwd(
    png_score: Path, tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["transcribe", str(png_score), "--backend", "fake"]) == 0
    assert (tmp_path / "score.omr.json").exists()


def test_builtin_backend_receives_options_and_exits_3_without_the_runtime(
    png_score: Path, monkeypatch, capsys
) -> None:
    # The lazy built-in factory must forward --device/--beams, and a
    # model-free install must end at exit 3 with the install hint — never a
    # traceback. torch is blanked so this holds even where the extra is installed.
    monkeypatch.setitem(sys.modules, "torch", None)
    code = main(
        ["transcribe", str(png_score), "--backend", "legato_v1", "--device", "cpu", "--beams", "1"]
    )

    assert code == 3
    err = capsys.readouterr().err
    assert "backend=legato_v1 · model=guangyangmusic/legato@" in err
    assert "device=cpu" in err
    assert "uv sync --extra legato" in err


def test_backend_rejecting_options_exits_2(png_score: Path, capsys) -> None:
    # The stub takes no options: a TypeError from the factory is a usage error.
    code = main(["transcribe", str(png_score), "--backend", "legato2", "--beams", "3"])

    assert code == 2
    assert "rejected options" in capsys.readouterr().err


def _write_chart(gt_dir: Path, slug: str, pdf_name: str) -> None:
    (gt_dir / f"{slug}.json").write_text(
        json.dumps(
            {
                "slug": slug,
                "source_pdf": pdf_name,
                "reviewed": False,
                "key_signature": "C",
                "time_signature": [4, 4],
                "measures": [{"number": 1, "chords": [{"beat": 0, "symbol": "C"}]}],
            }
        )
    )


def _benchmark_args(backend: str, gt_dir: Path, repo_root: Path, out_dir: Path) -> list[str]:
    return [
        "benchmark",
        "--backend",
        backend,
        "--gt-dir",
        str(gt_dir),
        "--repo-root",
        str(repo_root),
        "--out",
        str(out_dir),
    ]


def test_benchmark_charts_filter_selects_slugs(pdf_score: Path, tmp_path: Path) -> None:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    _write_chart(gt_dir, "alpha", pdf_score.name)
    _write_chart(gt_dir, "beta", pdf_score.name)
    out_dir = tmp_path / "results"

    args = _benchmark_args("fake", gt_dir, pdf_score.parent, out_dir)
    assert main([*args, "--charts", "beta"]) == 0

    report = json.loads((out_dir / "report.json").read_text(encoding="utf-8"))
    assert list(report["charts"]) == ["beta"]


def test_benchmark_backend_failure_exits_4(pdf_score: Path, tmp_path: Path, capsys) -> None:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    _write_chart(gt_dir, "alpha", pdf_score.name)

    code = main(_benchmark_args("fake-fail", gt_dir, pdf_score.parent, tmp_path / "results"))

    assert code == 4
    assert "benchmark failed" in capsys.readouterr().err


def test_benchmark_unavailable_backend_exits_3(pdf_score: Path, tmp_path: Path, capsys) -> None:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    _write_chart(gt_dir, "alpha", pdf_score.name)

    code = main(_benchmark_args("legato2", gt_dir, pdf_score.parent, tmp_path / "results"))

    assert code == 3
    assert "LEGATO 2" in capsys.readouterr().err


def test_benchmark_missing_source_pdf_exits_2(tmp_path: Path, capsys) -> None:
    gt_dir = tmp_path / "gt"
    gt_dir.mkdir()
    _write_chart(gt_dir, "alpha", "ghost.pdf")

    code = main(_benchmark_args("fake", gt_dir, tmp_path, tmp_path / "results"))

    assert code == 2
    assert "ghost.pdf" in capsys.readouterr().err


def test_benchmark_forwards_device_and_beams_to_the_backend(tmp_path: Path) -> None:
    received: list[dict[str, object]] = []

    def factory(**options: object) -> FakeBackend:
        received.append(options)
        return FakeBackend()

    register_backend("fake-capture", factory)
    try:
        gt_dir = tmp_path / "gt"
        gt_dir.mkdir()  # empty: the run stops at exit 2, after the backend was built
        args = ["benchmark", "--backend", "fake-capture", "--gt-dir", str(gt_dir)]
        assert main([*args, "--device", "cpu", "--beams", "2"]) == 2
    finally:
        unregister_backend("fake-capture")

    assert received == [{"device": "cpu", "num_beams": 2}]


@pytest.mark.parametrize(
    "backend_args,message",
    [(["--backend", "nope"], "available"), (["--backend", "legato2", "--beams", "3"], "argument")],
)
def test_benchmark_backend_construction_errors_exit_2(
    tmp_path: Path, capsys, backend_args: list[str], message: str
) -> None:
    # An unknown name and a backend that rejects the options are usage errors,
    # reported before any ground truth is read.
    code = main(["benchmark", *backend_args, "--gt-dir", str(tmp_path / "absent")])

    assert code == 2
    err = capsys.readouterr().err
    assert message in err
    assert "ground truth" not in err
