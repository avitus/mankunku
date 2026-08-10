# OMR subsystem (`omr/`)

A standalone Python subsystem that reads lead-sheet PDFs/images into a
symbolic transcription. It establishes **what is written** on the page;
musical interpretation (harmonic analysis, style, practice suggestions)
belongs to downstream consumers — eventually an LLM that receives the
symbolic transcription *alongside* the page image instead of being asked to
read pixels itself.

**Status**: transcription milestone only. Nothing in the SvelteKit app calls
this yet; the Claude-based `/api/tune-parse` import pipeline is untouched.
The intended engine — **LEGATO 2 — is not publicly released** (see
[legato2.md](legato2.md)); a clearly-labeled LEGATO **v1** backend exists for
experimentation, with a hard limitation: **it transcribes no text, so chord
symbols are absent from its output.**

## Architecture

```text
PDF / image  ─►  ingest (pdfium render / EXIF)  ─►  conservative preprocessing
                                                        │
                                              OMRBackend.transcribe()
                                                        │
                              OMRResult: raw ABC, verbatim, per page  ◄─ never edited
                                                        │
                              abc_parser (resilient)  ─►  normalize  ─►  validate
                                                        │
                              NormalizedScore (measures/chords/notes + warnings)
```

- `omr/src/omr/backends/base.py` — the `OMRBackend` protocol. Everything else
  (pipeline, CLI, benchmark) depends on this, never on a concrete engine, so
  OMR engines are swappable and comparable.
- `backends/legato_v1.py` — LEGATO v1 (temporary experimentation backend).
- `backends/legato2.py` — documented stub; raises until LEGATO 2 is released.
- `abc_parser.py` — resilient lead-sheet-subset ABC parser. Built for hostile
  input: an unlexable span costs one measure (kept verbatim in
  `raw_unparsed` + `UNPARSEABLE_REGION` warning), never the score.
- `normalize.py` — structural assembly, **zero inference**: absent info stays
  `None` (no default tempo, no guessed key, no filled-in chords).
- `validation.py` — deterministic checks (`MEASURE_DURATION_MISMATCH`,
  `EMPTY_PAGE`, `POSSIBLE_TRUNCATION`, …). Flags, never rewrites. No
  fabricated confidence numbers anywhere.
- `benchmark/` — fixtures + metrics usable identically for any backend.
- `vendor/legato/` — vendored MIT model code, pinned commit (see
  `VENDORED.md`).

Three layers stay reachable for every transcription (`TranscriptionBundle`):
the source image, the verbatim raw model output, and the normalized
representation — a wrong note is traceable back to pixels.

## Install

```sh
cd omr
uv sync                 # hermetic core: parsing, validation, benchmark math
uv sync --extra legato  # + torch/transformers for real LEGATO v1 inference
```

Python 3.12 (pinned in `.python-version`), uv-managed (`uv.lock`).

### Model access (one-time, for `--extra legato`)

Real inference needs access to **two** gated Hugging Face repos. The LEGATO
checkpoint (MIT, ~429MB) stores only the trained decoder + projection; its
**frozen vision encoder streams from Meta's separately-gated
`meta-llama/Llama-3.2-11B-Vision` repo at load time**. The complete
checklist — all steps required before the first run works:

1. Log in at https://huggingface.co (create an account if needed).
2. Open https://huggingface.co/guangyangmusic/legato → accept the
   conditions (gate mode "auto": approved instantly).
3. Open https://huggingface.co/meta-llama/Llama-3.2-11B-Vision → fill
   Meta's license form ("request access"). Approval usually lands within
   minutes-to-hours. Note: Meta does not license Llama 3.2 vision models in
   some regions (notably the EU).
4. Create a read token at https://huggingface.co/settings/tokens and run
   `omr/.venv/bin/hf auth login --token hf_...` (or `export HF_TOKEN=hf_...`).

Weights download once into the standard HF cache (`~/.cache/huggingface`,
`HF_HOME` respected) — the LEGATO decoder (~429MB) plus the encoder shards
from the meta-llama repo (several GB). Nothing model-sized ever lands in the
repo. A missing grant fails loudly with the exact URL to visit
(`_AUTH_HINT` / `_ENCODER_HINT` in `backends/legato_v1.py`).

