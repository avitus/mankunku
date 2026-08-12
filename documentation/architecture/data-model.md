# Data Model

All core types live in `src/lib/types/`. This document describes the interfaces and type aliases in that directory.

Types that belong to one subsystem and are declared beside it — `FlattenedTune` and `InsertionPoint` (tunes), `PitchReading` (audio), `LickFeature` / `MatchIndex` (matching), `ChordSymbol` (notation) — are documented with their subsystem: see [Tune System](./tune-system.md), [API Reference: Audio](../api-reference/audio.md), and [API Reference: Music](../api-reference/music.md).

## Music Types (`src/lib/types/music.ts`)

### PitchClass

```typescript
type PitchClass = 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B';
```

The 12 chromatic pitch classes, using flat notation for every accidental except the tritone-from-C slot, which is spelled `'F#'`. The constant `PITCH_CLASSES` provides them in the same order.

### ChordQuality

```typescript
type ChordQuality =
  | 'maj7' | 'min7' | '7' | 'min7b5' | 'dim7'
  | 'maj6' | 'min6' | 'aug7' | 'sus4' | 'sus2'
  | '7alt' | '7#11' | '7b9' | '7#9' | '7b13'
  | 'minMaj7' | 'aug' | 'dim';
```

18 chord qualities covering standard jazz harmony.

### PhraseCategory

```typescript
type PhraseCategory =
  | 'ii-V-I-major' | 'ii-V-I-minor' | 'blues' | 'bebop-lines'
  | 'short-ii-V-I-major' | 'short-ii-V-I-minor'
  | 'V-I-major' | 'V-I-minor'
  | 'major-chord' | 'dominant-chord' | 'minor-chord' | 'diminished-chord'
  | 'pentatonic' | 'enclosures' | 'digital-patterns'
  | 'rhythm-changes' | 'ballad' | 'modal'
  | 'user';
```

Categories for organizing phrases: 18 curated/combinatorial categories plus `'user'` for user-recorded licks. The curated library holds 452 hand-written licks across these categories (plus algorithmically generated combinations, for ~538 licks at import). `CATEGORY_LABELS` in `music.ts` provides the canonical display label for every value.

### Fraction

```typescript
type Fraction = [number, number];  // [numerator, denominator]
```

Represents durations and offsets as fractions of a whole note. Examples: `[1, 4]` = quarter note, `[1, 8]` = eighth note, `[1, 12]` = triplet eighth.

### Note

```typescript
interface Note {
  pitch: number | null;        // MIDI note (concert pitch), null = rest
  duration: Fraction;          // Length as fraction of whole note
  offset: Fraction;            // Position from phrase start
  velocity?: number;           // 0-127 (default ~100)
  articulation?: Articulation; // 'normal' | 'accent' | 'ghost' | 'bend-up' | 'staccato' | 'legato'
  scaleDegree?: string;        // e.g. '1', 'b3', '#4'
  spelling?: 'sharp' | 'flat'; // Override enharmonic spelling for notation display
  tied?: boolean;              // Ties note to the next: renders an ABC tie and plays as one
                               // sustained pitch when pitches match; the scorer collapses tied
                               // same-pitch chains into a single sustained note
}
```

### HarmonicSegment

```typescript
interface HarmonicSegment {
  chord: {
    root: PitchClass;
    quality: ChordQuality;
    bass?: PitchClass;
  };
  scaleId: string;             // References ScaleDefinition.id (e.g. 'major.dorian')
  startOffset: Fraction;
  duration: Fraction;
  symbol?: string;             // Original chord text as written, e.g. "C7(b9,#11)"
}
```

Defines the harmonic context for a portion of a phrase — the chord and the associated scale.

`symbol` preserves display fidelity where the mapping onto the closed `ChordQuality` union is imperfect: **display prefers `symbol`, audio uses `chord`**. It is populated by manual chord entry and every tune importer via `harmonicSegmentFromSymbol` (see [Tune System](./tune-system.md)).

### Phrase

```typescript
interface Phrase {
  id: string;                          // Unique ID (e.g. 'ii-V-I-maj-001' or 'gen-1710000000-0')
  name: string;
  timeSignature: [number, number];     // e.g. [4, 4]
  key: PitchClass;                     // Concert pitch key
  notes: Note[];
  harmony: HarmonicSegment[];
  difficulty: DifficultyMetadata;
  category: PhraseCategory;
  tags: string[];
  source: 'curated' | 'generated' | string;  // or 'mutated:<parentId>'
}
```

