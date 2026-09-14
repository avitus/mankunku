# OMR subsystem (`omr/`)

A standalone Python subsystem that reads lead-sheet PDFs/images into a
symbolic transcription. It establishes **what is written** on the page;
musical interpretation (harmonic analysis, style, practice suggestions)
belongs to downstream consumers — eventually an LLM that receives the
symbolic transcription *alongside* the page image instead of being asked to
read pixels itself.

**Status**: standalone OMR subsystem with an optional SvelteKit hybrid
import (shipped 2026-08-10): `/tunes/import/pdf` accepts a `.omr.json`
produced by `python -m omr transcribe` and bypasses `/api/tune-parse` for the
systems it covers (uncovered systems still fall back to Claude). Nothing else
in the app calls this subsystem.
The intended engine — **LEGATO 2 — is not publicly released** (re-checked
2026-09-10; see [legato2.md](legato2.md)); a clearly-labeled LEGATO **v1**
backend exists for experimentation, with a hard limitation: **it transcribes
no text, so chord symbols are absent from its output.**

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
  `raw_unparsed` + `UNPARSEABLE_REGION` warning), never the score. A quoted
  string after the last note or rest is kept verbatim in an
  `UNANCHORED_STRING` warning — deliberately not attached to the previous
  note, which would put a chord at the wrong onset. Broken rhythms honour
  their depth per ABC 2.1 (`>` = 3/2 + 1/2, `>>` = 7/4 + 1/4, `>>>` =
  15/8 + 1/8, `<` mirrored; a longer run leaves both notes as written and
  warns `BROKEN_RHYTHM_UNDEFINED`), and `(5`, `(7`, `(9` printed without a
  ratio take the meter-aware default — in the time of 3 under 6/8, 9/8 or
  12/8, of 2 otherwise. Whitespace around a broken-rhythm marker doesn't
  matter (`C > D` = `C>D`, as in the standard's own `[CEG]- > [CEG]`); a
  marker whose bar closes before the next note pairs nothing and warns
  `UNPARSEABLE_REGION`, and LEGATO's `<|text|>` placeholder is never read as
  a marker. A chord cluster keeps its TOP note's pitch and its FIRST note's
  length (ABC 2.1 §4.17), times any suffix after the bracket. A malformed
  tuplet (`(0`, `(3:0`) costs its measure, never the parse. Not yet read —
  each costs its measure with a warning rather than a guess: a grace note or
  a closing slur between a note and its broken-rhythm marker (`A{g}<A`,
  `(CD) > E`) and the single-letter decoration shorthands (`H`, `T`, …).
- `normalize.py` — structural assembly, **zero inference**: absent info stays
  `None` (no default tempo, no guessed key, no filled-in chords).
- `validation.py` — deterministic checks (`MEASURE_DURATION_MISMATCH`,
  `EMPTY_PAGE`, `POSSIBLE_TRUNCATION`, …). Flags, never rewrites. No
  fabricated confidence numbers anywhere. A short first measure is a
  plausible pickup only when more measures follow it (a lone short measure
  is a misread), and a short final measure is exempt only when it and the
  pickup sum to exactly one bar — the same rule as the app's
  `omr-transcription.ts`.
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
- **Never the production droplet** (4GB RAM + 2GB swap since the 2026-09-08
  move; a CPU run peaks near 3.6GB RSS after a ≈20GB encoder download, on a
  box that is busy serving the app). OMR inference is a local/dev tool; if it
  ever serves production it runs as a separate GPU service behind the same
  `OMRBackend` seam.

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
`omr 0.1.0 · backend=legato_v1 · model=guangyangmusic/legato@<rev> · device=cpu`.

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
suspect bars for review. The file is validated as untrusted input, its flat
measure list is sliced into systems by the geometry's bar counts, and its
whole-note fractions are converted to beats of the meter the user declares
on the page before uploading — a measure-count mismatch is warned and the
systems past it fall back. Lines the transcription can't cover fall back to
the AI reader — or stay blank for hand entry when no AI key is configured,
so OMR-assisted import works with no AI key at all.

**Pickups** (2026-09-10) reach the chart exactly as a MuseScore import's do:
`TuneSection.pickupLength`, engraved as a short partial bar. A short *first*
measure with more measures after it is the anacrusis — right-aligned into a
full bar so downbeats stay downbeats, its printed length carried as
`ModelBar.pickupBeats`. A short *later* measure is flagged for review
("fills n of 4 beats — check the rhythm") unless it is the final measure and
complements the pickup to exactly one bar; a lone short measure is never a
pickup. LEGATO's own habit — a full first measure with the anacrusis behind a
leading rest — is caught downstream by `pdf-system-assemble.ts`, which also
treats a first bar whose melody starts in the back half of the meter as a
pickup. The recorded Donna Lee run (`omr/Donna Lee - Bb.omr.json`, fixture
copy `tests/fixtures/leadsheets/omr/donna-lee.omr.json`) pins that path end
to end in `tests/unit/tunes/omr-fusion-assemble.test.ts`: `pickupLength`
`[1, 2]` on the opening section.

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
uv run pytest -m omr_integration    # opt-in: real inference — needs the `legato` extra
                                    # and HF access to BOTH gated repos (see Model access)
```

The default run excludes the marker (`addopts` in `pyproject.toml`). CI runs
the hermetic suite plus `uv run ruff check src tests` — never the `legato`
extra, never a model, no HF token — in the `omr-test` job of
`.circleci/continue-config.yml`, which fires on any branch only when `omr/**`
(or `.circleci/**`) changed; the path filter is the `omr-changed` parameter
in `.circleci/config.yml`, mirroring `nginx-changed`. The Python suite runs
separately from the app's tests; on the app side, the hybrid `.omr.json`
import path has its own Vitest coverage (`tests/unit/tunes/omr-*.test.ts`,
`pdf-vs-musescore`'s OMR family) and an env-gated Playwright fixture recorder
(`RECORD_OMR_FIXTURES=1 npx playwright test record-omr-fixtures
--project=chromium`), so CI never rewrites fixtures.
