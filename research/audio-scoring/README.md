# Audio-domain lick comparison — research spike (2026-10-07)

**Question.** Lick scoring is note-based (readings → segmentation → DTW pairing
→ per-note pitch/rhythm). It is a recall measure: extra notes are free and one
false note can re-pair its neighbours. Would an additive signal computed
*in the audio domain* — comparing the recorded take with a rendering of the
expected lick — track "sounds correct" better, or usefully beside it?

**Status.** Research only. Nothing in `src/` imports this and nothing here
imports `src/` (two formulas are copied and cited at their use sites). The
verdict and numbers are in [REPORT.md](REPORT.md).

## Layout

- `harness/takes.py` — loads a take (WAV + diagnostic JSON) and its expected
  notes from `savedScore.noteResults[].expected`; `takes/expected-overrides.yaml`
  covers the four corpus takes without a saved score.
- `harness/render.py` — two renderings of the expected line: the app's own
  tenor samples (`static/samples/tenor-sax`, forte layer, tuning corrections
  parsed from `sample-maps.ts`) and a timbre-free harmonic tone.
- `harness/features.py` — band-pass, chroma, harmonic-salience semitone map,
  onset-strength envelope, pyin f0; "sounding" is gated on 250–5000 Hz (the
  segmenter's click-immune band) at −30 dB relative to the take.
- `harness/metrics.py` — M1 raw cross-correlation, M2 onset-envelope
  cross-correlation, M3 chroma similarity (no warp / banded DTW), M4 the same
  on the semitone map (register-aware), M5 frame-level pitch coverage
  (precision/recall/F1 of pyin frames against the expected piano roll).
- `harness/prod_import.py` / `harness/prod_eval.py <folder>` — pull and score
  production takes (E5); the evaluator runs own-lick scoring over any take
  folder (`prod`, `firefox`).
- `harness/firefox_import.py <idb copy>` — decode a Firefox profile's
  IndexedDB copy of `mankunku-audio[:uid]` (Snappy + SpiderMonkey structured
  clone, Blob payloads in `<db>.files/`) into `takes/firefox/`: every stored
  recording with its RecordingMetadata, which includes the lick-practice
  windows the cloud never sees.
- `harness/evaluate.py` — E1 discrimination (own lick vs transpositions and
  other licks), E2 agreement with the per-take truth, E3 named cases,
  E4 controlled perturbations. Writes `results/`.
- `harness/selftest.py` — invariants every metric must hold (self-similarity,
  lag recovery, semitone and octave sensitivity, cross-timbre, trailing extra).
- `harness/inspect_take.py <id>` — spectrogram + expected roll + f0 overlay.
- `takes/truth.yaml` — what each take actually sounded, as pinned by its
  fixture test; `takes/downloads/` — Andy's diagnostic exports that never
  became fixtures; `takes/prod/` — further production takes.

## Run

```sh
cd research/audio-scoring
uv sync                                   # uv-managed Python 3.12 (pyenv's lacks _lzma)
for f in ../../static/samples/tenor-sax/*.ogg; do   # decode the Opus samples once
  ffmpeg -v error -y -i "$f" -ac 1 -ar 48000 -f f32le "cache/tenor/$(basename "$f" .ogg).f32"; done
uv run python -m harness.selftest
uv run python -m harness.evaluate         # ~20 min, both renderers, E1–E4
uv run python -m harness.inspect_take 2026-10-06-fats-navarro-wail-a
```
