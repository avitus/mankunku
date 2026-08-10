"""The backend contract everything else depends on.

The rest of the subsystem (pipeline, CLI, benchmark) imports only this
protocol — never a concrete LEGATO class — so OMR engines stay swappable.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from omr.models import BackendInfo, OMRResult, ScoreInput


@runtime_checkable
class OMRBackend(Protocol):
    name: str

    def model_info(self) -> BackendInfo:
        """Identity of the engine: model id, revision, device, version."""
        ...

    def transcribe(self, source: ScoreInput) -> OMRResult:
        """Read the score. The result's raw output is preserved verbatim."""
        ...

    def supports_system_segmentation(self) -> bool:
        """Whether this backend exposes per-system crops (drives debug output)."""
        ...
