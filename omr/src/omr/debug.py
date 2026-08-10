"""Debug artifact directory: every recognition step, inspectable.

Layout (per run):
    source.<ext>          original input, copied
    pages/page-NNN.png    rendered/preprocessed page images (1-based names)
    systems/...           per-system crops — ONLY if the backend actually
                          exposes segmentation; never fabricated
    raw/page-NNN.abc      verbatim per-page backend output
    raw/full.abc          verbatim merged output
    normalized.json       the normalized representation
    validation.json       deterministic validation warnings
    run.json              backend identity, timings, environment
"""

from __future__ import annotations

import json
import platform
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import omr
from omr.backends.base import OMRBackend

if TYPE_CHECKING:
    from omr.pipeline import TranscriptionBundle


def write_debug_artifacts(
    root: Path,
    bundle: TranscriptionBundle,
    backend: OMRBackend,
    timings: dict[str, float],
) -> Path:
    root.mkdir(parents=True, exist_ok=True)

    source_path = bundle.source.path
    shutil.copy2(source_path, root / f"source{source_path.suffix.lower()}")

    pages_dir = root / "pages"
    pages_dir.mkdir(exist_ok=True)
    for page in bundle.source.pages:
        page.image.save(pages_dir / f"page-{page.source_page + 1:03d}.png")

    raw_dir = root / "raw"
    raw_dir.mkdir(exist_ok=True)
    for raw_page in bundle.result.raw_pages:
        (raw_dir / f"page-{raw_page.page_index + 1:03d}.abc").write_text(raw_page.text)
    (raw_dir / "full.abc").write_text(bundle.result.raw_transcription)

    if backend.supports_system_segmentation():
        system_images = bundle.result.metadata.get("system_images", [])
        if system_images:
            systems_dir = root / "systems"
            systems_dir.mkdir(exist_ok=True)
            for name, image in system_images:
                image.save(systems_dir / name)

    (root / "normalized.json").write_text(
        json.dumps(bundle.normalized.to_dict(), indent=2, ensure_ascii=False)
    )
    (root / "validation.json").write_text(
        json.dumps([w.to_dict() for w in bundle.validation_warnings], indent=2)
    )
    (root / "run.json").write_text(
        json.dumps(
            {
                "omr_version": omr.__version__,
                "backend": bundle.result.backend.to_dict(),
                "source": str(source_path),
                "pages": [
                    {"index": p.index, "source_page": p.source_page, "dpi": p.dpi,
                     "size": list(p.image.size)}
                    for p in bundle.source.pages
                ],
                "timings": timings,
                "python": platform.python_version(),
                "platform": platform.platform(),
            },
            indent=2,
        )
    )
    return root
