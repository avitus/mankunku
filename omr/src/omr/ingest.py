"""Input routing: a path becomes a ScoreInput with rendered pages in order."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from omr.errors import CorruptedInputError, UnsupportedInputError
from omr.models import PageImage, ScoreInput

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}


def load_score(path: Path, *, dpi: float = 300.0, max_side: int = 4096) -> ScoreInput:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    ext = path.suffix.lower()
    if ext == ".pdf":
        from omr.pdf import render_pdf  # local import: keeps image-only use pdfium-free

        pages = tuple(render_pdf(path, dpi=dpi, max_side=max_side))
        return ScoreInput(path=path, kind="pdf", pages=pages)

    if ext in IMAGE_EXTENSIONS:
        return ScoreInput(path=path, kind="image", pages=(_load_image_page(path),))

    raise UnsupportedInputError(
        f"unsupported input type '{ext.lstrip('.') or path.name}': "
        "expected .png, .jpg, .jpeg, or .pdf"
    )


def _load_image_page(path: Path) -> PageImage:
    try:
        with Image.open(path) as img:
            # Apply EXIF orientation so a phone photo arrives upright.
            upright = ImageOps.exif_transpose(img)
            upright.load()
    except UnidentifiedImageError as e:
        raise CorruptedInputError(f"cannot decode image {path.name}: {e}") from e

    dpi_pair = upright.info.get("dpi")
    dpi = float(dpi_pair[0]) if dpi_pair else 72.0
    return PageImage(index=0, image=upright, dpi=dpi, source_page=0)
