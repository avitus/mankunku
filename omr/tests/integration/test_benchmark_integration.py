"""Real-model benchmark smoke: one chart end-to-end with LegatoV1Backend.

Opt-in via `uv run pytest -m omr_integration`. Same auth prerequisites as
test_legato_v1_integration.py.
"""

from pathlib import Path

import pytest

pytestmark = pytest.mark.omr_integration

OMR_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = OMR_ROOT.parent
GT = OMR_ROOT / "tests" / "benchmark" / "ground_truth" / "lady-bird.json"


def test_benchmark_runs_and_reports(tmp_path: Path) -> None:
    try:
        from huggingface_hub import get_token
    except ImportError:
        pytest.skip("legato extra not installed")
    if get_token() is None:
        pytest.skip("HF auth required (accept terms + HF_TOKEN / `hf auth login`)")

    from omr.backends.legato_v1 import LegatoV1Backend
    from omr.benchmark.runner import run_benchmark

    outcome = run_benchmark(
        LegatoV1Backend(), [GT], repo_root=REPO_ROOT, out_dir=tmp_path / "results"
    )

    report = outcome["report_md"].read_text(encoding="utf-8")
    assert "lady-bird" in report
    metrics = outcome["results"][0]["metrics"]
    # The denominators must reflect the real chart, whatever the scores are.
    assert metrics.pitch_strict.den > 30
    assert metrics.chord_exact.den > 10
