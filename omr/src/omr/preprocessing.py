"""Conservative page preprocessing.

Only operations that cannot erase notation detail are allowed here:
whitespace-margin trimming (with a retained safety margin and a refusal
when content touches the page edge) and upscale-only resolution
normalization. Deliberately NO binarization, deskew, denoise, or any
filter that could eat accidentals, augmentation dots, articulation
marks, chord-symbol glyphs, or thin staff lines.
"""

from __future__ import annotations

from PIL import Image

from omr.models import PageImage

# Pixels at or above this luminance count as background.
BACKGROUND_THRESHOLD = 245
# Fraction of the page dimension retained around detected content when trimming.
SAFETY_MARGIN = 0.02


def preprocess_page(
    page: PageImage, *, trim: bool = True, min_short_side: int = 1200
) -> PageImage:
    image = page.image
    dpi = page.dpi

    if trim:
        image = _trim_margins(image)

    if min_short_side and min(image.size) < min_short_side:
        factor = min_short_side / min(image.size)
        image = image.resize(
            (round(image.width * factor), round(image.height * factor)),
            resample=Image.Resampling.LANCZOS,
        )
        dpi = dpi * factor

    if image is page.image and dpi == page.dpi:
        return page
    return PageImage(index=page.index, image=image, dpi=dpi, source_page=page.source_page)


def _trim_margins(image: Image.Image) -> Image.Image:
    gray = image if image.mode == "L" else image.convert("L")
    # Content mask: anything darker than near-white.
    mask = gray.point(lambda v: 255 if v < BACKGROUND_THRESHOLD else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return image  # blank page: nothing to anchor a trim on

    left, top, right, bottom = bbox
    # Content touching any edge suggests an already-cropped or cut-off scan;
    # trimming would risk eating real content. Refuse.
    if left == 0 or top == 0 or right == image.width or bottom == image.height:
        return image

    margin_x = round(image.width * SAFETY_MARGIN)
    margin_y = round(image.height * SAFETY_MARGIN)
    crop = (
        max(0, left - margin_x),
        max(0, top - margin_y),
        min(image.width, right + margin_x),
        min(image.height, bottom + margin_y),
    )
    if crop == (0, 0, image.width, image.height):
        return image
    return image.crop(crop)