## Hardware

- **CPU**: the default on Macs — works, slower (beam search over up to
  2,048 tokens). `--beams 1` trades accuracy for speed.
- **Apple Silicon (MPS)**: **broken on torch 2.6 — do not use.** Generation
  aborts the entire process (SIGABRT, `LLVM ERROR: Failed to infer result
  type(s)` in `mps.matmul` on the Mllama cross-attention; verified on a
  2023 Mac Studio, 2026-08-09). Because a process abort cannot be caught,
  `--device auto` never selects MPS; `--device mps` remains available for
  retesting after a torch upgrade, at your own risk.
- **CUDA**: upstream's tested path (CUDA 12.4); auto-selected when present.
- **Never the production droplet** (961MB RAM — `npm ci` alone has OOM-killed
  it). OMR inference is a local/dev tool; if it ever serves production it
  runs as a separate GPU service behind the same `OMRBackend` seam.

## CLI

```sh
cd omr
uv run python -m omr transcribe "../Leadsheets/PDF/Lady Bird.pdf"
uv run python -m omr transcribe chart.pdf --output out.json --raw
uv run python -m omr transcribe chart.pdf --debug          # artifact dir
uv run python -m omr transcribe chart.pdf --backend legato2  # exits 3: unreleased
uv run python -m omr transcribe chart.pdf --device cpu --beams 1 --pages 1
uv run python -m omr benchmark --backend legato_v1
```

Every run prints the engine identity to stderr:
`omr 0.1.0 · backend=legato_v1 · model=guangyangmusic/legato@<rev> · device=mps`.

Exit codes: `0` success (warnings allowed) · `2` bad input/arguments ·
`3` backend unavailable · `4` transcription failure.

## Output formats

The output JSON (`<stem>.omr.json`) contains:

- `result` — the **raw layer**: `raw_transcription` (verbatim ABC),
  `raw_pages[]` (per-page text + `token_count`), backend identity, backend
  warnings. Never modified by any downstream step.
- `normalized` — the **recognized layer**: title/composer/key/time/tempo
  (each `null` when not printed/recognized — never defaulted), and
  `measures[]` with `number`, `chords[]` (`raw` verbatim symbol + optional
  structural `parsed`), `notes[]` (`spelled_pitch` **as printed** — Db4 is
  never respelled to C#4 — plus derived `midi`, `onset`, `duration`,
  `tied_to_next`, `tuplet`, `is_rest`), repeats/endings/rehearsal marks,
  `raw_unparsed[]` spans, and per-measure warnings.
- `validation_warnings` — deterministic observations, never rewrites.

