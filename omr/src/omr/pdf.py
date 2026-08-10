"""PDF page rendering via pypdfium2 — lossless, order-preserving."""

from __future__ import annotations

from pathlib import Path

import pypdfium2 as pdfium

from omr.errors import CorruptedInputError
from omr.models import PageImage

POINTS_PER_INCH = 72.0


def render_pdf(path: Path, *, dpi: float = 300.0, max_side: int = 4096) -> list[PageImage]:
    """Render every page at ``dpi``, capping the longest side at ``max_side``.

    The recorded ``PageImage.dpi`` is the *effective* resolution after the
    cap, so downstream consumers can always map pixels back to page space.
    """
    try:
        doc = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as e:
        raise CorruptedInputError(f"cannot open PDF {Path(path).name}: {e}") from e

    try:
        pages: list[PageImage] = []
        for i in range(len(doc)):
            page = doc[i]
            width_pt, height_pt = page.get_size()
            scale = dpi / POINTS_PER_INCH
            longest_pt = max(width_pt, height_pt)
            if longest_pt * scale > max_side:
                scale = max_side / longest_pt
            try:
                bitmap = page.render(scale=scale)
                image = bitmap.to_pil()
            except pdfium.PdfiumError as e:
                raise CorruptedInputError(
                    f"cannot render page {i + 1} of {Path(path).name}: {e}"
                ) from e
            pages.append(
                PageImage(index=i, image=image, dpi=scale * POINTS_PER_INCH, source_page=i)
            )
        return pages
    finally:
        doc.close()
