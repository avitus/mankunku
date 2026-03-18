# Mankunku: Jazz Ear Training Web Application

## Context

A web-based jazz ear training app modeled on PitchBop Pro but with more customization. The primary training mode is **call-and-response**: the app plays a 1-4 bar jazz phrase, the user plays it back on their instrument via microphone, and the app scores pitch and rhythm accuracy. Phrases must be idiomatically jazz (not random), drawing from curated licks and algorithmic generation. The app should support all standard jazz scales and adapt difficulty as the user improves. Future extensibility for other melodic instruments (alto sax, trumpet, etc.) is required.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | SvelteKit 2 + Svelte 5 (Runes) | ~1.6 KB runtime frees main thread for audio processing; rune-based reactivity (`$state`, `$derived`, `$effect`) is ideal for high-frequency audio state updates; file-based routing + SSR/SSG + service worker story out of the box |
| **Build** | Vite (bundled with SvelteKit) | Native ESM dev, Rollup production builds |
| **Styling** | Tailwind CSS 4 | Utility-first, dark mode, fast iteration |
| **State** | Svelte 5 Runes (no external lib) | Module-level `$state()` in `.svelte.ts` files for shared state; `$effect()` for localStorage sync |
| **Audio playback** | Tone.js + smplr | Tone.js: transport, scheduling, metronome. smplr: SoundFont samples (FluidR3_GM tenor sax) with CacheStorage for offline |
| **Pitch detection** | Pitchy | Pure JS (~5 KB), McLeod Pitch Method, designed for monophonic instruments, returns frequency + clarity. Accurate in tenor sax range (104-659 Hz) |
| **Onset detection** | Custom AudioWorklet (spectral flux) | Runs on audio thread with ~2.67ms latency per 128-sample frame. Avoids Essentia.js's 2 MB WASM binary |
| **Notation** | abcjs | Text-based format is trivial to generate programmatically; built-in chord symbols, cursor animation, and chordGrid for jazz lead sheets |
| **PWA** | @vite-pwa/sveltekit | Offline support for practice without internet |
| **Testing** | Vitest + Playwright | Unit tests for scoring/music logic; E2E for audio pipeline |
| **Language** | TypeScript throughout | |

---

## Application Architecture

### Routes

```
/                    -> Dashboard (recent sessions, stats)
/practice            -> Main call-and-response screen
/practice/settings   -> Session configuration
/library             -> Browse lick library by category
/library/[id]        -> Individual lick detail/practice
/scales              -> Scale reference and practice
/progress            -> Progress charts and history
/settings            -> App settings (instrument, mic, audio)
```

### Practice Screen Component Tree

```
PracticePage
  TransportBar            -- play/stop, tempo, metronome toggle
  NotationDisplay         -- abcjs SVG with current note highlight
  PhraseInfo              -- key, chord changes, scale, difficulty
  FeedbackPanel
    PitchMeter            -- real-time pitch visualization during recording
    ScoreDisplay          -- pitch %, rhythm %, overall after attempt
    NoteComparison        -- side-by-side expected vs played per note
  SessionControls
    RepeatButton          -- hear phrase again
    NextButton            -- new phrase
    DifficultyIndicator   -- current level, XP bar
  MicStatus               -- permission state, input level meter
```

---

## Audio Pipeline

### Playback Flow

```
Phrase data (JSON) -> Tone.js Part (scheduled events) -> smplr SoundFont (Tenor Sax) -> speakers
                                                      -> Metronome: Tone.js synth on beats
                                                      -> Notation cursor: Transport position -> abcjs
```

After phrase plays, a count-in (1-2 beats of clicks) signals the user to play back. Recording begins automatically after count-in.

### Microphone Capture

```
getUserMedia({ audio: true })
  -> MediaStreamSource
  -> AnalyserNode (FFT 4096, for pitch detection)
  -> AudioWorkletNode (frame 2048, for onset detection)
  -> NOT connected to destination (no feedback loop)
```

### Pitch Detection (runs in requestAnimationFrame at 60fps)