Durations/onsets are `[numerator, denominator]` fractions of a whole note
(`[1, 8]` = eighth), measured from the measure start — the same convention
as the app. The normalized shape is deliberately mappable to the app's PDF
extraction doc (`claudeJsonToTune`'s input), but is app-independent.

**Recognized vs inferred** is a hard boundary: this subsystem records only
what the OMR engine read off the page. If LEGATO reads `G7`, the stored raw
symbol is `G7` — not `G13`, not a scale, not a function. Interpretation
happens downstream, on top of this record, never inside it.

## Known limitations

- **LEGATO v1 transcribes no text**: titles, annotations, and **chord
  symbols** all become `<|text|>` placeholders (standing
  `TEXT_ELIDED_BY_MODEL` warning on every result; benchmark chord metrics
  will read ≈ 0 by design). Restoring chords is precisely the unreleased
  LEGATO 2 capability.
- Whole-page recognition with a 2,048-token output cap; dense pages risk
  tail truncation (`POSSIBLE_TRUNCATION` fires from real token counts).
- Out-of-domain caveat, now measured: despite classical/piano training data
  (PDMX-Synth), melody reading on clean typeset jazz charts is strong —
  94.8% MIDI pitch, 96.8% exact rhythm, 100% measure alignment on the
  first recorded benchmark ([baseline](benchmark-2026-08-09-legato-v1.md)).
  The dominant residual errors are enharmonic spelling slips. Scans/photos
  remain unmeasured (no scanned fixture yet).
- Multi-voice model output keeps the first voice (warned); grand-staff
  charts are out of scope.
- The current benchmark corpus is digital-born PDFs. The strongest case for
  pixel OMR is **scans/photos**, where the app's existing text-layer chord
  reading has nothing to read — a scanned fixture is a planned addition.

## Using a transcription in the app (hybrid import)

The PDF import page (`/tunes/import/pdf`) accepts an optional `.omr.json`
alongside the PDF:

```sh
cd omr && uv run python -m omr transcribe "../Leadsheets/PDF/Lady Bird.pdf"
# → lady-bird.omr.json — attach it via "OMR transcription (optional)" on the
#   import page, then pick the PDF as usual
```

Fusion rules (implemented in `src/lib/tunes/import/omr-transcription.ts`):
the OMR transcription supplies **melody** for every line it covers (those
lines never call the AI); the page's text layer keeps chord symbols, marks,
and endings; page geometry keeps bar counts; notehead evidence still flags
suspect bars for review. Lines the transcription can't cover fall back to
the AI reader — or stay blank for hand entry when no AI key is configured,
which makes OMR-assisted import work entirely offline.

Recorded result vs the MuseScore references (see the OMR family in
`tests/integration/pdf-vs-musescore.test.ts`): melody pitch agreement
0.89–1.0 (the AI reader's recorded floors: 0.5–0.6), chord sequences
0.96–1.0 with exact printed positions on two of three charts, and full
repeat/ending form strict-exact on Take the A Train.

## Benchmark

Ground truth lives in `omr/tests/benchmark/ground_truth/<slug>.json` —
hand-authorable JSON in **written pitch as printed** (see the format doc in
`omr/src/omr/benchmark/ground_truth.py`). Bootstrap ground truth from the
app's MuseScore fixtures (concert pitch) with:

```sh
uv run python -m omr.benchmark.convert_musescore \
    ../tests/fixtures/leadsheets/pdf-vs-musescore/lady-bird.musescore-import.json \
    tests/benchmark/ground_truth/lady-bird.json \
    --semitones 14 --source-pdf "Leadsheets/PDF/Lady Bird.pdf"
```

The 14 semitones is the tenor-sax rule: the printed parts sound a major
ninth below written, so written = concert + 14. **Converted files are marked
`"reviewed": false` until a human has checked them against the printed page**
(spelling choices especially); the report brands unreviewed charts
provisional. Metrics (each reported with its denominator): melody pitch
(strict-spelling and MIDI), accidental spelling, rhythm (onset+duration
exact, plus each alone), chord exact/root/quality/alterations + insertions,
measure alignment/count, key & time signature, repeat and rehearsal F1.

Reports (markdown + JSON twin) land in `omr/benchmark_results/<timestamp>/`
along with each chart's raw ABC and normalized JSON. Comparing a future
backend (LEGATO 2, anything else) = same fixtures, same metrics, one
`--backend` flag.

## Debugging a bad transcription

```sh
uv run python -m omr transcribe chart.pdf --debug
```

writes `omr/debug_runs/<stem>-<timestamp>/`:

```text
source.pdf            the original input
pages/page-001.png    exactly what the model saw (post-preprocessing)
raw/page-001.abc      verbatim model output per page
raw/full.abc          merged verbatim output
normalized.json       the structural reading
validation.json       deterministic warnings
run.json              backend/model/revision/device/timings/environment
```

`systems/` (per-system crops) appears only for backends that actually
segment; LEGATO v1 does not, and no artifacts are ever fabricated.

## Tests

```sh
uv run pytest                       # hermetic: no network, no model, fast
uv run pytest -m omr_integration    # opt-in: downloads checkpoint, real inference
```

CI runs the hermetic suite only, in a path-filtered job that triggers on
`omr/**` changes (`.circleci/continue-config.yml`, mirroring the
`nginx-changed` pattern). The repo's Vitest/Playwright suites are untouched
by and blind to this subsystem.
