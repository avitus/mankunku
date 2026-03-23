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
│   ├── app.css                      # Global CSS variables (dark/light themes)
│   ├── app.d.ts                     # SvelteKit type declarations
│   ├── lib/
│   │   ├── audio/                   # Audio pipeline (7 files)
│   │   │   ├── audio-context.ts     # Shared AudioContext via Tone.js
│   │   │   ├── playback.ts          # Phrase playback with smplr SoundFont
│   │   │   ├── capture.ts           # Mic capture setup
│   │   │   ├── pitch-detector.ts    # Pitchy McLeod pitch detection
│   │   │   ├── onset-detector.ts    # Main-thread onset coordinator
│   │   │   ├── onset-worklet.ts     # AudioWorklet onset processor
│   │   │   ├── note-segmenter.ts    # Combine pitch + onsets into notes
│   │   │   └── metronome.ts         # Jazz metronome (ride + hi-hat)
│   │   ├── scoring/                 # Scoring engine (5 files)
│   │   │   ├── alignment.ts         # DTW note alignment
│   │   │   ├── pitch-scoring.ts     # Per-note pitch accuracy
│   │   │   ├── rhythm-scoring.ts    # Per-note rhythm accuracy
│   │   │   ├── scorer.ts            # Orchestrator: align + score
│   │   │   └── grades.ts            # Score-to-grade mapping
│   │   ├── music/                   # Music theory (6 files)
│   │   │   ├── scales.ts            # 35-scale catalog
│   │   │   ├── chords.ts            # 18 chord quality definitions
│   │   │   ├── keys.ts              # Key signatures, scale realization
│   │   │   ├── intervals.ts         # MIDI/frequency math, fractions
│   │   │   ├── notation.ts          # ABC notation generation
│   │   │   └── transposition.ts     # Concert ↔ written pitch
│   │   ├── phrases/                 # Phrase system (5 files)
│   │   │   ├── generator.ts         # 5-stage algorithmic generator
│   │   │   ├── mutator.ts           # Lick mutation system
│   │   │   ├── validator.ts         # Contour/range validation
│   │   │   ├── combiner.ts          # Combinatorial scale × rhythm lick generation
│   │   │   └── library-loader.ts    # Lick indexing, query, transposition
│   │   ├── difficulty/              # Adaptive difficulty (2 files)
│   │   │   ├── adaptive.ts          # Difficulty adjustment algorithm
│   │   │   └── params.ts            # 10-level difficulty profiles
│   │   ├── state/                   # Reactive state (4 files)
│   │   │   ├── session.svelte.ts    # Current practice session
│   │   │   ├── settings.svelte.ts   # User preferences
│   │   │   ├── progress.svelte.ts   # Session history + adaptive state
│   │   │   └── library.svelte.ts    # Library filter state
│   │   ├── persistence/
│   │   │   └── storage.ts           # localStorage wrapper
│   │   ├── types/                   # TypeScript interfaces (5 files)
│   │   │   ├── audio.ts             # DetectedNote, AudioState, PlaybackOptions
│   │   │   ├── music.ts             # Note, Phrase, ScaleDefinition, etc.
│   │   │   ├── scoring.ts           # Score, NoteResult, AlignmentPair
│   │   │   ├── progress.ts          # SessionResult, UserProgress, AdaptiveState
│   │   │   └── instruments.ts       # InstrumentConfig, INSTRUMENTS
│   │   ├── components/              # Svelte components (10 files)
│   │   │   ├── audio/               # MicStatus, PitchMeter, TransportBar
│   │   │   ├── notation/            # NotationDisplay
│   │   │   ├── practice/            # PhraseInfo, FeedbackPanel, NoteComparison
│   │   │   ├── library/             # LickCard, CategoryFilter
│   │   │   └── onboarding/          # Onboarding
│   │   ├── tonality/                # Tonality system (2 files)
│   │   │   ├── tonality.ts          # Daily key/scale selection, unlocking
│   │   │   └── scale-compatibility.ts # Scale-aware lick filtering
│   │   └── data/
│   │       ├── test-phrases.ts      # Dev/test phrase data
│   │       └── licks/               # ~250 licks across 9 categories
│   │           ├── index.ts         # Re-exports all lick arrays
│   │           ├── beginner-cells.ts # 50 beginner 2-3 note cells
│   │           ├── ii-V-I-major.ts  # 24 licks
│   │           ├── ii-V-I-minor.ts  # 15 licks
│   │           ├── blues.ts         # 20 licks
│   │           ├── bebop-lines.ts   # 20 licks
│   │           ├── pentatonic.ts    # 10 licks
│   │           ├── modal.ts         # 10 licks
│   │           ├── rhythm-changes.ts # 7 licks
│   │           └── ballad.ts        # 7 licks
│   └── routes/                      # SvelteKit pages (9 files)
│       ├── +layout.svelte           # App shell, nav, onboarding gate
│       ├── +page.svelte             # Dashboard / home
│       ├── practice/
│       │   ├── +page.svelte         # Main practice view
│       │   └── settings/+page.svelte # Session configuration
│       ├── library/
│       │   ├── +page.svelte         # Lick browser
│       │   └── [id]/+page.svelte    # Lick detail + transposition
│       ├── progress/+page.svelte    # Stats, charts, history
│       ├── scales/+page.svelte      # Scale reference
│       └── settings/+page.svelte    # App settings
├── tests/
│   └── unit/                        # Vitest unit tests (9 files)
├── static/
│   └── icons/                       # PWA icons (SVG)
├── vite.config.ts                   # Vite + SvelteKit + Tailwind + PWA
├── svelte.config.js                 # Svelte config (runes mode enabled)
├── tsconfig.json                    # TypeScript strict mode
├── package.json                     # Dependencies and scripts
└── PRD.md                           # Product requirements document
```

## Key Conventions

- **Concert pitch everywhere**: All MIDI note numbers, scale data, and lick data use concert pitch. Transposition to written pitch happens at display time only.
- **Fractions for rhythm**: Note durations and offsets use `[numerator, denominator]` tuples (e.g., `[1, 4]` = quarter note) to avoid floating-point errors with triplets.
- **Svelte 5 runes**: All components use `$state`, `$derived`, `$effect`, and `$props` — no Svelte 4 stores.
- **Lazy loading**: Heavy dependencies (Tone.js, Pitchy, smplr, abcjs) are dynamically imported on first use.
- **localStorage persistence**: Settings and progress are stored with the `mankunku:` prefix.
