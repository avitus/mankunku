# Getting Started

## Prerequisites

- **Node.js** >= 18 (LTS recommended)
- **npm** >= 9
- A modern browser with Web Audio API support (Chrome, Firefox, Edge, Safari 16.4+)
- A microphone (for the call-and-response scoring feature)

## Installation

```bash
git clone <repo-url> mankunku
cd mankunku
npm install
```

## Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. On first visit, the onboarding flow prompts you to select an instrument and grant microphone access.

## Available Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `npm run dev` | Start Vite dev server with HMR |
| `build` | `npm run build` | Production build via Vite |
| `preview` | `npm run preview` | Preview production build locally |
| `check` | `npm run check` | Run svelte-check type checking |
| `test` | `npm run test` | Run unit tests (Vitest) |
| `test:watch` | `npm run test:watch` | Run tests in watch mode |
| `test:e2e` | `npm run test:e2e` | Run Playwright end-to-end tests |

## Project Structure

```
mankunku/
├── src/
│   ├── app.css                      # Global CSS variables + Fraunces + jazz utilities
│   ├── app.d.ts                     # SvelteKit type declarations
│   ├── hooks.server.ts              # Supabase server hooks (auth)
│   ├── lib/
│   │   ├── audio/                   # Audio pipeline
│   │   │   ├── audio-context.ts     # Shared AudioContext via Tone.js
│   │   │   ├── playback.ts          # Phrase playback with smplr SoundFont
│   │   │   ├── capture.ts           # Mic capture setup
│   │   │   ├── pitch-detector.ts    # Pitchy McLeod pitch detection (+ pitch-frame.ts)
│   │   │   ├── onset-core.ts        # HFC + EMA onset algorithm (shared)
│   │   │   ├── onset-detector.ts    # Main-thread onset coordinator
│   │   │   ├── onset-worklet.ts     # AudioWorklet onset processor
│   │   │   ├── note-segmenter.ts    # Combine pitch + onsets into notes
│   │   │   ├── quantizer.ts         # Snap onsets to subdivision grid
│   │   │   ├── bleed-filter.ts      # Reject backing-track bleed notes
│   │   │   ├── backing-track.ts     # Jazz rhythm section engine
│   │   │   ├── backing-track-schedule.ts # Time-indexed backing events
│   │   │   ├── backing-styles.ts    # Swing / bossa / ballad patterns
│   │   │   ├── sample-maps.ts       # Drum sample registry
│   │   │   ├── voicings.ts          # Shell voicings + voice-leading
│   │   │   ├── metronome.ts         # Jazz metronome (kick + ride + hat)
│   │   │   ├── recorder.ts          # MediaRecorder wrapper
│   │   │   └── replay.ts            # Re-score a stored audio blob
│   │   ├── scoring/                 # Scoring engine
│   │   │   ├── score-pipeline.ts    # Orchestrator: bleed filter + scoring
│   │   │   ├── scorer.ts            # DTW + latency correction + per-note scoring
│   │   │   ├── alignment.ts         # DTW note alignment
│   │   │   ├── pitch-scoring.ts     # Per-note pitch accuracy
│   │   │   ├── rhythm-scoring.ts    # Per-note rhythm accuracy
│   │   │   └── grades.ts            # Thresholds, labels, captions, colors
│   │   ├── music/                   # Music theory
│   │   │   ├── scales.ts            # 35-scale catalog
│   │   │   ├── chords.ts            # 18 chord quality definitions
│   │   │   ├── keys.ts              # Key signatures, scale realization
│   │   │   ├── key-ordering.ts      # Progressive key unlock ordering
│   │   │   ├── intervals.ts         # MIDI/frequency math, fractions
│   │   │   ├── notation.ts          # ABC notation generation
│   │   │   └── transposition.ts     # Concert ↔ written pitch
│   │   ├── phrases/                 # Phrase system
│   │   │   ├── generator.ts         # Algorithmic generator
│   │   │   ├── mutator.ts           # Lick mutation system
│   │   │   ├── validator.ts         # Contour/range validation
│   │   │   ├── combiner.ts          # Combinatorial scale × rhythm generation
│   │   │   └── library-loader.ts    # Lick indexing, query, transposition
│   │   ├── difficulty/              # Adaptive difficulty
│   │   │   ├── adaptive.ts          # Level adjustment algorithm
│   │   │   ├── calculate.ts         # Difficulty score calculation
│   │   │   ├── display.ts           # 10-band color/name mapping
│   │   │   └── params.ts            # Per-level generator parameters
│   │   ├── tonality/                # Daily tonality selection
│   │   │   ├── tonality.ts          # Daily key/scale, FNV-1a hash
│   │   │   └── scale-compatibility.ts # Scale-aware lick filtering
│   │   ├── state/                   # Reactive state (Svelte 5 runes)
│   │   │   ├── session.svelte.ts    # Current practice session
│   │   │   ├── settings.svelte.ts   # User preferences
│   │   │   ├── progress.svelte.ts   # Session history + adaptive state
│   │   │   ├── history.svelte.ts    # Long-term daily summaries
│   │   │   ├── library.svelte.ts    # Library filter state
│   │   │   ├── lick-practice.svelte.ts # Multi-key lick-practice flow
│   │   │   └── step-entry.svelte.ts # Manual lick-entry UI state
│   │   ├── persistence/             # Local + cloud persistence
│   │   │   ├── storage.ts           # localStorage wrapper
│   │   │   ├── audio-store.ts       # IndexedDB for recorded audio
│   │   │   ├── user-licks.ts        # User-authored lick storage
│   │   │   ├── lick-practice-recording.ts # Per-session recording store
│   │   │   ├── lick-practice-store.ts # Lick-practice progress
│   │   │   └── sync.ts              # Supabase background sync
│   │   ├── supabase/                # Supabase client + types
│   │   │   ├── client.ts            # Browser client factory
│   │   │   ├── server.ts            # Server client factory
│   │   │   ├── admin.ts             # Service-role client (account ops)
│   │   │   └── types.ts             # Generated DB types
│   │   ├── types/                   # TypeScript interfaces
│   │   │   ├── audio.ts             # DetectedNote, PlaybackOptions, AudioEngineState
│   │   │   ├── music.ts             # Note, Phrase, ScaleDefinition, HarmonicSegment
│   │   │   ├── scoring.ts           # Score, NoteResult, TimingDiagnostics, BleedFilterLog
│   │   │   ├── progress.ts          # SessionResult, UserProgress, AdaptiveState
│   │   │   ├── instruments.ts       # InstrumentConfig, BackingInstrument, BackingStyle
│   │   │   ├── lick-practice.ts     # Lick-practice plan + results
│   │   │   ├── combinatorial.ts     # Combinatorial generator types
│   │   │   └── auth.ts              # Auth payloads
│   │   ├── components/              # Svelte components (grouped by domain)
│   │   │   ├── audio/               # Mic status, pitch meter, transport bar
│   │   │   ├── notation/            # Notation display
│   │   │   ├── practice/            # PhraseInfo, FeedbackPanel, NoteComparison
│   │   │   ├── library/             # LickCard, CategoryFilter
│   │   │   ├── lick-practice/       # Session chrome, reports, key progress
│   │   │   ├── progress/            # Heatmaps, charts, summaries
│   │   │   ├── step-entry/          # Manual entry keypad and preview
│   │   │   ├── jazz/                # Shared jazz-chrome pieces
│   │   │   └── onboarding/          # Onboarding flow
│   │   ├── step-entry/              # Step-entry helpers
│   │   │   ├── durations.ts         # Duration metadata
│   │   │   └── pitch-input.ts       # Accidental logic
│   │   ├── util/
│   │   │   └── seeded-shuffle.ts    # Deterministic shuffle for daily content
│   │   └── data/
│   │       ├── licks/               # Curated lick library (~250 licks)
│   │       │   ├── index.ts
│   │       │   ├── beginner-cells.ts
│   │       │   ├── major-chord.ts / minor-chord.ts / dominant-chord.ts / diminished-chord.ts
│   │       │   ├── v-i-major.ts / v-i-minor.ts
│   │       │   ├── short-ii-V-I-major.ts / short-ii-V-I-minor.ts
│   │       │   ├── ii-V-I-major.ts / ii-V-I-minor.ts
│   │       │   ├── blues.ts / bebop-lines.ts
│   │       │   ├── pentatonic.ts / modal.ts
│   │       │   ├── rhythm-changes.ts / ballad.ts
│   │       └── patterns/            # Rhythm + progression templates
│   └── routes/                      # SvelteKit pages
│       ├── +layout.svelte / +layout.ts / +layout.server.ts
│       ├── +page.svelte             # Home / dashboard
│       ├── practice/                # Ear-training session + settings
│       ├── lick-practice/           # Setup + /session multi-key flow
│       ├── library/                 # Browser + detail
│       ├── add-licks/ / entry/ / record/  # Lick authoring
│       ├── progress/                # Stats, charts, history
│       ├── scales/                  # Scale reference
│       ├── settings/                # App + instrument settings
│       ├── auth/                    # Login, OAuth callback, logout
│       ├── diagnostics/             # Replay panel + bleed-filter A/B
│       └── api/account/             # Account-management endpoints
├── supabase/
│   └── migrations/                  # 12 SQL migrations (00001–00012)
├── tests/
│   ├── unit/                        # Vitest unit tests
│   └── e2e/                         # Playwright E2E tests
├── static/
│   ├── fonts/                       # Fraunces variable font (self-hosted)
│   └── icons/                       # PWA icons (SVG)
├── documentation/                   # This folder
├── vite.config.ts                   # Vite + SvelteKit + Tailwind + PWA
├── svelte.config.js                 # Svelte config (runes mode enabled)
├── tsconfig.json                    # TypeScript strict mode
├── package.json                     # Dependencies and scripts
└── CLAUDE.md / MEMORY.md            # Agent working notes
```

## Key Conventions

- **Concert pitch everywhere**: All MIDI note numbers, scale data, and lick data use concert pitch. Transposition to written pitch happens at display time only.
- **Fractions for rhythm**: Note durations and offsets use `[numerator, denominator]` tuples (e.g., `[1, 4]` = quarter note) to avoid floating-point errors with triplets.
- **Svelte 5 runes**: All components use `$state`, `$derived`, `$effect`, and `$props` — no Svelte 4 stores.
- **Lazy loading**: Heavy dependencies (Tone.js, Pitchy, smplr, abcjs) are dynamically imported on first use.
- **localStorage persistence**: Settings and progress are stored with the `mankunku:` prefix.
