# Mankunku Documentation

Mankunku is a jazz ear training web app built around **call and response**: the app plays a phrase, you play it back on your instrument, and it scores your pitch and rhythm accuracy.

Named after [Winston "Mankunku" Ngozi's](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) iconic 1968 album *Yakhal' Inkomo*, this app targets jazz musicians practicing ear training, transcription, and improvisation vocabulary.

## Quick Links

| Section | Description |
|---|---|
| [Getting Started](./getting-started.md) | Prerequisites, install, first run, project structure |
| [User Guide](./user-guide.md) | How to use the app: practice, library, progress, settings |

### Architecture

| Document | Description |
|---|---|
| [Overview](./architecture/overview.md) | High-level system design and component diagram |
| [Tech Stack](./architecture/tech-stack.md) | Technology choices and rationale |
| [Data Model](./architecture/data-model.md) | Core TypeScript types with field documentation |
| [Audio Pipeline](./architecture/audio-pipeline.md) | Playback, capture, detection, segmentation |
| [Scoring Algorithm](./architecture/scoring-algorithm.md) | DTW alignment, pitch/rhythm scoring, grading |
| [Phrase System](./architecture/phrase-system.md) | Library, generation, mutation, validation |
| [Adaptive Difficulty](./architecture/adaptive-difficulty.md) | Algorithm, XP, leveling (1-100), difficulty profiles |
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
| [State](./api-reference/state.md) | session, settings, progress, library state modules |
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
| [Scale & Lick Catalog](./reference/scale-and-lick-catalog.md) | All 35 scales + curated lick library with metadata |