```
analyserNode.getFloatTimeDomainData(buffer)
  -> Pitchy PitchDetector.findPitch(buffer, sampleRate)
  -> [frequency, clarity]
  -> if clarity > 0.80: accept
  -> frequency -> MIDI note + cents deviation
  -> store as DetectedNote { midi, cents, onsetTime, duration, clarity }
```

### Onset Detection (AudioWorklet on audio thread)

Energy-based HFC (high-frequency content) algorithm: compute energy and frequency-weighted content per 128-sample frame, compare against adaptive EMA threshold, enforce minimum onset interval. Posts onset timestamps to main thread.

### Note Segmentation

Onset messages + pitch readings combined: each onset starts a new note, pitch is the median of readings between onsets, duration is time to next onset or silence.

---

## Scoring Algorithm

### Step 1: Alignment via Dynamic Time Warping (DTW)

Aligns detected note sequence to expected note sequence, handling timing differences, extra notes, and missed notes.

Cost function: `pitchDistance(expected.midi, detected.midi) + rhythmDistance(expected.onset, detected.onset)`

### Step 2: Pitch Scoring (per aligned pair)

- Correct MIDI note = 1.0, wrong = 0.0
- Intonation bonus: up to 10% for being within 50 cents

### Step 3: Rhythm Scoring (per aligned pair)

- `timingError = |detected.onset - expected.onset| / beatDuration`
- `rhythmScore = max(0, 1.0 - timingError * 4)` — full marks within 25% of a beat

### Step 4: Composite

```
overall = pitchAccuracy * 0.6 + rhythmAccuracy * 0.4
```

Grades: perfect (>=95%), great (>=85%), good (>=70%), fair (>=55%), try-again (<55%)

---

## Core Data Models

### Musical Phrase

```typescript
interface Phrase {
  id: string;
  name: string;
  timeSignature: [number, number];
  key: PitchClass;                    // Concert pitch, stored in C for transposability
  notes: Note[];
  harmony: HarmonicSegment[];
  difficulty: DifficultyMetadata;
  category: PhraseCategory;           // 'ii-V-I-major' | 'blues' | 'bebop-line' | ...
  tags: string[];
  source: 'curated' | 'generated' | string;
}

interface Note {
  pitch: number | null;               // MIDI (concert), null = rest
  duration: [number, number];         // Fraction of whole note (avoids float issues for triplets)
  offset: [number, number];           // Beat offset from phrase start as fraction
  velocity?: number;
  articulation?: 'normal' | 'accent' | 'ghost' | 'bend-up' | 'staccato' | 'legato';
  scaleDegree?: string;
}

interface HarmonicSegment {
  chord: { root: PitchClass; quality: ChordQuality; bass?: PitchClass };
  scaleId: string;                    // References scale catalog
  startOffset: [number, number];
  duration: [number, number];
}
```

All licks stored in concert C and transposed at runtime to any key.

### Scale Definitions

```typescript
interface ScaleDefinition {
  id: string;                         // 'major.dorian', 'melodic-minor.altered'
  name: string;
  family: 'major' | 'melodic-minor' | 'harmonic-minor' | 'symmetric' | 'pentatonic' | 'bebop' | 'blues';
  mode: number | null;
  intervals: number[];                // Semitone steps, sum = 12
  degrees: string[];                  // '1', 'b3', '#4', etc.
  chordApplications: ChordQuality[];
  avoidNotes?: string[];
  targetNotes: string[];              // Chord tones for generator to land on
}
```

**Full catalog: 35 scales** — 7 major modes, 7 melodic minor modes, 7 harmonic minor modes, 4 symmetric (whole-half dim, half-whole dim, whole tone, chromatic), 2 pentatonic, 2 blues, 4 bebop.

### Instrument / Transposition

```typescript
interface InstrumentConfig {
  name: string;
  key: 'Bb' | 'Eb' | 'C' | 'F';
  transpositionSemitones: number;     // Concert + N = written pitch
  concertRangeLow: number;            // MIDI
  concertRangeHigh: number;
  clef: 'treble' | 'bass';
}

// Tenor Sax: transposition = 14 (up major 9th), range = MIDI 44-76
// Alto Sax: transposition = 9, range = MIDI 49-80
// Trumpet: transposition = 2, range = MIDI 52-82
```

