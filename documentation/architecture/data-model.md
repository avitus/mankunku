# Data Model

All core types live in `src/lib/types/`. This document describes every interface and type alias.

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
}
```

Defines the harmonic context for a portion of a phrase — the chord and the associated scale.

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
