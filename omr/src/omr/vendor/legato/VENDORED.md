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
  `omr/src/omr/backends/legato_v1.py`. NOT self-contained: `modeling_legato.py`
  loads the frozen vision encoder from `meta-llama/Llama-3.2-11B-Vision`
  (separately gated, Llama 3.2 Community License) inside `from_pretrained`.
  The backend therefore resolves the pin via `snapshot_download` and loads
  from the local path — passing `revision=` to `from_pretrained` would
  propagate our revision into the meta-llama fetch, where it does not exist.
- **Known upstream quirks (not patched — files stay byte-identical)**:
  - `processing_legato.py` names its `_defaults` modality key `image_kwargs`;
    transformers' `ProcessingKwargs._merge_kwargs` expects `images_kwargs`, so
    the `max_image_tiles: 4` default is ignored and the processor default
    applies instead (harmless today — Mllama's own default is also 4).
  - Both processing modules guard invariants with bare `assert`, which
    vanishes under `python -O`/`PYTHONOPTIMIZE`. Accepted: this repo never
    runs the vendored code optimized.
  - `models/__init__.py` registers with string keys; under
    `transformers==4.54.0` config-type lookup wants `LegatoConfig` and
    `AutoModel._model_mapping` is private — class-name lookup still works,
    which is the path `from_pretrained` uses here.
  - `modeling_legato.py` checks `isinstance(outputs, typing.Tuple)`
    (deprecated as a runtime target; behaves as `tuple` today).
  - `modeling_legato.py`'s
  `save_pretrained` filters state-dict keys by the `vision_model.` prefix,
  but under the pinned `transformers==4.54.0` the encoder lives at
  `model.vision_model.`, so the filter matches nothing and a save would
  include the full encoder weights. This repo never calls `save_pretrained`
  (inference only), and the files stay byte-identical to upstream by policy
  — anyone fine-tuning from this vendored copy must fix the prefix (or
  filter on both) before saving checkpoints.