All internal data is concert pitch. Transposition only at display boundary (notation). Detected pitches from mic are already concert pitch (physics).

---

## Phrase Content System

### Hybrid Approach: Curated Library + Algorithmic Generation + Lick Mutation

**Layer 1 — Curated Lick Library (~114 licks at MVP):**

| Category | Count | Priority |
|----------|-------|----------|
| ii-V-I major | 20 | P0 |
| Blues | 15 | P0 |
| Bebop lines | 15 | P0 |
| ii-V-I minor | 12 | P0 |
| Pentatonic | 10 | P1 |
| Enclosures | 10 | P1 |
| Digital patterns | 8 | P1 |
| Approach notes | 8 | P1 |
| Turnarounds | 8 | P1 |
| Rhythm changes | 8 | P2 |

Stored as individual JSON files organized by category directory. Indexed at build time for fast querying by category, difficulty, scale, style, and length.

**Layer 2 — Algorithmic Generation (5-stage pipeline):**

1. **Target note selection** — chord tones on strong beats, voice-led between chords
2. **Approach patterns** — fill between targets using scale runs, chromatic approaches, enclosures, arpeggios, digital patterns (weights vary by difficulty)
3. **Rhythm cell selection** — idiomatic jazz rhythm cells (swing 8ths as triplet grid, syncopation, anticipations) chosen by difficulty
4. **Contour validation** — enforce: max consecutive leaps, leap recovery, range limits, direction changes, step ratio, ending resolution
5. **Articulation** — ghost notes on passing tones, accents on targets, bends on blues tones, legato on scalar runs

**Layer 3 — Lick Mutation:** Transform curated licks via rhythmic displacement, octave displacement, approach modification, truncation/extension for variety without losing musicality.

---

## Difficulty System

10 levels, each with independent pitch and rhythm parameters:

| Level | Name | Pitch | Rhythm | Bars | Tempo | Keys |
|-------|------|-------|--------|------|-------|------|
| 1 | Roots & 5ths | Major scale 1-2-3-5, 3rd max interval | Quarter notes only | 1 | 60-80 | C, F, G |
| 2 | Full Pentatonic | Pentatonic, 4th max | Quarter notes | 1 | 60-90 | C, D, F, G, Bb |
| 3 | Swing 8ths | Mixolydian degrees, 5th max | Swing 8ths | 1-2 | 70-100 | 7 keys |
| 4 | Diatonic Lines | Full diatonic, 5th max | Swing + syncopation | 1-2 | 80-120 | All 12 |
| 5 | Approach Notes | Chromatic approaches | 8ths + triplets | 2 | 90-140 | All 12 |
| 6 | Enclosures | Full chromatic, octave leaps | Triplets, syncopation | 2 | 100-160 | All 12 |
| 7 | Bebop Lines | Full chromatic, 9th leaps | 16th notes | 2-4 | 120-180 | All 12 |
| 8 | Altered Harmony | Altered scales | 16ths, complex syncopation | 2-4 | 140-200 | All 12 |
| 9 | Complex Rhythm | All intervals to octave+ | Mixed subdivisions | 2-4 | 160-240 | All 12 |
| 10 | No Limits | Two-octave range | All rhythmic devices | 4 | 180-300 | All 12 |

**MVP ships levels 1-7.** Levels 8-10 deferred (need extensive content).

### Adaptive Algorithm

- Window of last 10 attempts
- Average > 85% over window -> advance (increase weakest parameter first)
- Average < 50% over window -> retreat (decrease parameter causing most errors)
- Minimum 5 attempts between difficulty changes
- Pitch and rhythm complexity adjusted independently

---

## Scales at MVP Launch (20 of 35)

**Must-have (12):** Ionian, Dorian, Mixolydian, Aeolian, Lydian, Minor Pentatonic, Major Pentatonic, Minor Blues, Bebop Dominant, Bebop Dorian, Melodic Minor, Altered

