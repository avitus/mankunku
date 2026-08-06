# Mankunku Documentation

Mankunku is a jazz ear training web app built around **call and response**: the app plays a phrase, you play it back on your instrument, and it scores your pitch and rhythm accuracy.

Named after [Winston "Mankunku" Ngozi's](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) iconic 1968 album *Yakhal' Inkomo*, this app targets jazz musicians practicing ear training, transcription, and improvisation vocabulary.

> **Last major docs update: 2026-08-01** — synced docs to the **tune half of the app**, which had grown without documentation since the 2026-07-26 pass. New player-facing pages [Your Tunes](./tunes.md) and [Playing Over Tunes](./tune-practice.md) (both surfaced in `/docs` and bundled into the docs assistant's context); new [Tune System](./architecture/tune-system.md) developer doc covering flatten's two timelines, the five importers, engraving, progression detection, mastery-aware lick matching, and session planning. Also: `overview.md` reframed around three practice surfaces rather than two; the audio pipeline's five-tier re-articulation detection and band-limited metronome-bleed handling written up (user-facing and in the audio API reference); `PitchReading`'s four envelope/timbre fields documented; Tune and lick-practice types added to the data model; tune, tune-practice, console, and tour components added to the component reference; `tuneToAbc` and the chart/chord/ending layout modules added to the music reference; new guided tours for Tunes and Tune Practice. Corrected two stale claims: the app is installable but has **no service worker** (so no offline page loads), and the bleed filter has **no Settings toggle**.
>
> **2026-07-26** — the Tunes / Licks restructure (routes, storage, and nomenclature moved off "lead sheets"), the tune editor's entry rail, and the deploy/PWA overhaul.
>
> **2026-07-14** — entry-staff note selection (click a notehead or step with ←/→, then ↑/↓ / Backspace / `\`); the Side B end-of-lick score-hold + ii-V transition cue.
>
> **2026-06-23** — soprano sax as a first-class instrument; the Licks-page refocus on the user's own book; per-lick **Reset progress**; tighter Side B advancement gates (green ≥ 0.90, yellow 0.75–0.89, red < 0.75); Daily Practice mode; explicit `prog:*` opt-in; in-editor lick editing; history derive-on-write. Previous major update was 2026-05-09 (the rewrite-for-musicians pass).

## Quick Links

| Section | Description |
|---|---|
| [Getting Started](./getting-started.md) | For players: what the app does, what you need, your first session |
| [User Guide](./user-guide.md) | How to use the app: practice, your licks, progress, settings |
| [Your Tunes](./tunes.md) | For players: building a songbook — charting, importing, adopting |
| [Playing Over Tunes](./tune-practice.md) | For players: the scored session over a real form |
| [Development Setup](./contributing/contributing.md#development-setup) | For developers: prerequisites, install, first run, local Supabase stack |

### Architecture

| Document | Description |
|---|---|
| [Overview](./architecture/overview.md) | The three practice surfaces and how a phrase travels through the app |
| [Tech Stack](./architecture/tech-stack.md) | Technology choices and rationale |
| [Data Model](./architecture/data-model.md) | Core TypeScript types with field documentation |
| [Audio Pipeline](./architecture/audio-pipeline.md) | Playback, capture, detection, segmentation, re-articulation tiers |
| [Scoring Algorithm](./architecture/scoring-algorithm.md) | DTW alignment, pitch/rhythm scoring, grading |
| [Trick Scoring](./architecture/trick-scoring.md) | Conformance tiers, fluency weighting, per-device slot philosophy |
| [Phrase System](./architecture/phrase-system.md) | Catalog, generation, mutation, validation |
| [Tune System](./architecture/tune-system.md) | Tune model, flatten timelines, importers, engraving, progression detection, lick matching, session planning |
| [Lick Alignment](./architecture/lick-alignment.md) | Per-progression placement, `pickupBars`, tail extension, auto-inference |
| [Adaptive Difficulty](./architecture/adaptive-difficulty.md) | Algorithm, leveling (1-100), difficulty profiles |
| [Tonality System](./architecture/tonality-system.md) | Daily key/scale selection, progressive unlocking |
| [State Management](./architecture/state-management.md) | Svelte 5 runes, state modules, persistence |
| [Design System](./architecture/design-system.md) | Colour, type, domain accents, shared UI recipes |

### API Reference

| Document | Description |
|---|---|
| [Audio](./api-reference/audio.md) | audio-context, playback, capture, pitch-detector/pitch-frame, onset-detector, note-segmenter, metronome |
| [Scoring](./api-reference/scoring.md) | alignment, pitch-scoring, rhythm-scoring, scorer, grades |
| [Music](./api-reference/music.md) | scales, chords, keys, intervals, notation, tune-notation, chart/chord/ending layout, chord-symbol, transposition |
| [Phrases](./api-reference/phrases.md) | generator, mutator, validator, library-loader |
| [Difficulty](./api-reference/difficulty.md) | adaptive, params |
| [State](./api-reference/state.md) | session, settings, progress, history, licks, lick-practice, step-entry, tune-entry, tune-community, tune-practice, tour state modules |
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
| [Scale & Lick Catalog](./reference/scale-and-lick-catalog.md) | All 33 scales + ~538 lick catalog (452 curated + ~86 combinatorial) with metadata |
