"""Real-inference smoke test for LegatoV1Backend.

Opt-in: `uv run pytest -m omr_integration`. Requires the `legato` extra
(`uv sync --extra legato`), a Hugging Face account that has accepted the
gated-model terms at https://huggingface.co/guangyangmusic/legato, and a
token (HF_TOKEN env var or `hf auth login`). Downloads ~429MB once.
"""

from pathlib import Path

import pytest

pytestmark = pytest.mark.omr_integration

REPO_ROOT = Path(__file__).resolve().parents[3]
LADY_BIRD = REPO_ROOT / "Leadsheets" / "PDF" / "Lady Bird.pdf"


def _hf_token_available() -> bool:
    try:
        from huggingface_hub import get_token
    except ImportError:
        return False
    return get_token() is not None


@pytest.fixture(scope="module")
def bundle():
    if not LADY_BIRD.exists():
        pytest.skip(f"corpus chart not found: {LADY_BIRD}")
    if not _hf_token_available():
        pytest.skip(
            "Hugging Face auth required: accept the terms at "
            "https://huggingface.co/guangyangmusic/legato while logged in, then "
            "set HF_TOKEN or run `hf auth login`"
        )
    from omr.backends.legato_v1 import LegatoV1Backend
    from omr.pipeline import transcribe_file

    return transcribe_file(LADY_BIRD, LegatoV1Backend(), pages=[1])


def test_produces_nonempty_abc(bundle) -> None:
    assert bundle.result.raw_transcription.strip()
    assert bundle.result.format == "abc"


def test_at_least_one_measure_parses(bundle) -> None:
    assert len(bundle.normalized.measures) >= 1
    assert any(m.notes for m in bundle.normalized.measures)


def test_standing_elision_warning_present(bundle) -> None:
    assert any(w.code == "TEXT_ELIDED_BY_MODEL" for w in bundle.result.warnings)


def test_backend_identity_recorded(bundle) -> None:
    info = bundle.result.backend
    assert info.model_id == "guangyangmusic/legato"
    assert info.revision
    assert info.device in ("cuda", "mps", "cpu")