**Should-have (8):** Lydian Dominant, Locrian Nat 2, Harmonic Minor, Phrygian Dominant, Half-Whole Diminished, Whole Tone, Major Blues, Whole-Half Diminished

Remaining 15 scales added in subsequent releases.

---

## Project Structure

```
mankunku/
  package.json
  svelte.config.js
  vite.config.ts
  tsconfig.json

  src/
    app.html
    app.css                          -- Tailwind imports + CSS variables
    routes/
      +layout.svelte                 -- Root layout (nav, audio init)
      +page.svelte                   -- Dashboard
      practice/
        +page.svelte                 -- Main practice screen
        settings/+page.svelte
      library/
        +page.svelte                 -- Lick browser
        [id]/+page.svelte
      scales/+page.svelte
      progress/+page.svelte
      settings/+page.svelte

    lib/
      components/
        audio/                       -- MicStatus, TransportBar, PitchMeter
        notation/                    -- NotationDisplay, ChordDisplay
        practice/                    -- FeedbackPanel, NoteComparison, SessionControls, DifficultyIndicator
        library/                     -- LickCard, CategoryFilter
        ui/                          -- Button, Slider, Select, Modal, Toast

      state/
        audio.svelte.ts              -- AudioContext, mic, Tone Transport
        session.svelte.ts            -- Current phrase, config, scoring results
        progress.svelte.ts           -- Cumulative stats, adaptive state
        settings.svelte.ts           -- Instrument, mic gain, tempo prefs
        library.svelte.ts            -- Lick library state, filters

      audio/
        playback.ts                  -- Tone.js + smplr phrase playback
        capture.ts                   -- Mic capture setup
        pitch-detector.ts            -- Pitchy integration
        onset-detector.ts            -- Spectral flux main-thread coordinator
        onset-worklet.ts             -- AudioWorklet processor
        note-segmenter.ts            -- Combine pitch + onset -> DetectedNote[]
        metronome.ts                 -- Click synthesis
        audio-context.ts             -- Shared AudioContext management

      scoring/
        alignment.ts                 -- DTW algorithm
        pitch-scoring.ts
        rhythm-scoring.ts
        scorer.ts                    -- Orchestrates full scoring pipeline
        grades.ts                    -- Score -> Grade mapping

      music/
        scales.ts                    -- Scale catalog (35 definitions)
        chords.ts                    -- Chord quality definitions
        transposition.ts             -- Concert <-> written pitch
        intervals.ts                 -- Interval utilities
        notation.ts                  -- MIDI -> note name, ABC notation gen
        keys.ts                      -- Key signature utilities

      phrases/
        generator.ts                 -- 5-stage algorithmic generation
        mutator.ts                   -- Lick variation/mutation
        validator.ts                 -- Phrase constraint checking
        library-loader.ts            -- Load and index lick library

      difficulty/
        adaptive.ts                  -- Adaptive difficulty algorithm
        params.ts                    -- Difficulty profiles (levels 1-10)
        progression.ts               -- Level progression logic

      persistence/
        storage.ts                   -- localStorage wrapper with $state sync
        export.ts                    -- Export progress as JSON

      types/
        music.ts                     -- Phrase, Note, Scale, Chord types
        audio.ts                     -- DetectedNote, AudioState types
        scoring.ts                   -- Score, NoteResult types
        progress.ts                  -- UserProgress, SessionResult types
        instruments.ts               -- InstrumentConfig types

    data/
      licks/                         -- Curated lick JSON files by category
        ii-V-I-major/
        ii-V-I-minor/
        blues/
        bebop-lines/
        enclosures/
        digital-patterns/
        approach-notes/
        turnarounds/
        rhythm-changes/
        pentatonic/
      scales.json
      instruments.json
      progressions.json

  static/
    favicon.svg
    manifest.json
    icons/

  tests/
    unit/
      scoring/                       -- alignment, pitch-scoring, rhythm-scoring
      music/                         -- transposition, scales, notation
      phrases/                       -- generator, validator
      difficulty/                    -- adaptive
      audio/                         -- capture, pitch-detector, onset-worklet
    e2e/
      practice-flow.test.ts
      library-browse.test.ts
```

