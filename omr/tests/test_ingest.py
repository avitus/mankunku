"""Image/PDF ingestion routing tests — hermetic, all fixtures generated in tmp_path."""

from pathlib import Path

import pytest
from PIL import Image

from omr.errors import CorruptedInputError, UnsupportedInputError
from omr.ingest import load_score


def test_png_loads_as_single_page(tmp_path: Path) -> None:
    p = tmp_path / "chart.png"
    Image.new("RGB", (120, 80), "white").save(p)

    score = load_score(p)

    assert score.kind == "image"
    assert len(score.pages) == 1
    assert score.pages[0].index == 0
    assert score.pages[0].image.size == (120, 80)


def test_jpeg_exif_orientation_is_applied(tmp_path: Path) -> None:
    p = tmp_path / "rotated.jpg"
    img = Image.new("RGB", (10, 20), "white")
    exif = Image.Exif()
    exif[274] = 6  # stored image must be rotated 90° CW for display
    img.save(p, exif=exif)

    score = load_score(p)

    assert score.pages[0].image.size == (20, 10)


def test_unsupported_extension_raises(tmp_path: Path) -> None:
    p = tmp_path / "chart.txt"
    p.write_text("not a score")

    with pytest.raises(UnsupportedInputError, match="txt"):
        load_score(p)


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_score(tmp_path / "nope.png")


def test_truncated_image_maps_to_corrupted_input(tmp_path: Path) -> None:
    good = tmp_path / "good.png"
    Image.new("RGB", (600, 600), "white").save(good)
    data = good.read_bytes()
    bad = tmp_path / "bad.png"
    bad.write_bytes(data[: int(len(data) * 0.6)])  # header intact, data truncated

    with pytest.raises(CorruptedInputError):
        load_score(bad)


def test_non_positive_dpi_falls_back_to_default(tmp_path: Path) -> None:
    p = tmp_path / "zero-dpi.png"
    Image.new("RGB", (60, 60), "white").save(p, dpi=(0, 0))
    # PNG preserves a zero pHYs resolution; the loader must not record 0 dpi.
    assert load_score(p).pages[0].dpi == 72.0
