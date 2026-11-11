"""Real-model benchmark smoke: one chart end-to-end with LegatoV1Backend.

Opt-in via `uv run pytest -m omr_integration` in the isolated model environment.
Requires the legato extra, both gated model grants, and HF_TOKEN / hf auth login.
The same transcription verifies backend metadata, artifacts and accuracy.
"""

import json
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

    out_dir = tmp_path / "results"
    backend = LegatoV1Backend()
    outcome = run_benchmark(backend, [GT], repo_root=REPO_ROOT, out_dir=out_dir)

    report = outcome["report_md"].read_text(encoding="utf-8")
    assert "lady-bird" in report
    assert "this backend does not transcribe text" in report
    assert (out_dir / "lady-bird.raw.abc").read_text().strip()
    normalized = json.loads((out_dir / "lady-bird.normalized.json").read_text())
    assert any(measure["notes"] for measure in normalized["measures"])
    info = json.loads(outcome["report_json"].read_text())["backend"]
    assert info["model_id"] == "guangyangmusic/legato"
    assert info["revision"]
    assert info["device"] in ("cuda", "mps", "cpu")
    metrics = outcome["results"][0]["metrics"]
    # Preserve the recorded Lady Bird baseline, with modest room for CPU
    # numerical differences. Denominators alone can pass for empty output.
    assert metrics.pitch_strict.den > 30
    assert metrics.chord_exact.den > 10
    assert metrics.measure_count_error == 0
    assert metrics.pitch_strict.value is not None and metrics.pitch_strict.value >= 0.80
    assert metrics.pitch_midi.value is not None and metrics.pitch_midi.value >= 0.85
    assert metrics.rhythm_exact.value is not None and metrics.rhythm_exact.value >= 0.90
