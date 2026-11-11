"""LEGATO 2 placeholder; published artifacts are not yet integrated here.

The official legato-2 model card now publishes weights and a segmenter.
A matching reproducible source/runtime and corpus acceptance remain work.
See docs/omr/legato2.md for the dated availability check and source links.
"""

from __future__ import annotations

import omr
from omr.errors import Legato2NotAvailableError
from omr.models import BackendInfo, OMRResult, ScoreInput

_BLOCKER_MESSAGE = (
    "LEGATO 2 is not integrated in this repository. Official artifacts are published at "
    "huggingface.co/guangyangmusic/legato-2, but matching source/runtime and corpus "
    "acceptance are still required. See docs/omr/legato2.md. "
    "For experimentation use --backend legato_v1; it does not transcribe chord symbols."
)


class Legato2Backend:
    """Placeholder for the unintegrated LEGATO 2 pipeline. See module docstring."""

    name = "legato2"

    def model_info(self) -> BackendInfo:
        return BackendInfo(
            name=self.name,
            model_id=None,
            revision=None,
            version=omr.__version__,
            device=None,
            details={
                "status": "not_integrated",
                "published_model_id": "guangyangmusic/legato-2",
                "paper": "arXiv:2607.05769",
            },
        )

    def transcribe(self, source: ScoreInput) -> OMRResult:
        raise Legato2NotAvailableError(_BLOCKER_MESSAGE)

    def supports_system_segmentation(self) -> bool:
        # The real pipeline is system-based; the stub never produces output.
        return True
