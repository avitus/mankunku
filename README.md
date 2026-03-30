# Mankunku

Jazz ear training progressive web app with call-and-response practice. The app plays a jazz phrase, you play it back on your instrument via microphone, and it scores your pitch and rhythm accuracy in real time.

Named after Winston "Mankunku" Ngozi's 1968 album [*Yakhal' Inkomo*](https://en.wikipedia.org/wiki/Yakhal%27_Inkomo) — one of the greatest South African jazz recordings. Under the hood: real-time pitch detection at 60fps, Dynamic Time Warping for score alignment, a custom AudioWorklet for onset detection, adaptive difficulty that grows with you, and a local-first architecture that works offline.

## Features

- Call-and-response practice with automatic scoring
- Real-time pitch detection (McLeod method via Pitchy, 60fps)
- Note onset detection via custom AudioWorklet (HFC algorithm)
- DTW alignment-based scoring (pitch 60% + rhythm 40%, with latency correction)
- 35+ scales and ~250 curated jazz licks (ii-V-I, blues, bebop, modal, and more)
- Combinatorial phrase generation from scale patterns and rhythm templates
- Adaptive difficulty: XP system, levels 1-100, 10 content tiers
- Concert pitch canonical — transposition to written pitch at display time only
- Fraction-based rhythm representation (no floating-point drift with triplets or dotted notes)
- Local-first: writes to localStorage/IndexedDB, optional Supabase cloud sync
- Offline-capable installable PWA with cached SoundFont samples
- Cross-device progress sync via Supabase auth (optional)
- Dark and light themes

## Tech Stack

| Technology | Role |
|---|---|
| SvelteKit 2 + Svelte 5 (runes) | Framework, SSR, file-based routing |
| TypeScript (strict mode) | Type safety throughout |
| Tailwind CSS 4 | Utility-first styling, dark/light theming |
| Tone.js + smplr | Audio scheduling, SoundFont sample playback |
| Pitchy | McLeod pitch detection |
| Custom AudioWorklet | Real-time onset detection |
| abcjs | Sheet music notation rendering |
| Supabase | Auth + PostgreSQL cloud sync (optional) |
| Vitest + Playwright | Unit and E2E testing |
| @vite-pwa/sveltekit | PWA with Workbox service worker |

## Quick Start

**Prerequisites:** Node.js >= 18, a modern browser with Web Audio API support

```sh
git clone https://github.com/avitus/mankunku.git
cd mankunku
npm install
npm run dev
```

The app opens at `http://localhost:5173`. The onboarding flow will prompt for instrument selection and microphone access. A microphone is needed for full functionality but not required to explore the codebase.

**Optional — Supabase cloud sync:** Copy `.env.example` to `.env` and add your Supabase project URL and anon key. See [Getting Started](documentation/getting-started.md) for full setup including database migrations.

## Project Structure

```
src/
  lib/
    audio/          Audio pipeline: playback, capture, pitch detection, onset detection
    scoring/        DTW alignment and scoring engine
    music/          Music theory: scales, keys, intervals, transposition, chords
    phrases/        Phrase generation, mutation, validation, library loading
    difficulty/     Adaptive difficulty algorithm and 10-tier profiles
    tonality/       Daily key/scale selection, progressive unlocking
    state/          Svelte 5 runes state modules (.svelte.ts)
    persistence/    localStorage/IndexedDB storage + Supabase sync
    components/     UI components (audio, practice, library, notation, onboarding)
    supabase/       Client setup and generated DB types
    types/          TypeScript interfaces grouped by domain
    data/           Curated lick library and static data
  routes/           SvelteKit pages: practice, library, progress, settings, auth
tests/
  unit/             Unit tests across 8 domains (audio, scoring, music, phrases, ...)
  integration/      Integration tests (auth route chain, etc.)
  e2e/              Playwright browser tests
supabase/
  migrations/       5 SQL migration files (profiles, progress, settings, licks, RLS)
documentation/      Architecture docs, API reference, contributing guides
```

## Architecture Highlights

**Concert pitch canonical** — All MIDI note numbers, scale data, and lick data use concert pitch. Transposition to written pitch (Bb/Eb instruments) happens only at display time in two functions: `phraseToAbc()` and `concertToWritten()`. This eliminates an entire class of transposition bugs.

**Fraction-based rhythm** — Note durations use `[numerator, denominator]` tuples (e.g., `[1, 8]` = eighth note, `[1, 12]` = triplet eighth). No floating-point drift with triplets or dotted rhythms. Conversion to seconds happens only when computing audio timing.

**DTW scoring with latency correction** — Dynamic Time Warping aligns expected and detected note sequences, handling extra notes, missed notes, and tempo drift. The scorer computes the median timing offset across matched pairs and subtracts it, absorbing constant human and detection latency without affecting relative timing accuracy.

**AudioWorklet onset detection** — A custom AudioWorklet processor runs on the audio thread for low-latency onset detection using High-Frequency Content weighting with an adaptive threshold. Falls back to pitch-gap detection in browsers without AudioWorklet support.

**Local-first with optional cloud** — All writes go to localStorage and IndexedDB first for instant feedback and offline resilience. Supabase sync runs in the background when the user opts in. The app is fully functional without any backend.

See [Architecture Overview](documentation/architecture/overview.md) for detailed system design documentation.

## Contributing

Contributions are welcome — whether that is adding jazz licks, improving the scoring algorithm, fixing bugs, or improving documentation.

**Good first contributions:**

- Add curated licks to the library ([guide](documentation/contributing/adding-licks.md))
- Add scales to the catalog ([guide](documentation/contributing/adding-scales.md))
- Improve test coverage across any of the 8 test domains
- Report bugs or suggest features via issues

See the full [Contributing Guide](documentation/contributing/contributing.md) for code style, branch naming, commit conventions, and PR process. In short: Svelte 5 runes only, TypeScript strict mode, Conventional Commits.

## Testing

```sh
npm test              # Run unit + integration tests (Vitest)
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright E2E tests
npm run check         # TypeScript + svelte-check
```

See the [Testing Guide](documentation/contributing/testing-guide.md) for patterns, audio mocking strategies, and conventions.

## License

License pending. This project does not yet have a license file — one will be added before the first public release.

## Acknowledgments

Named after [Winston "Mankunku" Ngozi](https://en.wikipedia.org/wiki/Winston_Mankunku_Ngozi) (1943-2009), South African jazz tenor saxophonist whose 1968 album *Yakhal' Inkomo* ("Cry of the Bull") remains a landmark of South African jazz.

Built with [SvelteKit](https://svelte.dev), [Tone.js](https://tonejs.github.io), [Pitchy](https://github.com/ianprime0509/pitchy), [smplr](https://github.com/danigb/smplr), [abcjs](https://www.abcjs.net), and [Supabase](https://supabase.com).
