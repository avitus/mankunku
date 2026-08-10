"""Temporary experimentation backend. LEGATO v1 — NOT LEGATO 2.

Wraps the released LEGATO 1 model (github.com/guang-yng/legato, MIT;
checkpoint guangyangmusic/legato, MIT, gated "auto") behind the OMRBackend
protocol. Whole-page recognition, ABC output, max 2,048 generated tokens
per page.

Known, deliberate limitations (documented, never hidden):

- **No text — and therefore no chord symbols.** LEGATO 1's tokenizer
  replaces every text span (titles, annotations, and ABC's quoted chord
  symbols) with a single ``<|text|>`` token. Every result carries a
  standing ``TEXT_ELIDED_BY_MODEL`` warning. The text-aware tokenizer is a
  LEGATO 2 feature, and LEGATO 2 is unreleased — see docs/omr/legato2.md.
- **Out-of-domain input.** The model trains on PDMX-Synth (classical /
  piano-heavy); jazz lead sheets are out of distribution. Quality is
  measured by the benchmark harness, not assumed.
- Whole-page processing: no system segmentation, so no per-system crops in
  debug output.

Heavy imports (torch/transformers) happen inside ``_load()`` only, so the
default model-free install can import and select this backend without them.
"""

from __future__ import annotations

import os

import omr
from omr.errors import BackendUnavailableError
from omr.models import BackendInfo, OMRResult, OMRWarning, RawPage, ScoreInput

DEFAULT_MODEL_ID = "guangyangmusic/legato"
# Pinned checkpoint revision — never float on main.
DEFAULT_REVISION = "2d07c5d0e73186f2c0b12e35ea187bbc30dec18c"
GENERATION_MAX_LENGTH = 2048

_AUTH_HINT = (
    "downloading guangyangmusic/legato requires a Hugging Face account: "
    "log in at huggingface.co, accept the conditions at "
    "https://huggingface.co/guangyangmusic/legato, then set the HF_TOKEN "
    "environment variable (or run `hf auth login`)"
)

# The 429MB checkpoint stores only the trained decoder + projection. The
# frozen vision encoder streams from Meta's SEPARATELY gated repo at load
# time — a second access grant is unavoidable for real inference.
_ENCODER_HINT = (
    "the LEGATO v1 vision encoder loads from the gated "
    "meta-llama/Llama-3.2-11B-Vision repository: request access at "
    "https://huggingface.co/meta-llama/Llama-3.2-11B-Vision (Meta's license "
    "form; approval is usually granted within minutes-to-hours), then retry"
)


def _elision_warning() -> OMRWarning:
    return OMRWarning(
        code="TEXT_ELIDED_BY_MODEL",
        message=(
            "LEGATO v1 replaces all printed text (titles, annotations, and "
            "chord symbols) with <|text|> placeholders — chord symbols are "
            "not transcribed by this backend"
        ),
    )


