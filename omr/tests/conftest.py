"""Shared hermetic fixtures: a FakeBackend and generated score files."""

from pathlib import Path

import pytest
from PIL import Image

from omr.models import BackendInfo, OMRResult, RawPage, ScoreInput

FAKE_ABC = """X:1
T:Fake Tune
M:4/4
L:1/8
K:C
"C" C2 E2 G2 E2 | "G7" D2 F2 A2 F2 |]
"""


class FakeBackend:
    """Protocol-satisfying backend returning a fixed ABC string. No models."""

    name = "fake"

    def __init__(self, abc: str = FAKE_ABC, fail: bool = False) -> None:
        self._abc = abc
        self._fail = fail

    def model_info(self) -> BackendInfo:
        return BackendInfo(
            name=self.name,
            model_id="fake/model",
            revision="0000000",
            version="0.0.0",
            device="cpu",
        )

    def transcribe(self, source: ScoreInput) -> OMRResult:
        if self._fail:
            raise RuntimeError("fake backend failure")
        pages = [
            RawPage(page_index=p.index, text=self._abc if p.index == 0 else "")
            for p in source.pages
        ]
        return OMRResult(
            raw_transcription=self._abc,
            format="abc",
            raw_pages=pages,
            backend=self.model_info(),
            warnings=[],
            metadata={"source": str(source.path)},
        )

    def supports_system_segmentation(self) -> bool:
        return False


@pytest.fixture
def fake_backend() -> FakeBackend:
    return FakeBackend()


@pytest.fixture
def png_score(tmp_path: Path) -> Path:
    p = tmp_path / "score.png"
    Image.new("RGB", (200, 150), "white").save(p)
    return p


@pytest.fixture
def pdf_score(tmp_path: Path) -> Path:
    p = tmp_path / "score.pdf"
    pages = [Image.new("RGB", (200, 280), "white") for _ in range(2)]
    pages[0].save(p, save_all=True, append_images=pages[1:])
    return p
