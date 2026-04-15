# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev            # Dev server at http://localhost:5173
npm run build          # Production build (SvelteKit Node adapter → build/)
npm run preview        # Preview production build locally
npm run check          # TypeScript + svelte-check
npm run check:watch    # Type checking in watch mode
npm test               # Unit + integration tests (Vitest)
npm run test:watch     # Vitest watch mode
npm run test:e2e       # Playwright E2E tests
npx vitest run tests/unit/music/scales.test.ts   # Run a single test file
```

CI pipeline (CircleCI): test → build → deploy (main branch only). Deploy rsyncs to a Digital Ocean server and restarts via PM2.

## Architecture

Mankunku is a jazz ear training PWA. It plays a phrase, the user plays it back on their instrument via microphone, and it scores pitch/rhythm accuracy in real time. Built with SvelteKit 2, Svelte 5 (runes), TypeScript strict mode, Tailwind CSS 4, Tone.js, and Pitchy.

### Core module boundaries (`src/lib/`)

- **types/** — Pure TypeScript interfaces grouped by domain. No runtime code.
- **music/** — Pure functions for music theory (scales, intervals, keys, transposition, chords). No side effects.
- **audio/** — Everything touching Web Audio API: playback (Tone.js), capture (mic), pitch detection (Pitchy at 60fps), onset detection (custom AudioWorklet), note segmentation, metronome, voicings.
- **scoring/** — Pure functions: DTW alignment + pitch/rhythm scoring. No audio or UI dependencies.
- **phrases/** — Phrase generation, mutation, validation, library loading. Depends on music/ only.
- **difficulty/** — Adaptive difficulty: proficiency levels 1-100, 10 content tiers.
- **tonality/** — Daily key/scale selection, progressive unlocking.
- **state/** — Svelte 5 runes state modules (`.svelte.ts` files). Bridge between UI and logic.
- **persistence/** — localStorage wrapper + optional Supabase cloud sync.
- **components/** — Reusable Svelte UI components.
- **data/** — Curated lick library JSON files, rhythm pattern templates, progression templates.
- **step-entry/** — Manual lick entry helpers: duration metadata, pitch-input accidentals.
- **supabase/** — Supabase client factories (browser + server), auth helpers, generated DB types.
- **util/** — Small shared utilities (e.g., seeded shuffle).

### Key design decisions

**Concert pitch canonical.** All MIDI note numbers, scale data, and lick data use concert pitch internally. Transposition to written pitch (Bb/Eb instruments) happens only at display time in `phraseToAbc()` (notation.ts) and `concertToWritten()` (transposition.ts).

**Fraction-based rhythm.** Durations use `[numerator, denominator]` tuples (e.g., `[1, 8]` = eighth note, `[1, 12]` = triplet eighth). Conversion to seconds happens only at audio scheduling time.

**DTW scoring with latency correction.** Dynamic Time Warping in `alignment.ts` aligns expected vs detected note sequences. The scorer subtracts the median timing offset across matched pairs, absorbing constant human/detection latency.

**Local-first.** All writes go to localStorage/IndexedDB first. Supabase sync is optional and runs in the background. The app works fully offline.

**Shared AudioContext.** Tone.js and smplr share one AudioContext (via `audio-context.ts`) so Transport scheduling and sample playback stay on the same timeline.

### State management

State modules in `src/lib/state/` use Svelte 5 runes (`$state()`, `$derived()`, `$effect()`), not Svelte 4 stores. Key modules:
- **session.svelte.ts** — Single-phrase practice session (not persisted)
- **settings.svelte.ts** — User preferences (persisted to localStorage)
- **progress.svelte.ts** — Session history + adaptive state (persisted, bounded to 200 entries)
- **history.svelte.ts** — Long-term daily progress summaries for calendar heatmaps and period comparisons (persisted, survives the 200-session prune window)
- **library.svelte.ts** — Lick browser filter state (not persisted)
- **lick-practice.svelte.ts** — Multi-key lick-practice flow: progression plans, per-key results, tempo adjustments (progress persisted via `persistence/lick-practice-store.ts`)
- **step-entry.svelte.ts** — Manual lick entry UI state: current duration, octave, accidental, entered notes (not persisted)

### Routes (`src/routes/`)

practice/, lick-practice/ (multi-key flow), library/, progress/, settings/, scales/, entry/ (step-entry), add-licks/, record/, auth/ (login + OAuth callback), diagnostics/, api/account/ (account management endpoints)

## Code conventions

- **Svelte 5 runes only** — no `$:` reactive statements, no Svelte 4 stores
- **TypeScript strict mode** — explicit types for parameters and returns
- **File naming**: kebab-case for `.ts` files, PascalCase for `.svelte` components, `.svelte.ts` for state modules
- **Commit style**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- **Scoring weights**: pitch accuracy 60%, rhythm accuracy 40%
