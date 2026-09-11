"""Hermetic LegatoV1Backend tests — no torch install, no model download.

The real-inference smoke test lives in tests/integration/test_legato_v1_integration.py
behind the omr_integration marker.
"""

from __future__ import annotations

import subprocess
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from omr.backends.legato_v1 import (
    _AUTH_HINT,
    _ENCODER_HINT,
    DEFAULT_MODEL_ID,
    DEFAULT_REVISION,
    GENERATION_MAX_LENGTH,
    LegatoV1Backend,
    _elision_warning,
)
from omr.errors import BackendUnavailableError
from omr.ingest import load_score
from omr.models import PageImage, ScoreInput


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

    with pytest.raises(BackendUnavailableError, match="uv sync --extra legato"):
        backend._load()


# ---------------------------------------------------------------------------
# Load and inference control flow, with the model runtime stubbed out.
#
# torch, transformers, huggingface_hub and the vendored model package are
# replaced in sys.modules so _load()/transcribe() run their REAL control flow
# (revision pinning, error classification, verbatim decoding, MPS fallback)
# with no download, no weights and no tensors.


def _install_runtime(
    monkeypatch,
    *,
    snapshot_error: Exception | None = None,
    load_error: Exception | None = None,
    generate_error: tuple[str, Exception] | None = None,
    tokens: tuple[int, ...] = (7, 8, 9),
    text: str = "X:1\nK:C\nC4 |]",
) -> dict[str, list]:
    calls: dict[str, list] = {"snapshot": [], "from_pretrained": [], "generate": []}

    class Tensor:
        def to(self, device: str) -> Tensor:
            return self

    class Model:
        device: str | None = None

        def to(self, device: str) -> Model:
            self.device = device
            return self

        def eval(self) -> Model:
            return self

        def generate(self, **kwargs):
            calls["generate"].append((self.device, kwargs))
            if generate_error is not None and self.device == generate_error[0]:
                raise generate_error[1]
            return [SimpleNamespace(tolist=lambda: list(tokens))]

    class Processor:
        def __call__(self, images, **kwargs) -> dict[str, Tensor]:
            return {"pixel_values": Tensor()}

        def batch_decode(self, sequences, skip_special_tokens: bool = True) -> list[str]:
            return [text for _ in sequences]

    def snapshot_download(model_id: str, revision=None, token=None) -> str:
        calls["snapshot"].append({"model_id": model_id, "revision": revision, "token": token})
        if snapshot_error is not None:
            raise snapshot_error
        return "/fake/snapshot"

    def from_pretrained(path: str, **kwargs) -> Model:
        calls["from_pretrained"].append((path, kwargs))
        if load_error is not None:
            raise load_error
        return Model()

    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False), no_grad=nullcontext)
    transformers = SimpleNamespace(
        AutoProcessor=SimpleNamespace(from_pretrained=lambda path, **kw: Processor()),
        GenerationConfig=lambda **kw: kw,
    )
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(
        sys.modules, "huggingface_hub", SimpleNamespace(snapshot_download=snapshot_download)
    )
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    monkeypatch.setitem(
        sys.modules,
        "omr.vendor.legato.models",
        SimpleNamespace(LegatoModel=SimpleNamespace(from_pretrained=from_pretrained)),
    )
    return calls


def test_load_pins_the_revision_at_download_and_loads_from_the_local_snapshot(
    monkeypatch,
) -> None:
    # Behavioural twin of the source-inspection pin above: the revision goes
    # to snapshot_download only, and from_pretrained gets the local path.
    calls = _install_runtime(monkeypatch)
    monkeypatch.setenv("HF_TOKEN", "hf_test")
    backend = LegatoV1Backend()

    backend._load()
    backend._load()  # idempotent: a second call must not touch the hub again

    assert calls["snapshot"] == [
        {"model_id": DEFAULT_MODEL_ID, "revision": DEFAULT_REVISION, "token": "hf_test"}
    ]
    [(path, kwargs)] = calls["from_pretrained"]
    assert path == "/fake/snapshot"
    assert kwargs == {"token": "hf_test"}


def test_model_info_reports_the_requested_device_until_loaded(monkeypatch) -> None:
    _install_runtime(monkeypatch)
    backend = LegatoV1Backend()
    assert backend.model_info().device == "auto"
    backend._load()
    assert backend.model_info().device == "cpu"


def test_gated_checkpoint_error_carries_the_auth_hint(monkeypatch) -> None:
    _install_runtime(
        monkeypatch, snapshot_error=OSError("401 Client Error: guangyangmusic/legato is gated")
    )
    with pytest.raises(BackendUnavailableError) as exc_info:
        LegatoV1Backend()._load()

    message = str(exc_info.value)
    assert message.startswith(_AUTH_HINT)
    assert "401 Client Error" in message  # the underlying error is never hidden


