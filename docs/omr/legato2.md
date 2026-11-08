# LEGATO 2 availability — findings and integration readiness

**Re-checked 2026-11-08: official LEGATO 2 weights and a segmenter are now published. This repository has not integrated or benchmarked them.** The August/September finding that no checkpoint existed is superseded.

The [official model card](https://huggingface.co/guangyangmusic/legato-2) documents `legato.pipeline.Legato2.from_pretrained(...)`. Its [file listing](https://huggingface.co/guangyangmusic/legato-2/tree/main) includes a 1.9 GB transcriber and 52 MB segmenter. The card identifies separate Llama 3.2 Community and AGPL-3.0 licenses. Access is gated.

The [public source tree](https://github.com/guang-yng/legato/tree/main/legato) checked on this date still has no `pipeline` module. A reproducible source revision matching the documented API, dependency set, access and fixture acceptance remain integration work. The local `Legato2Backend` raises an explicit “not integrated” error; LEGATO v1 is still the available experimental backend.

## Sources and next acceptance checks

- [Official model card](https://huggingface.co/guangyangmusic/legato-2) and [files](https://huggingface.co/guangyangmusic/legato-2/tree/main).
- [Official source](https://github.com/guang-yng/legato).
- [LEGATO 2 paper](https://arxiv.org/abs/2607.05769); the pipeline sketch below records the paper's design, not a tested local implementation.
- Before replacing the stub: pin matching source and both artifacts, establish the runtime, preserve raw output, and compare melody, form and chord results on this repository's fixtures.

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
  to revision `2d07c5d0e73186f2c0b12e35ea187bbc30dec18c`. The checkpoint is
  **not self-contained**: it stores only the trained decoder + projection,
  and `LegatoModel.from_pretrained` loads the frozen vision encoder from the
  separately-gated `meta-llama/Llama-3.2-11B-Vision` repo (Llama 3.2
  Community License) at run time — a second access grant every deployment
  needs, and a fact LEGATO 2 will likely inherit (same architecture family).

## Definition of ready (to implement `Legato2Backend`)

All three, together:

1. Official LEGATO 2 inference code (system-conditioned decoding + the
   system-level-ABC merge) under an OSI license;
2. A licensed VLM checkpoint (watch for a documented, licensed
   `legato-2`-class model on the HF profile);
3. The segmentation model with license + integration code (or a documented
   replacement recipe).

Once those inputs are verified together: implement `transcribe()` per the pipeline sketch in
`backends/legato2.py`, set `supports_system_segmentation()` truthfully,
expose per-system crops in debug artifacts, re-run
`uv run python -m omr benchmark` on the identical fixtures, and compare
against the recorded LEGATO v1 report. The chord metrics are the headline:
they are ≈ 0 under v1 *by design* (text elision) and are exactly what the
text-aware tokenizer should restore.

## Follow-up sources

Track the [official source](https://github.com/guang-yng/legato) for the documented pipeline module and the [model repository](https://huggingface.co/guangyangmusic/legato-2) for versioned artifacts. The old suggestion to seek undocumented `legato-1.5` weights is superseded.

## Milestone report: the proven inference path (2026-08-09)

The "first deliverable" facts, measured on real hardware with the real model:

- **Repository**: [github.com/guang-yng/legato](https://github.com/guang-yng/legato), vendored at commit `179c228d3d5f67113cf739b44891b3abe046f1dc` (MIT).
- **Checkpoint**: `guangyangmusic/legato` @ `2d07c5d0e73186f2c0b12e35ea187bbc30dec18c` (MIT, gated auto) — decoder + projection only (429MB); the frozen vision encoder streams from the gated `meta-llama/Llama-3.2-11B-Vision` repo (≈20GB repo download; loaded model is 0.94B params total in F32, ≈3.6GB peak RSS).
- **Runtime**: Python 3.12.2, torch 2.6.0, transformers 4.54.0, macOS (2023 Mac Studio).
- **Hardware used**: **CPU** — ≈36s per lead-sheet page (300 DPI, beam 5). MPS is unusable on torch 2.6: generation aborts the process (SIGABRT, `LLVM ERROR` in `mps.matmul` on Mllama cross-attention), so device auto-selection never picks it. CUDA untested here (no NVIDIA hardware) but is upstream's tested path.
- **Input**: 300-DPI lossless PNG renders of the PDF page (pypdfium2), conservative preprocessing only.
- **Output**: ABC notation, verbatim-preserved; per-page token counts recorded (Lady Bird page 1: well under the 2,048 cap, no truncation).
- **Transcription quality** (3-chart benchmark, [full report](benchmark-2026-08-09-legato-v1.md)): melody pitch **94.8%** (MIDI) / 87.0% (strict spelling incl. octave), accidental spelling 91.7%, rhythm (exact onset+duration) **96.8%**, measure alignment **100%** (73/73 measures), key and time signature **100%**, printed repeat structure **F1 1.0** (A-Train's `:|` + both endings read exactly). All charts: zero measure-count errors, zero validation warnings.
- **Limitations, observed**: chord symbols **0/60** and rehearsal marks 0.0 — every text span became `<|text|>`, precisely as the LEGATO 2 paper documents for v1. This is the measured, quantified argument for LEGATO 2: on clean typeset jazz charts v1's *melody* reading is already strong (the out-of-domain concern did not materialize there, even with the corpus PDFs' colored practice-highlight boxes), and the entire remaining gap is text — the exact capability the text-aware tokenizer is intended to add. Enharmonic slips (Db-vs-C# class errors) account for most of the strict-vs-MIDI pitch spread.

The 2026-11-08 maintenance run retained the Lady Bird baseline with updated
PyTorch, NumPy, Accelerate and the Transformers 4.54 patch release in an
isolated Linux CPU VM. Newer Transformers 4.57.6 and 5.22.2 produced an extra
measure and poorer rhythm accuracy, so those candidates were rejected. See
the [maintenance audit](../maintenance/2026-11-08-audit.md) for current pins,
remaining advisories and the limited scope of this one-chart acceptance.

## Interim reality (LEGATO v1)

The stub's error message points users at `--backend legato_v1` for
experimentation. Its hard limits are documented in [README.md](README.md):
no text → **no chord symbols** (the exact capability this app needs most),
whole-page 2,048-token cap, classical training data. That gap is measured
by the benchmark, not hidden — and it is the concrete, quantified argument
for evaluating the published LEGATO 2 artifacts once their inference package is available and integrated.

v1 is also what the app's hybrid PDF import consumes today (since
2026-08-10): its **melody** only, with chord symbols, marks and endings read
from the PDF's text layer. That split works for digital-born PDFs; a scan
or photo has no text layer, so there the missing chords are exactly the
LEGATO 2 gap.
