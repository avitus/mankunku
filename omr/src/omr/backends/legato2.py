"""Legato2Backend — deliberately UNIMPLEMENTED.

LEGATO 2 ("LEGATO 2: Toward Multimodal Sheet Music Recognition and
Understanding", Yang, Zheng, Ebert, Smith — arXiv:2607.05769, preprint
2026-07-07) has not been publicly released as of 2026-08-09. The paper
states "We will enable reproduction by releasing data and code upon
publication." Full findings: docs/omr/legato2.md.

What is missing (all three are required):

1. **Inference code** for the system-conditioned pipeline. The public
   github.com/guang-yng/legato repo implements only LEGATO 1's whole-page
   inference; LEGATO 2's per-system autoregressive decoding (each system
   conditioned on previous systems' ABC, left-truncated to 1,024 of the
   2,048-token context) and the rule-based system-level-ABC -> standard-ABC
   merge exist only as descriptions in the paper.
2. **Licensed weights.** huggingface.co/guangyangmusic/legato-1.5 (0.9B,
   model_type "legato") is gated "manual", has NO license and no model
   card; guangyangmusic/legato-1.5-YOLO is a bare .pt with NO license.
   Neither is usable, legally or practically.
3. **The segmentation stage.** LEGATO 2 segments pages into systems with a
   YOLOv8-medium (~26M params, 800px input, boxes stretched to full page
   width) finetuned from Jung et al.'s piano checkpoint; no licensed,
   documented release of that model or its integration exists.

Intended implementation sketch (from the paper, for whoever fills this in):
  pages -> YOLO system detector -> system crops (top/bottom from boxes,
  full page width) -> for each system i: VLM.generate(image=u_i,
  context=left_truncated(abc_{<i}, 1024), max_context=2048) -> system-level
  ABC a_i -> rule-based merge to standard ABC (on ill-formed output,
  iteratively discard terminal systems until the merge succeeds).
  Inference knobs used in the paper: repetition penalty in {1.0, 1.1, 1.2},
  beam size in {1, 2, 5, 10}, selected on a validation set.
  Output format: ABC notation INCLUDING embedded text (titles, composers,
  annotations — and therefore chord symbols), via the text-aware
  byte-fallback tokenizer (vocab 4096).

Watch list:
  - https://arxiv.org/abs/2607.05769 (publication status)
  - https://github.com/guang-yng/legato (code release)
  - https://huggingface.co/guangyangmusic (weights release)

Definition of ready to implement: official LEGATO 2 inference code with an
OSI license, a licensed VLM checkpoint, and the segmentation model (or a
documented replacement). Until then transcribe() raises
Legato2NotAvailableError; use LegatoV1Backend for experimentation, knowing
it transcribes NO text (and therefore no chord symbols).
"""

from __future__ import annotations

import omr
from omr.errors import Legato2NotAvailableError
from omr.models import BackendInfo, OMRResult, ScoreInput

_BLOCKER_MESSAGE = (
    "LEGATO 2 has not been released: the paper (arXiv:2607.05769, preprint "
    "2026-07-07) promises code and data 'upon publication', but no official "
    "inference code for the system-conditioned pipeline exists publicly, and "
    "the only candidate weights (huggingface.co/guangyangmusic/legato-1.5, "
    "gated 'manual'; legato-1.5-YOLO, bare .pt) carry NO license. "
    "See docs/omr/legato2.md for the full findings and watch list. "
    "For temporary experimentation use --backend legato_v1 (LEGATO 1, MIT) — "
    "but note it transcribes no text, so chord symbols will be absent."
)


class Legato2Backend:
    """Placeholder for the unreleased LEGATO 2 pipeline. See module docstring."""

    name = "legato2"

    def model_info(self) -> BackendInfo:
        return BackendInfo(
            name=self.name,
            model_id=None,  # no released checkpoint exists to name
            revision=None,
            version=omr.__version__,
            device=None,
            details={"status": "unreleased", "paper": "arXiv:2607.05769"},
        )

    def transcribe(self, source: ScoreInput) -> OMRResult:
        raise Legato2NotAvailableError(_BLOCKER_MESSAGE)

    def supports_system_segmentation(self) -> bool:
        # The real pipeline is system-based; the stub never produces output.
        return True
