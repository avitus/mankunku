# LEGATO 2 availability — findings and integration readiness

**Verdict (verified 2026-08-09): LEGATO 2 is published as a paper but its
code and weights have NOT been publicly released.** The `Legato2Backend`
in this repo is a documented stub; nothing here pretends otherwise, and
LEGATO 1 is never presented as LEGATO 2.

## The questions, answered

| Question | Answer |
|---|---|
| 1. Official LEGATO 2 source code available? | **No.** [github.com/guang-yng/legato](https://github.com/guang-yng/legato) implements LEGATO 1's whole-page inference only (last update 2026-02-22, before the LEGATO 2 paper). No LEGATO 2 repo exists on the author's profile. |
| 2. Official pretrained LEGATO 2 weights available? | **No.** Two undocumented, LEGATO-2-adjacent uploads exist (below) but neither is licensed or usable. |
| 3. Repository/model IDs containing them? | Closest artifacts: [`guangyangmusic/legato-1.5`](https://huggingface.co/guangyangmusic/legato-1.5) (0.9B params F32, `model_type: legato`, **gated: manual**, empty model card, uploaded 2026-02-13) and [`guangyangmusic/legato-1.5-YOLO`](https://huggingface.co/guangyangmusic/legato-1.5-YOLO) (bare `.pt`, matches the paper's YOLO segmentation stage). Neither is referenced by any code or paper. |
| 4. License? | **None declared** on either `legato-1.5` artifact — legally unusable regardless of the gate. (LEGATO 1's repo and checkpoint are MIT.) |
| 5. Runtime and hardware required? | Unknown for LEGATO 2 (unreleased). From the paper: YOLOv8-m (~26M) + a VLM with Llama-3.2-11B-Vision's frozen vision encoder and a 113.7M-trainable decoder; trained on 180 Nvidia L40 GPU-hours. Inference-hardware needs will be known only at release. |
| 6. Actual inference API? | Does not exist publicly. The paper describes system-conditioned autoregressive decoding (below); no released code implements it. |
| 7. Symbolic output format? | Per the paper: **ABC notation including embedded text** (titles, composers, inline annotations — hence chord symbols), via a text-aware BPE tokenizer with byte fallback, vocab 4,096. Emitted per system as "System-Level ABC", merged to standard ABC by a rule-based converter. |
| 8. Does the release include the system segmentation stage? | There is no release. The paper's stage: YOLOv8-medium finetuned from Jung et al.'s piano-score checkpoint on 1,024 annotated pages (mAP50 = 0.990, input 800px, boxes stretched to full page width). The `legato-1.5-YOLO` upload *looks* like that model but is unlicensed and undocumented. |

## Authoritative sources

- Paper: [arXiv:2607.05769](https://arxiv.org/abs/2607.05769) — "LEGATO 2:
  Toward Multimodal Sheet Music Recognition and Understanding", Guang Yang,
  Brian Siyuan Zheng, Victoria Ebert, Noah A. Smith (UW / AI2), v1 submitted
  2026-07-07, status "Preprint". The paper states verbatim: *"We will enable
  reproduction by releasing data and code upon publication."* No code or
  model URL appears anywhere in it.
- Code: [github.com/guang-yng/legato](https://github.com/guang-yng/legato)
  (LEGATO 1, MIT).
- Models: [huggingface.co/guangyangmusic](https://huggingface.co/guangyangmusic)
  — released: `legato` (MIT, 107M, gated auto), `legato-small`; unreleased-in-practice: `legato-1.5`, `legato-1.5-YOLO`.
- LEGATO 1 paper: [arXiv:2506.19065](https://arxiv.org/abs/2506.19065).

## The LEGATO 2 pipeline (paper facts, for whoever fills in the stub)

1. **System segmentation** — YOLOv8-m detects system bounding boxes per
   page; left/right edges stretched to the page, so the model only predicts
   top/bottom. Robustness ablation: even with artificially corrupted boxes
   the VLM degrades gracefully.
2. **Autoregressive recognition** — the VLM transcribes system *i*
   conditioned on the concatenated system-level ABC of systems *< i*,
   left-truncated to 1,024 tokens of a 2,048-token context. Architecture as
   LEGATO 1 (frozen Llama-3.2-11B-Vision encoder, small from-scratch
   decoder, 113.7M trainable), retrained with the text-aware tokenizer.
3. **ABC conversion** — a rule-based converter maps system-level ABC back to
   standard ABC; on ill-formed model output it iteratively discards
   terminal systems until the merge succeeds.
4. Inference selection: grid over repetition penalty {1.0, 1.1, 1.2} × beam
   {1, 2, 5, 10} on a validation set.
5. Results: page-level OMR-NED 17–44 across their eval sets (vs 28–58 for
   LEGATO 1); text CER 24.8 total; as context for frontier VLMs it lifts
   SSMR-Bench accuracy from 71.4 to 92.7 (Gemini 3.1 Pro).

## What is ours vs official

- **Ours**: the `omr/` subsystem — `OMRBackend` protocol, ingestion,
  preprocessing, resilient ABC parser, normalizer, validation, CLI, debug
  artifacts, benchmark harness, the `Legato2Backend` stub, and the
  `LegatoV1Backend` wrapper.
- **Official (vendored)**: `omr/src/omr/vendor/legato/models/` — LEGATO 1's
  model classes, byte-identical from MIT upstream at commit `179c228d`
  (provenance in `VENDORED.md`); checkpoint `guangyangmusic/legato` pinned
  to revision `2d07c5d0e73186f2c0b12e35ea187bbc30dec18c`.

## Definition of ready (to implement `Legato2Backend`)

All three, together:

1. Official LEGATO 2 inference code (system-conditioned decoding + the
   system-level-ABC merge) under an OSI license;
2. A licensed VLM checkpoint (watch for a documented, licensed
   `legato-2`-class model on the HF profile);
3. The segmentation model with license + integration code (or a documented
   replacement recipe).

When they exist: implement `transcribe()` per the pipeline sketch in
`backends/legato2.py`, set `supports_system_segmentation()` truthfully,
expose per-system crops in debug artifacts, re-run
`uv run python -m omr benchmark` on the identical fixtures, and compare
against the recorded LEGATO v1 report. The chord metrics are the headline:
they are ≈ 0 under v1 *by design* (text elision) and are exactly what the
text-aware tokenizer should restore.

## Watch list

- https://arxiv.org/abs/2607.05769 — publication/venue status ("upon
  publication" is the release trigger the authors named)
- https://github.com/guang-yng/legato — code release
- https://huggingface.co/guangyangmusic — weights release
- Optional accelerators: request access to the gated `legato-1.5` repo
  (manual approval by the author), and/or email the authors
  ({gyang1, nasmith}@cs.washington.edu per the paper) asking about the
  release timeline.

## Interim reality (LEGATO v1)

The stub's error message points users at `--backend legato_v1` for
experimentation. Its hard limits are documented in [README.md](README.md):
no text → **no chord symbols** (the exact capability this app needs most),
whole-page 2,048-token cap, classical training data. That gap is measured
by the benchmark, not hidden — and it is the concrete, quantified argument
for adopting LEGATO 2 when it ships.
