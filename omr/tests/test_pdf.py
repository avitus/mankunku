"""PDF rendering tests — multi-page PDFs generated at test time with Pillow."""

from pathlib import Path

import pytest
from PIL import Image

from omr.errors import CorruptedInputError
from omr.pdf import render_pdf


def _make_pdf(path: Path, colors: list[str], size: tuple[int, int] = (100, 140)) -> None:
    pages = [Image.new("RGB", size, c) for c in colors]
    pages[0].save(path, save_all=True, append_images=pages[1:])


def _dominant_channel(img: Image.Image) -> int:
    r, g, b = img.convert("RGB").getpixel((img.width // 2, img.height // 2))[:3]
    return max(range(3), key=lambda i: (r, g, b)[i])


def test_pages_render_in_order(tmp_path: Path) -> None:
    p = tmp_path / "three.pdf"
    _make_pdf(p, ["red", "green", "blue"])

    pages = render_pdf(p, dpi=72)

    assert [pg.index for pg in pages] == [0, 1, 2]
    assert [pg.source_page for pg in pages] == [0, 1, 2]
    assert [_dominant_channel(pg.image) for pg in pages] == [0, 1, 2]


def test_dpi_scales_output(tmp_path: Path) -> None:
    p = tmp_path / "one.pdf"
    _make_pdf(p, ["white"])

    at72 = render_pdf(p, dpi=72)[0]
    at300 = render_pdf(p, dpi=300)[0]

    assert at72.image.width == pytest.approx(100, abs=2)
    assert at300.image.width == pytest.approx(100 * 300 / 72, abs=6)
    assert at300.dpi == pytest.approx(300)


def test_max_side_caps_resolution(tmp_path: Path) -> None:
    p = tmp_path / "one.pdf"
    _make_pdf(p, ["white"])

    page = render_pdf(p, dpi=300, max_side=200)[0]

    assert max(page.image.size) <= 200
    # effective dpi is recorded, not the requested dpi
    assert page.dpi < 300


def test_corrupted_pdf_raises(tmp_path: Path) -> None:
    p = tmp_path / "bad.pdf"
    p.write_bytes(b"%PDF-1.4 this is not really a pdf")

    with pytest.raises(CorruptedInputError):
        render_pdf(p)