---

## Implementation Phases

### Phase 1: Foundation
- Scaffold SvelteKit + Svelte 5 + Tailwind CSS 4 + TypeScript
- Configure PWA with @vite-pwa/sveltekit
- Define all TypeScript types in `src/lib/types/`
- Implement `src/lib/music/` — scales, transposition, intervals, notation (pure functions, fully unit-testable)
- Create instrument definitions (tenor sax, alto sax, trumpet)
- Set up route structure with placeholder pages

### Phase 2: Playback
- Implement shared AudioContext management (user gesture handling)
- Implement phrase playback (Tone.js Transport + smplr SoundFont loading)
- Implement metronome
- Build NotationDisplay (abcjs rendering from Phrase data)
- Build TransportBar
- **Milestone: play a hardcoded phrase, hear tenor sax sound, see notation**

### Phase 3: Microphone & Detection
- Implement mic capture (getUserMedia, AnalyserNode setup)
- Implement pitch detection (Pitchy integration, frequency-to-MIDI, clarity threshold)
- Implement onset detection AudioWorklet (energy-based HFC)
- Implement note segmenter (combine pitch + onset into DetectedNote[])
- Build MicStatus and PitchMeter (real-time visual feedback)
- **Milestone: play a note on sax, see detected pitch in real time**

### Phase 4: Scoring & Core Loop (MVP)
- Implement DTW alignment
- Implement pitch and rhythm scoring
- Build FeedbackPanel and NoteComparison
- Wire up complete call-and-response loop: hear phrase -> count-in -> record -> score -> display
- **Milestone: working MVP — play a phrase back and get scored**

### Phase 5: Lick Library & Generation
- Transcribe initial lick library (start with ~50 P0 licks)
- Implement algorithmic phrase generator (5-stage pipeline)
- Implement lick mutation system
- Implement phrase validation
- Build library browser UI (categories, difficulty filter, search)
- Implement session configuration (key, tempo, category, bars, scale)

### Phase 6: Difficulty & Progress
- Implement adaptive difficulty algorithm
- Implement localStorage persistence with $state sync
- Build progress dashboard (use lightweight chart library)
- Implement per-category and per-key progress tracking
- Add XP system and level display

### Phase 7: Polish
- Onboarding flow (instrument selection, mic permission, calibration)
- Dark mode
- Mobile layout optimization
- Expand lick library to 114+
- PWA manifest, icons, SoundFont offline caching
- Performance tuning (AudioWorklet message batching, pitch detection throttling)

---

## Key Technical Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Saxophone pitch detection accuracy (rich harmonics) | McLeod Pitch Method works in time domain (autocorrelation), robust to harmonics. Clarity threshold 0.80 filters noise/breath/key clicks. Low-pass filter as fallback. |
| Browser mic latency (20-50ms) | Does not affect scoring — onsets timestamped relative to recording start. User hears themselves acoustically. |
| Mobile AudioWorklet support | Supported in Chrome, Firefox, Safari (iOS 14.5+). Tone.js handles AudioContext lifecycle. |
| SoundFont loading time (~1.5 MB) | smplr CacheStorage caching + PWA service worker pre-cache. Loading indicator on first visit. |
| Algorithmic phrases sounding unmusical | 5-stage pipeline with hard contour constraints + curated library always available as fallback + mutation of known-good licks |

---

## Verification Plan

1. **Unit tests**: scoring algorithms (DTW alignment, pitch scoring, rhythm scoring), transposition logic, scale realization, phrase generator constraint validation, adaptive difficulty state machine
2. **Integration test**: Full call-and-response loop with mocked getUserMedia providing a known audio signal — verify scoring output matches expected
3. **Manual testing**: Play actual tenor saxophone into the app across difficulty levels; verify pitch detection accuracy, onset timing, scoring fairness
4. **Browser testing**: Chrome, Safari (desktop + iOS), Firefox — verify AudioWorklet, getUserMedia, Tone.js playback
5. **PWA testing**: Verify offline mode works after initial SoundFont cache
