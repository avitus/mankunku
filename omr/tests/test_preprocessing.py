"""Conservative preprocessing tests.

The invariant under test: preprocessing may trim empty margins and upscale,
but must never destroy fine notation detail (isolated dark pixels survive,
bit depth is preserved, and nothing is ever downscaled or binarized).
"""

from fractions import Fraction  # noqa: F401  (documents the app-wide convention)

from PIL import Image

from omr.models import PageImage
from omr.preprocessing import preprocess_page


def _page(img: Image.Image, dpi: float = 300.0) -> PageImage:
    return PageImage(index=0, image=img, dpi=dpi, source_page=0)


def test_trim_removes_large_white_margins_but_keeps_safety_margin() -> None:
    img = Image.new("L", (1000, 1000), 255)
    # content block well inside the page
    for x in range(400, 600):
        for y in range(450, 550):
            img.putpixel((x, y), 0)

    out = preprocess_page(_page(img), min_short_side=0).image

    assert out.width < 1000 and out.height < 1000
    # safety margin retained: content must not touch the trimmed edge
    assert out.getpixel((0, 0)) == 255


def test_trim_preserves_isolated_dark_pixel_near_content_edge() -> None:
    img = Image.new("L", (1000, 1000), 255)
    for x in range(400, 600):
        img.putpixel((x, 500), 0)
    img.putpixel((380, 500), 0)  # an isolated staccato-dot-like pixel

    out = preprocess_page(_page(img), min_short_side=0).image

    assert 0 in [out.getpixel((x, y)) for x in range(out.width) for y in range(out.height)]
    # count survives exactly: nothing erased
    dark = sum(1 for x in range(out.width) for y in range(out.height) if out.getpixel((x, y)) == 0)
    assert dark == 201


def test_trim_refused_when_content_touches_edge() -> None:
    img = Image.new("L", (300, 300), 255)
    for y in range(300):
        img.putpixel((0, y), 0)  # content at the left edge — scan cut off

    out = preprocess_page(_page(img), min_short_side=0).image

    assert out.size == (300, 300)


def test_small_image_is_upscaled_and_dpi_adjusted() -> None:
    img = Image.new("L", (600, 800), 255)

    out = preprocess_page(_page(img, dpi=100.0), trim=False, min_short_side=1200)

    assert min(out.image.size) >= 1200
    assert out.dpi > 100.0


def test_large_image_is_not_downscaled() -> None:
    img = Image.new("L", (2000, 2800), 255)

    out = preprocess_page(_page(img, dpi=300.0), trim=False, min_short_side=1200)

    assert out.image.size == (2000, 2800)
    assert out.dpi == 300.0


def test_grayscale_mode_preserved() -> None:
    img = Image.new("L", (1400, 1400), 255)

    out = preprocess_page(_page(img)).image

    assert out.mode == "L"


def test_midtones_are_not_binarized() -> None:
    # The module invariant says pixels are never binarized — enforce it with
    # actual mid-tone values, which a thresholding step would destroy.
    img = Image.new("L", (1400, 1400), 255)
    for i, level in enumerate((64, 128, 192)):
        img.putpixel((700 + i, 700), level)

    out = preprocess_page(_page(img), trim=False, min_short_side=0).image

    assert sorted(set(out.getdata())) == [64, 128, 192, 255]


def test_blank_page_is_returned_untouched() -> None:
    page = _page(Image.new("L", (1400, 1400), 255))
    assert preprocess_page(page) is page


def test_colour_page_keeps_its_mode_after_trimming() -> None:
    # The corpus PDFs carry coloured practice-highlight boxes; the content
    # mask is computed in grayscale, but the page itself is never converted.
    img = Image.new("RGB", (1400, 1400), "white")
    for x in range(600, 800):
        for y in range(600, 700):
            img.putpixel((x, y), (200, 30, 30))

    out = preprocess_page(_page(img), min_short_side=0).image

    assert out.mode == "RGB"
    assert out.width < 1400 and out.height < 1400