The central data structure. Curated licks are stored in concert C and transposed at runtime.

### ScaleDefinition

```typescript
interface ScaleDefinition {
  id: string;                          // e.g. 'major.dorian'
  name: string;                        // e.g. 'Dorian'
  family: ScaleFamily;                 // 'major' | 'melodic-minor' | etc.
  mode: number | null;                 // 1-based mode number (null for non-modal)
  intervals: number[];                 // Semitone steps, must sum to 12
  degrees: string[];                   // Scale degree labels
  chordApplications: ChordQuality[];   // Applicable chord types
  avoidNotes?: string[];               // Degrees to avoid sustaining
  targetNotes: string[];               // Chord tones for generator to land on
}
```

## Tune Types (`src/lib/types/tune.ts`)

### TuneSource

```typescript
type TuneSource =
  | 'curated' | 'user'
  | 'imported-ireal' | 'imported-biab' | 'imported-pdf'
  | string;
```

### TuneSection

```typescript
interface TuneSection {
  label: string;               // Section letter shown on the chart: 'A', 'B', 'Intro', 'Coda', …
  bars: number;                // Authoritative even when melody is sparse or empty
  repeatStart?: boolean;       // Opens |: at the start of this section
  repeatEnd?: boolean;         // Closes :| at the end of this section
  ending?: 1 | 2;              // Numbered volta ending
  notes: Note[];               // SECTION-LOCAL offsets, starting at [0,1]
  harmony: HarmonicSegment[];  // SECTION-LOCAL offsets
}
```

### Tune

```typescript
interface Tune {
  id: string;
  title: string;
  composer?: string;
  key: PitchClass;                 // CONCERT pitch
  timeSignature: [number, number];
  style?: string;                  // Feel label, e.g. 'Medium Swing', 'Ballad'
  tags: string[];
  sections: TuneSection[];
  source: TuneSource;
  difficulty?: DifficultyMetadata;
  pdfUrl?: string;                 // `{uid}/{id}.pdf` in the `tunes` bucket, for PDF imports
}
```

A full song form: melody plus complete harmony, organized into labeled sections with repeat and ending markers.

Two properties differ from `Phrase` and matter downstream:

- **Tunes store their real concert key**, unlike licks, which are all stored in concert C and transposed at runtime.
- **Section offsets are section-local.** Nothing consumes sections directly — `flattenTune` (`$lib/tunes/flatten`) produces the continuous form that the notation renderer and backing-track engine read, in either notation order or playback order.

`pdfUrl` round-trips through the cloud row so reconcile never clobbers it.

See [Tune System](./tune-system.md) for `FlattenedTune`, `DetectedProgression`, `LickSuggestion`, and `InsertionPoint`.

## Lick Practice Types (`src/lib/types/lick-practice.ts`)

### ChordProgressionType

```typescript
type ChordProgressionType =
  | 'minor-vamp' | 'major-vamp' | 'dominant-vamp'
  | 'ii-V-I-major' | 'ii-V-I-minor'
  | 'ii-V-I-major-long' | 'ii-V-I-minor-long'
  | 'turnaround' | 'iii-VI-ii-V-I' | 'blues';
```

The ten backing-track progressions. `PROGRESSION_TEMPLATES` (`$lib/data/progressions`) holds each one's harmony and bar count; `PROGRESSION_SHAPES` (`$lib/data/progression-shapes`) holds the degree patterns the tune detector scans for; `progressionColor` (`$lib/music/progression-display`) holds each one's identity hue. All three are exhaustive `Record`s, so adding a progression won't type-check until it has a template, a shape, and a colour.

### LickPracticeKeyProgress / LickPracticeProgress

```typescript
interface LickPracticeKeyProgress {
  currentTempo: number;
  lastPracticedAt: number;
  passCount: number;
  rollingScore?: number;   // EWMA over EVERY scored attempt (alpha 0.4)
}

type LickPracticeProgress =
  Record<string, Partial<Record<PitchClass, LickPracticeKeyProgress>>>;
```

Per-lick, per-key progress, persisted to localStorage via `persistence/lick-practice-store.ts`.

