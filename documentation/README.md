# Mankunku Documentation

Mankunku is a jazz ear training web app built around **call and response**: the app plays a phrase, you play it back on your instrument, and it scores your pitch and rhythm accuracy.

Named after [Winston "Mankunku" Ngozi's](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) iconic 1968 album *Yakhal' Inkomo*, this app targets jazz musicians practicing ear training, transcription, and improvisation vocabulary.

> **Last major docs update: 2026-07-14** — synced docs to reflect two features that landed after the 2026-06-23 sync: **entry-staff note selection** — click a notehead or step with ←/→ to select any pitched note, then ↑/↓ to pitch-shift, Backspace/Delete to delete, or `\` to flip its spelling in place (new `phraseToAbcWithMap` / `PitchedNoteAnchor` in `notation.ts`; `selectedNoteIndex` + `selectNote` / `deleteSelectedNote` / `adjustSelectedNotePitch` / `flipSelectedNoteSpelling` in step-entry state; `selectedIndex` / `onSelect` props on `NotationDisplay`); and the Side B **end-of-lick score-hold + ii-V transition cue** — the finished lick's last-key score dot (and all-clear brass glow) now holds on screen for a bar before a mode-matched ii-V comps into the next lick's key (`getTransitionCadenceChords` in `progressions.ts`, `playTransitionChords` in `backing-track.ts`).
>
> **2026-06-23** — soprano sax as a first-class instrument; the library refocus on the user's own practice book (`needsSetup` / `practiceSet` / `otherLicks`); per-lick **Reset progress** action; tighter Side B advancement gates (green ≥ 0.90, yellow 0.75–0.89, red < 0.75, with a single red key blocking tempo bumps and unlocks); Daily Practice mode; single-lick Deep Practice now respecting per-lick unlocks and deriving its progression from the chosen lick; explicit `prog:*` opt-in; step-entry lick editing; history derive-on-write; metronome-bleed suppression; and the same-pitch / octave-lock / re-articulation segmentation passes. Previous major update was 2026-05-09 (the rewrite-for-musicians pass).

## Quick Links

| Section | Description |
|---|---|
| [Getting Started](./getting-started.md) | For players: what the app does, what you need, your first session |
| [User Guide](./user-guide.md) | How to use the app: practice, library, progress, settings |
| [Development Setup](./contributing/contributing.md#development-setup) | For developers: prerequisites, install, first run, local Supabase stack |

### Architecture

| Document | Description |
|---|---|
| [Overview](./architecture/overview.md) | High-level system design and component diagram |
| [Tech Stack](./architecture/tech-stack.md) | Technology choices and rationale |
| [Data Model](./architecture/data-model.md) | Core TypeScript types with field documentation |
| [Audio Pipeline](./architecture/audio-pipeline.md) | Playback, capture, detection, segmentation |
| [Scoring Algorithm](./architecture/scoring-algorithm.md) | DTW alignment, pitch/rhythm scoring, grading |
| [Phrase System](./architecture/phrase-system.md) | Library, generation, mutation, validation |
| [Lick Alignment](./architecture/lick-alignment.md) | Per-progression placement, `pickupBars`, tail extension, auto-inference |
| [Adaptive Difficulty](./architecture/adaptive-difficulty.md) | Algorithm, leveling (1-100), difficulty profiles |
| [Tonality System](./architecture/tonality-system.md) | Daily key/scale selection, progressive unlocking |
| [State Management](./architecture/state-management.md) | Svelte 5 runes, state modules, persistence |

### API Reference

| Document | Description |
|---|---|
| [Audio](./api-reference/audio.md) | audio-context, playback, capture, pitch-detector, onset-detector, note-segmenter, metronome |
| [Scoring](./api-reference/scoring.md) | alignment, pitch-scoring, rhythm-scoring, scorer, grades |
| [Music](./api-reference/music.md) | scales, chords, keys, intervals, notation, transposition |
| [Phrases](./api-reference/phrases.md) | generator, mutator, validator, library-loader |
| [Difficulty](./api-reference/difficulty.md) | adaptive, params |
| [State](./api-reference/state.md) | session, settings, progress, history, library, lick-practice, step-entry state modules |
| [Components](./api-reference/components.md) | All Svelte components and route pages |

### Contributing

| Document | Description |
|---|---|
| [Contributing Guide](./contributing/contributing.md) | Workflow, branch naming, PR process, code style |
| [Adding Licks](./contributing/adding-licks.md) | Step-by-step guide to adding curated licks |
| [Adding Scales](./contributing/adding-scales.md) | Extending the scale catalog |
| [Testing Guide](./contributing/testing-guide.md) | Test patterns, mocking audio, writing new tests |

### Reference

| Document | Description |
|---|---|
| [Glossary](./reference/glossary.md) | Jazz, audio, and technical terminology |
| [Algorithm Details](./reference/algorithm-details.md) | DTW math, spectral flux, McLeod pitch method |
| [Browser Compatibility](./reference/browser-compatibility.md) | Web Audio API support, PWA, mobile caveats |
| [Scale & Lick Catalog](./reference/scale-and-lick-catalog.md) | All 35 scales + ~250 lick library (curated + combinatorial) with metadata |
