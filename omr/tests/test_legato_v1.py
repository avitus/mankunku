"""Hermetic LegatoV1Backend tests — no torch install, no model download.

The real-inference smoke test lives in tests/integration/test_legato_v1.py
behind the omr_integration marker.
"""

import sys
from types import SimpleNamespace

import pytest

from omr.backends.legato_v1 import _AUTH_HINT, LegatoV1Backend, _elision_warning


def test_module_import_is_lazy() -> None:
    # Importing the backend module must not pull in torch/transformers —
    # the default (model-free) install has neither.
    torch_was_loaded = "torch" in sys.modules
    import omr.backends.legato_v1  # noqa: F401

    if not torch_was_loaded:
        assert "torch" not in sys.modules
        assert "transformers" not in sys.modules


def _stub_torch(monkeypatch, *, cuda: bool, mps: bool) -> None:
    stub = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: cuda),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
    )
    monkeypatch.setitem(sys.modules, "torch", stub)


@pytest.mark.parametrize(
    "cuda,mps,expected",
    [(True, True, "cuda"), (False, True, "mps"), (False, False, "cpu")],
)
def test_device_auto_resolution(monkeypatch, cuda: bool, mps: bool, expected: str) -> None:
    _stub_torch(monkeypatch, cuda=cuda, mps=mps)
    assert LegatoV1Backend()._resolve_device() == expected


def test_explicit_device_wins(monkeypatch) -> None:
    _stub_torch(monkeypatch, cuda=True, mps=True)
    assert LegatoV1Backend(device="cpu")._resolve_device() == "cpu"


def test_model_info_before_load_needs_no_torch() -> None:
    backend = LegatoV1Backend()
    info = backend.model_info()

    assert info.name == "legato_v1"
    assert info.model_id == "guangyangmusic/legato"
    assert info.revision  # pinned, never floating
    assert info.details["note"].startswith("LEGATO v1")
    assert "NOT LEGATO 2" in info.details["note"]


def test_no_system_segmentation() -> None:
    assert LegatoV1Backend().supports_system_segmentation() is False


def test_auth_hint_is_actionable() -> None:
    assert "huggingface.co/guangyangmusic/legato" in _AUTH_HINT
    assert "HF_TOKEN" in _AUTH_HINT


def test_standing_elision_warning() -> None:
    warning = _elision_warning()
    assert warning.code == "TEXT_ELIDED_BY_MODEL"
    assert "chord symbols" in warning.message


def test_missing_torch_gives_actionable_error(monkeypatch) -> None:
    # Simulate the model-free install: importing torch raises.
    monkeypatch.setitem(sys.modules, "torch", None)
    backend = LegatoV1Backend()

    from omr.errors import BackendUnavailableError

    with pytest.raises(BackendUnavailableError, match="uv sync --extra legato"):
        backend._load()