`passCount` counts only *passes* (≥ 0.90), at most one per session — it drives
unlocking. `rollingScore` is different on purpose: it is updated on **every**
scored attempt including failures, so deep-practice can rank a lick's keys
worst-first and aim the per-cycle demo at the key that actually needs it. It is
optional because entries written before the field existed have none; absent is
treated as *unknown*, which sorts as worst so an unfamiliar key still gets
demoed. Under the per-`(lick, key)` last-writer-wins cloud merge each device's
EWMA only ever saw its own attempts since the last sync — an accepted
approximation, not a bug.

### LickProgressPoint / LickProgressHistory

```typescript
interface LickProgressPoint {
  t: number;     // Wall-clock ms; also the per-lick dedupe key
  bpm: number;   // Session tempo at this sample
  keys: number;  // Unlocked-key count (1–12) at this sample
}

type LickProgressHistory = Record<string, LickProgressPoint[]>;
```

Append-only time series, sampled whenever a session bumps tempo or unlocks a key. Drives the two-panel progress chart on the lick detail page — plotted against real elapsed time, not sample index.

### Other types in this module

`LickPracticeMode` (`'continuous' | 'call-response'`), `LickPracticeSessionType` (`'daily' | 'focused' | 'deep' | 'trick'`), `LickPracticeConfig`, `ChordSubstitutionRule`, `LickPracticePlanItem`, `SingleLickRoundEntry`, `LickPracticePhase` (`'setup' | 'count-in' | 'lick-running' | 'inter-lick-rest' | 'complete'`), `LickPracticeKeyResult`, `LickReport`, `SessionReport`. See [API Reference: State](../api-reference/state.md#lick-practicesveltets).

`LickPracticePlanItem` carries an optional `kind: 'lick' | 'trick'` (absent means
`'lick'`). For a trick item, `phraseId` **is** the composite trick variant key, and
the item additionally carries `trickId`, `trickParameters`, and the C-rooted
`trickContext` the generated `phrase` was realized in. `getLickById` simply misses
on a variant key, so every helper falls back to the item's own `phrase` — which is
why a trick can ride the lick-practice engine without the lick catalog knowing it
exists.

## Trick Types (`src/lib/types/tricks.ts`)

The melodic-device domain model. See [Trick Scoring](./trick-scoring.md) for how
these are consumed.

### `TrickParameters` and the variant key

```typescript
type TrickParameters = Record<string, string>;   // parameter name → chosen value

function normalizeParameterSignature(params: TrickParameters): string;  // 'a=1,b=2', keys sorted
function trickVariantKey(trickId: string, params: TrickParameters): string;  // `${trickId}:${sig}`
```

**All** trick progress is keyed by the composite variant key — never by the id of a
generated preview phrase, which is disposable and regenerated every round. The
signature sorts its keys so two equal selections can never produce two keys.

### `TrickSlotSpec`

```typescript
interface TrickSlotSpec {
  offset: Fraction;        // as in Note.offset
  duration: Fraction;      // as in Note.duration
  exactPcs: number[];      // pitch classes 0-11 that satisfy this slot exactly
  patternPcs?: number[];   // right device, wrong member
  generatePc?: number;     // the one pc the example generator realizes; scoring ignores it
  role: string;            // diagnostic label, e.g. 'target', 'chromatic-below', 'triad-a'
}
```

Everything is **pitch classes**, never MIDI: a trick is a shape, not a register.

### `ConformanceResult` / `SlotConformanceResult`

```typescript
type SlotConformanceTier = 'exact' | 'in-pattern' | 'in-scale' | 'out-of-scale' | 'missed';

interface ConformanceResult {
  slots: SlotConformanceResult[];
  patternScore: number;        // mean slot credit over ALL slots (misses drag it down)
  extraCount: number;          // played notes matched to no slot
  latencyCorrectionMs: number;
  style?: string;              // winning spec variant, multi-style devices only
}
```

### `Trick`

The device interface. Two required contracts — `scoreConformance` (primary) and
`generateExample` (secondary) — plus three optional hooks: `exampleStyles` (demo
rotation order), `practiceBed(params)` (which one-chord vamp to drill over), and
`compatibleQualitiesFor(params)` (per-variant chord qualities, refining the
trick-wide `compatibleQualities`).

### `TrickPracticeKeyProgress` / `TrickPracticeProgress` / `TrickProgressPoint`

Mirror the lick-practice shapes field-for-field (`currentTempo`,
`lastPracticedAt`, `passCount`; `{ t, bpm, keys }` history points), but keyed by
variant key instead of phrase id — and they live in **separate storage**
(`persistence/trick-practice-store.ts`), never in the lick blobs. A composite key
leaking into a lick store would look like a lick id to everything downstream;
there are explicit guards against it in the report-reset and history-seed paths.

Locally the state is six localStorage keys (`trick-practice-progress`,
`trick-progress-history`, `trick-unlock-count`, `trick-selected-variants`,
`trick-selected-variants-mtime`, `trick-migrations`); in the cloud it is a single
`user_settings.trick_state` JSONB column, assembled and fanned back out by the
store. The merge rules for that blob differ per field on purpose:

| Field | Merge rule | Why |
|---|---|---|
| `selectedVariants` | wholesale LWW by `selectedUpdatedAt` (union on an exact tie) | A union would resurrect variants the user un-starred on another device |
| `selectedUpdatedAt` | `max` | — |
| `migrations` | set union | A completed migration must never replay |
| `progress` | per `(variant, key)`, later `lastPracticedAt` wins | — |
| `unlockCounts` | per variant, `max` | An unlock is never revoked |
| `history` | union by `t`, capped at the newest 500 points | Append-only series |

The cloud read is **tri-state** (`ok` / `missing` / `error`). `missing` is a
brand-new account and merges safely against empty; `error` throws in the outbox
path rather than merging, because treating a failed read as "no remote data"
is exactly the 2026-07-13 incident class.

## Audio Types (`src/lib/types/audio.ts`)

### DetectedNote

```typescript
interface DetectedNote {
  midi: number;       // MIDI note number (concert pitch)
  cents: number;      // Cents deviation from nearest note (-50 to +50)
  onsetTime: number;  // Onset relative to recording start (seconds)
  duration: number;   // Duration in seconds
  clarity: number;    // Pitch detection clarity (0-1)
}
```

Output of the note segmentation pipeline. Each represents one detected note from the microphone.

### PlaybackOptions

```typescript
interface PlaybackOptions {
  tempo: number;              // BPM
  swing: number;              // 0.5 = straight, 0.67 = triplet swing
  countInBeats: number;       // Count-in beats before recording
  metronomeEnabled: boolean;
  metronomeVolume: number;    // 0-1
  backingTrackEnabled?: boolean;         // Enable backing track accompaniment
  backingInstrument?: BackingInstrument; // Comping instrument: piano or organ
  backingTrackVolume?: number;           // Backing track volume (0-1)
  backingStyle?: BackingStyle;           // Backing track musical style
}
```

### AudioEngineState

```typescript
type AudioEngineState = 'uninitialized' | 'loading' | 'ready' | 'playing' | 'recording' | 'error';
```

### MicPermissionState

```typescript
type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';
```

## Scoring Types (`src/lib/types/scoring.ts`)

### Score

```typescript
interface Score {
  pitchAccuracy: number;       // 0-1
  rhythmAccuracy: number;      // 0-1
  overall: number;             // pitch * 0.6 + rhythm * 0.4
  grade: Grade;                // 'perfect' | 'great' | 'good' | 'fair' | 'try-again'
  noteResults: NoteResult[];
  notesHit: number;            // Correctly identified notes
  notesTotal: number;          // Total expected notes
  timing: TimingDiagnostics;   // Bias, spread, and per-note offsets
}
```

The 0.6/0.4 weighting is `scoreAttempt`'s. Trick attempts produce a
`Score`-compatible result too — `FluencyScore`, from `scoring/fluency.ts` — but
weight it 0.7 pattern / 0.3 rhythm, with `pitchAccuracy` carrying the
conformance `patternScore`. Every downstream consumer (grades, points,
`recordKeyAttempt`, `applyInsertionResult`) is unchanged either way, which is
the whole reason it conforms to this interface.

### TimingDiagnostics

```typescript
interface TimingDiagnostics {
  meanOffsetMs: number;                // + = late, - = early
  medianOffsetMs: number;
  stdDevMs: number;                    // timing jitter proxy
  latencyCorrectionMs: number;         // constant offset subtracted by scorer
  perNoteOffsetMs: (number | null)[];  // parallel to noteResults
}
```

### BleedFilterLog

```typescript
interface BleedFilterLog {
  totalNotes: number;
  keptNotes: number;
  filteredNotes: DetectedNote[];
  unfilteredScore: Score | null;
  filteredScore: Score | null;
}
```

Produced by `runScorePipeline()` when a bleed-filter result is available. Drives the A/B comparison in the `/diagnostics` panel.

### NoteResult

```typescript
interface NoteResult {
  expected: Note;
  detected: DetectedNote | null;  // null if missed
  pitchScore: number;             // 0-1
  rhythmScore: number;            // 0-1
  missed: boolean;
  extra: boolean;                 // Extra note not in phrase
}
```

### AlignmentPair

```typescript
interface AlignmentPair {
  expectedIndex: number | null;   // null = extra detected note
  detectedIndex: number | null;   // null = missed expected note
  cost: number;
}
```

## Progress Types (`src/lib/types/progress.ts`)

### UserProgress

```typescript
interface UserProgress {
  adaptive: AdaptiveState;
  sessions: SessionResult[];                    // Last 100 sessions (MAX_SESSIONS)
  categoryProgress: Record<string, CategoryProgress>;
  keyProgress: Partial<Record<PitchClass, { attempts: number; averageScore: number }>>;
  scaleProficiency: Partial<Record<ScaleType, ScaleProficiency>>;  // per-scale proficiency (1-100)
  keyProficiency: Partial<Record<PitchClass, KeyProficiency>>;     // per-key proficiency (1-100)
  lickProgress: Partial<Record<string, LickProgress>>;            // per-lick progress, keyed by phraseId
  totalPracticeTime: number;
  streakDays: number;
  lastPracticeDate: string;                     // ISO date string (YYYY-MM-DD)
}
```

### AdaptiveState

```typescript
interface AdaptiveState {
  currentLevel: number;                // Rounded avg of pitch + rhythm (1-100)
  pitchComplexity: number;             // 1-100, adjusted independently
  rhythmComplexity: number;            // 1-100, adjusted independently
  recentScores: number[];              // Circular buffer of last 25 overall scores
  recentPitchScores: number[];         // Circular buffer of last 25 pitch accuracy scores
  recentRhythmScores: number[];        // Circular buffer of last 25 rhythm accuracy scores
  attemptsAtLevel: number;
  attemptsSinceChange: number;         // Min of pitch/rhythm cooldowns
  pitchAttemptsSinceChange: number;    // Per-dimension cooldown for pitch
  rhythmAttemptsSinceChange: number;   // Per-dimension cooldown for rhythm
}
```

### SessionResult

```typescript
interface SessionResult {
  id: string;
  timestamp: number;
  phraseId: string;
  phraseName: string;
  category: PhraseCategory;
  key: PitchClass;
  scaleType?: ScaleType;                        // optional, backward compat
  source?: 'ear-training' | 'lick-practice';    // optional; absent => 'ear-training'
  tempo: number;
  difficultyLevel: number;
  pitchAccuracy: number;
  rhythmAccuracy: number;
  overall: number;
  grade: Grade;
  notesHit: number;
  notesTotal: number;
  noteResults: NoteResult[];                    // per-note scoring breakdown
  timing?: TimingDiagnostics;                   // optional, backward compat
}
```

## Instrument Types (`src/lib/types/instruments.ts`)

### InstrumentConfig

```typescript
interface InstrumentConfig {
  name: string;
  key: TransposingKey;                 // 'Bb' | 'Eb' | 'C' | 'F'
  transpositionSemitones: number;      // Concert + this = written pitch
  concertRangeLow: number;            // Lowest MIDI note (concert)
  concertRangeHigh: number;           // Highest MIDI note (concert)
  clef: 'treble' | 'bass';
  gmProgram: number;                   // General MIDI program number
  highNotePresets: number[];           // Concert MIDI values for the "highest note" dropdown, highest first
}
```

### Built-in Instruments

| ID | Name | Key | Transposition | Range (MIDI) | GM Program |
|---|---|---|---|---|---|
| `concert` | Concert Pitch | C | 0 | 36–96 | 0 |
| `soprano-sax` | Soprano Saxophone | Bb | +2 | 56–88 | 64 |
| `tenor-sax` | Tenor Saxophone | Bb | +14 | 44–76 | 66 |
| `alto-sax` | Alto Saxophone | Eb | +9 | 49–80 | 65 |
| `trumpet` | Trumpet | Bb | +2 | 52–82 | 56 |
