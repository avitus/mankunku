"""Hermetic LegatoV1Backend tests — no torch install, no model download.

The real-inference smoke test lives in tests/integration/test_legato_v1.py
behind the omr_integration marker.
"""

import subprocess
import sys
from types import SimpleNamespace

import pytest

from omr.backends.legato_v1 import _AUTH_HINT, LegatoV1Backend, _elision_warning


def test_module_import_is_lazy() -> None:
    # Importing the backend module must not pull in torch/transformers —
    # the default (model-free) install has neither. A fresh interpreter is
    # the only honest check: in-process, collection-time imports could have
    # loaded torch already and the assertion would silently not run.
    code = (
        "import sys; import omr.backends.legato_v1; "
        "assert 'torch' not in sys.modules; "
        "assert 'transformers' not in sys.modules"
    )
    subprocess.run([sys.executable, "-c", code], check=True)


def _stub_torch(monkeypatch, *, cuda: bool, mps: bool) -> None:
    stub = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: cuda),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
    )
    monkeypatch.setitem(sys.modules, "torch", stub)


@pytest.mark.parametrize(
    "cuda,mps,expected",
    [(True, True, "cuda"), (False, True, "cpu"), (False, False, "cpu")],
)
def test_device_auto_resolution_never_selects_mps(
    monkeypatch, cuda: bool, mps: bool, expected: str
) -> None:
    # MPS hard-crashes the process (SIGABRT in mps.matmul, torch 2.6 +
    # Mllama cross-attention — verified on a 2023 Mac Studio 2026-08-09).
    # A process abort cannot be caught in-process, so `auto` must never
    # choose MPS; it stays opt-in via an explicit device="mps".
    _stub_torch(monkeypatch, cuda=cuda, mps=mps)
    assert LegatoV1Backend()._resolve_device() == expected


def test_explicit_device_wins(monkeypatch) -> None:
    _stub_torch(monkeypatch, cuda=True, mps=True)
    assert LegatoV1Backend(device="cpu")._resolve_device() == "cpu"
    assert LegatoV1Backend(device="mps")._resolve_device() == "mps"


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


def test_meta_encoder_hint_is_actionable() -> None:
    # The checkpoint is NOT self-contained: the frozen vision encoder streams
    # from Meta's separately-gated repo, and the error must say so.
    from omr.backends.legato_v1 import _ENCODER_HINT

    assert "meta-llama/Llama-3.2-11B-Vision" in _ENCODER_HINT
    assert "request access" in _ENCODER_HINT.lower()


def test_revision_pin_must_not_reach_encoder_repo() -> None:
    # Regression pin for the load path: passing revision= into
    # LegatoModel.from_pretrained propagates it into the nested
    # MllamaVisionModel.from_pretrained('meta-llama/...') call, where our
    # legato revision does not exist. The backend must therefore resolve the
    # pinned revision via snapshot_download and load from the local path.
    import inspect

    from omr.backends import legato_v1

    source = inspect.getsource(legato_v1.LegatoV1Backend._load)
    assert "snapshot_download" in source
    assert "from_pretrained(local_path" in source
    # revision may only ever be passed to snapshot_download, never from_pretrained
    for line in source.splitlines():
        code = line.split("#", 1)[0]
        if "from_pretrained" in code:
            assert "revision" not in code


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
