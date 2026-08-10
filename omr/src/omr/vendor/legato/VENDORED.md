# Vendored: LEGATO (v1) model code

- **Upstream**: https://github.com/guang-yng/legato — official codebase for
  "LEGATO: Large-scale End-to-end Generalizable Approach to Typeset OMR"
  (arXiv:2506.19065)
- **Commit**: `179c228d3d5f67113cf739b44891b3abe046f1dc` (vendored 2026-08-09)
- **License**: MIT (see `LICENSE.md`, copied verbatim from upstream)
- **Files copied**: `legato/models/` only — `configuration_legato.py`,
  `image_processing_legato.py`, `modeling_legato.py`, `processing_legato.py`,
  `models/__init__.py`. The upstream `trainer.py`, `config/`, `metrics/`,
  `scripts/`, and `utils/` are training/evaluation code and are NOT vendored.
- **Local modifications**: none. The files are byte-identical to upstream.
- **Why vendored**: upstream has no `pyproject.toml`/`setup.py`, so it cannot
  be pip-installed or pinned as a dependency. Copying the inference-relevant
  package (permitted by MIT) with a pinned commit is the reproducible option.
- **Pinned runtime**: `transformers==4.54.0`, `torch==2.6.0`,
  `numpy==1.26.4` (the `legato` optional-dependency group in
  `omr/pyproject.toml`) — matching upstream `requirements.txt`. A vendor
  refresh must revisit these pins together.
- **Checkpoint**: `guangyangmusic/legato` on Hugging Face (MIT, gated "auto"),
  pinned to revision `2d07c5d0e73186f2c0b12e35ea187bbc30dec18c` in
  `omr/src/omr/backends/legato_v1.py`.