def test_gated_encoder_error_names_the_meta_repo_over_the_generic_auth_hint(monkeypatch) -> None:
    # This message trips the auth markers too ("gated"); the encoder hint must
    # still win, because the fix — Meta's license form — is a different one.
    _install_runtime(
        monkeypatch,
        load_error=OSError("Access to meta-llama/Llama-3.2-11B-Vision is restricted (gated)"),
    )
    with pytest.raises(BackendUnavailableError) as exc_info:
        LegatoV1Backend()._load()

    message = str(exc_info.value)
    assert message.startswith(_ENCODER_HINT)
    assert _AUTH_HINT not in message


def test_non_auth_load_errors_propagate_unwrapped(monkeypatch) -> None:
    _install_runtime(monkeypatch, snapshot_error=RuntimeError("disk full"))
    with pytest.raises(RuntimeError, match="disk full"):
        LegatoV1Backend()._load()


def test_transcribe_keeps_decoded_text_verbatim_with_the_standing_warning(
    monkeypatch, png_score: Path
) -> None:
    # Whatever the decoder produced is the raw layer — surrounding whitespace
    # and placeholder tokens included — and every result carries the
    # TEXT_ELIDED_BY_MODEL warning whether or not a placeholder appeared.
    text = "X:1\nT:<|text|>\nK:C\n  C4 |]  \n"
    _install_runtime(monkeypatch, tokens=(1, 2, 3, 4), text=text)
    backend = LegatoV1Backend(device="cpu")

    result = backend.transcribe(load_score(png_score))

    assert result.format == "abc"
    assert result.raw_transcription == text
    assert [(p.page_index, p.text, p.token_count) for p in result.raw_pages] == [(0, text, 4)]
    assert [w.code for w in result.warnings] == ["TEXT_ELIDED_BY_MODEL"]
    assert result.backend.name == "legato_v1"
    assert result.metadata == {"source": str(png_score), "pages": 1}


def test_generation_cap_matches_the_limit_validation_reads(monkeypatch, png_score: Path) -> None:
    # validate() takes its truncation limit from model_info().details; the
    # generation config must use the same number or the two silently drift.
    calls = _install_runtime(monkeypatch)
    backend = LegatoV1Backend(device="cpu", num_beams=3, repetition_penalty=1.2)

    backend.transcribe(load_score(png_score))

    [(_, kwargs)] = calls["generate"]
    config = kwargs["generation_config"]
    assert config["max_length"] == backend.model_info().details["max_length"]
    assert config["max_length"] == GENERATION_MAX_LENGTH
    assert (config["num_beams"], config["repetition_penalty"]) == (3, 1.2)
    assert kwargs["use_model_defaults"] is False


def test_raw_pages_are_labelled_by_source_page(monkeypatch) -> None:
    # The raw page carries the PRINTED page number, so after a page selection
    # debug/raw/page-002.abc still names the page the model actually read.
    _install_runtime(monkeypatch)
    page = PageImage(index=0, image=Image.new("RGB", (20, 20), "white"), dpi=72.0, source_page=1)
    source = ScoreInput(path=Path("chart.pdf"), kind="pdf", pages=(page,))

    result = LegatoV1Backend(device="cpu").transcribe(source)

    assert [p.page_index for p in result.raw_pages] == [1]


def test_mps_generation_failure_falls_back_to_cpu_once_and_loudly(
    monkeypatch, pdf_score: Path
) -> None:
    # Two pages: after the first page's failure the backend STAYS on CPU, so
    # the second page never retries MPS and the warning is not repeated.
    calls = _install_runtime(monkeypatch, generate_error=("mps", RuntimeError("mps.matmul")))
    backend = LegatoV1Backend(device="mps")

    result = backend.transcribe(load_score(pdf_score))

    assert [device for device, _ in calls["generate"]] == ["mps", "cpu", "cpu"]
    [fallback] = [w for w in result.warnings if w.code == "MPS_FALLBACK"]
    assert "mps.matmul" in fallback.message
    assert fallback.page == 0
    assert backend.model_info().device == "cpu"
    assert all(page.text for page in result.raw_pages)  # the retry produced every page


def test_generation_failure_off_mps_propagates(monkeypatch, png_score: Path) -> None:
    # The CPU retry is an MPS-only escape hatch: a CPU failure is raised as-is
    # on the first attempt, never retried and never labelled MPS_FALLBACK.
    calls = _install_runtime(monkeypatch, generate_error=("cpu", RuntimeError("out of memory")))
    with pytest.raises(RuntimeError, match="out of memory"):
        LegatoV1Backend(device="cpu").transcribe(load_score(png_score))
    assert [device for device, _ in calls["generate"]] == ["cpu"]