class LegatoV1Backend:
    """See module docstring. This is LEGATO v1 — never presented as LEGATO 2."""

    name = "legato_v1"

    def __init__(
        self,
        device: str = "auto",
        num_beams: int = 5,
        repetition_penalty: float = 1.1,
        model_id: str = DEFAULT_MODEL_ID,
        revision: str = DEFAULT_REVISION,
    ) -> None:
        self.requested_device = device
        self.num_beams = num_beams
        self.repetition_penalty = repetition_penalty
        self.model_id = model_id
        self.revision = revision
        self._model = None
        self._processor = None
        self._device: str | None = None

    # -- identity -----------------------------------------------------------

    def model_info(self) -> BackendInfo:
        return BackendInfo(
            name=self.name,
            model_id=self.model_id,
            revision=self.revision,
            version=omr.__version__,
            device=self._device or self.requested_device,
            details={
                "note": "LEGATO v1 experimentation backend — NOT LEGATO 2",
                "license": "MIT",
                "max_length": GENERATION_MAX_LENGTH,
                "num_beams": self.num_beams,
                "repetition_penalty": self.repetition_penalty,
            },
        )

    def supports_system_segmentation(self) -> bool:
        return False  # whole-page model; debug output has no system crops

    # -- loading ------------------------------------------------------------

    def _resolve_device(self) -> str:
        import torch

        if self.requested_device != "auto":
            return self.requested_device
        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
        return "cpu"

    def _load(self) -> None:
        if self._model is not None:
            return
        try:
            import torch  # noqa: F401
        except (ImportError, TypeError) as e:
            raise BackendUnavailableError(
                "LEGATO v1 needs the model runtime: run `uv sync --extra legato` "
                "in omr/ first"
            ) from e

        from huggingface_hub import snapshot_download
        from transformers import AutoProcessor

        from omr.vendor.legato.models import LegatoModel  # registers Auto* classes

        token = os.environ.get("HF_TOKEN")
        try:
            # Resolve the pinned revision HERE and load from the local path.
            # Passing revision= into from_pretrained would propagate it into
            # the nested MllamaVisionModel.from_pretrained('meta-llama/...')
            # encoder load, where our legato revision does not exist.
            local_path = snapshot_download(
                self.model_id, revision=self.revision, token=token
            )
            model = LegatoModel.from_pretrained(local_path, token=token)
            processor = AutoProcessor.from_pretrained(local_path)
        except Exception as e:
            lowered = str(e).lower()
            auth_markers = ("gated", "401", "403", "authoriz", "credential", "token")
            if "meta-llama" in lowered:
                raise BackendUnavailableError(f"{_ENCODER_HINT} (underlying: {e})") from e
            if any(marker in lowered for marker in auth_markers):
                raise BackendUnavailableError(f"{_AUTH_HINT} (underlying: {e})") from e
            raise

        self._device = self._resolve_device()
        self._model = model.to(self._device).eval()
        self._processor = processor

    # -- inference ----------------------------------------------------------

    def transcribe(self, source: ScoreInput) -> OMRResult:
        self._load()
        import torch
        from transformers import GenerationConfig

        generation_config = GenerationConfig(
            max_length=GENERATION_MAX_LENGTH,
            num_beams=self.num_beams,
            repetition_penalty=self.repetition_penalty,
        )

        warnings: list[OMRWarning] = [_elision_warning()]
        raw_pages: list[RawPage] = []

        for page in source.pages:
            inputs = self._processor(
                images=[page.image.convert("RGB")], truncation=True, return_tensors="pt"
            )
            inputs = {k: v.to(self._device) for k, v in inputs.items()}
            try:
                with torch.no_grad():
                    output = self._model.generate(
                        **inputs, generation_config=generation_config, use_model_defaults=False
                    )
            except (RuntimeError, NotImplementedError) as e:
                if self._device != "mps":
                    raise
                # Beam search on MPS is not guaranteed by upstream (tested on
                # CUDA only). Fall back to CPU once, loudly.
                warnings.append(
                    OMRWarning(
                        code="MPS_FALLBACK",
                        message=f"generation failed on MPS ({e}); retried on CPU",
                        page=page.source_page,
                    )
                )
                self._device = "cpu"
                self._model = self._model.to("cpu")
                inputs = {k: v.to("cpu") for k, v in inputs.items()}
                with torch.no_grad():
                    output = self._model.generate(
                        **inputs, generation_config=generation_config, use_model_defaults=False
                    )

            tokens = output[0].tolist()
            text = self._processor.batch_decode([tokens], skip_special_tokens=True)[0]
            raw_pages.append(
                RawPage(page_index=page.source_page, text=text, token_count=len(tokens))
            )

        return OMRResult(
            raw_transcription="\n".join(p.text for p in raw_pages),
            format="abc",
            raw_pages=raw_pages,
            backend=self.model_info(),
            warnings=warnings,
            metadata={"source": str(source.path), "pages": len(source.pages)},
        )
