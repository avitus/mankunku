# API Reference: Phrases

Phrase generation, mutation, validation, and curated library loading.

**Source:** `src/lib/phrases/`

---

## generator.ts

Algorithmic phrase generator — 5-stage pipeline.

### `GeneratorOptions` interface

```typescript
interface GeneratorOptions {
  key: PitchClass;
  category: PhraseCategory;
  difficulty: number;
  harmony: HarmonicSegment[];
  bars: number;
  timeSignature?: [number, number];  // default [4, 4]
}
```

### `generatePhrase(options): Phrase`

Generate a phrase using the 5-stage pipeline. Retries up to 5 times if validation fails; falls back to a simple scale fragment.

**Stages:**

1. **Target note selection** — Place chord tones on strong beats (every 2 beats). Voice-lead by picking the chord tone closest to the previous target across multiple octaves. Constrained to MIDI 44–75 by default (tenor-sax concert range, overridable via `rangeHigh`/`rangeLow`).

2. **Approach patterns** — Fill gaps between targets using one of three strategies:
   - **Scale run** (easy/common): Diatonic notes between targets
   - **Chromatic approach** (medium, `r < 0.8`): 1–2 chromatic notes before target
   - **Arpeggio fill** (harder, `r >= 0.8`): Chord tones between targets

3. **Rhythm cell selection** — Assign durations based on the difficulty profile's allowed rhythm types. Last note gets longer duration. Target notes get higher velocity (100 vs 80).

4. *(Reserved)* — Skipped in current implementation.

5. **Articulation** — At difficulty >= 4, adds markings:
   - Accent (30% chance) on target notes with velocity >= 100
   - Ghost note (20% chance) on weak-beat passing tones
   - Legato (30% chance) on consecutive stepwise motion

### `getDefaultHarmony(category, key): HarmonicSegment[]`

Standard harmonic progressions for generating phrases.

| Category | Progression |
|---|---|
| `'ii-V-I-major'` | ii min7 → V 7 → I maj7 |
| `'ii-V-I-minor'` | ii min7b5 → V 7alt → i min7 |
| `'blues'` | I7 (static) |
| `'bebop-lines'` | I maj7 (static) |
| Other | I maj7 (static) |

---

## mutator.ts

Transforms existing licks to create variations.

### `mutateLick(lick, rangeHigh?): Phrase | null`

Apply a random mutation. Returns `null` if the result fails validation. `rangeHigh` (default tenor-sax top) is forwarded to `octaveDisplacement`.

Randomly selects from:

### `rhythmicDisplacement(lick): Phrase`

Shift all note onsets forward by an eighth note, creating syncopation. ID suffix: `_displaced`.

### `octaveDisplacement(lick, rangeHigh?): Phrase`

Randomly shift ~25% of notes up or down an octave. Skips first and last pitched notes. Constrains to MIDI 44–`rangeHigh` (default 84). ID suffix: `_octdispl`.

### `truncate(lick, maxNotes?): Phrase`

Keep the first ~60% of notes (or `maxNotes`). Recalculates bar count. Requires at least 4 pitched notes to operate. ID suffix: `_trunc`.

### `retrograde(lick): Phrase`

Reverse the pitch sequence while keeping the rhythm intact. ID suffix: `_retro`.

---

## validator.ts

Phrase validation — contour rules, range limits, and musical constraints.

### `ValidationRules` interface

```typescript
interface ValidationRules {
  maxInterval: number;             // Max semitones between consecutive notes (default: 14)
  maxConsecutiveLeaps: number;     // Max intervals > 2 semitones in a row (default: 3)
  minStepRatio: number;            // Min ratio of steps to total intervals (default: 0.3)
  range: [number, number];         // MIDI range bounds (default: [44, 75], tenor-sax concert range)
  leapRecovery: boolean;           // Require step in opposite direction after large leap
  leapRecoveryThreshold: number;   // Semitones above which recovery is enforced (default: 7)
  minDirectionChanges: number;     // Min melodic direction changes (default: 1)
  requireEndingResolution: boolean; // Last note must be chord tone (default: false)
}
```

### `validatePhrase(phrase, rules?): ValidationResult`

Validate a phrase against contour and range rules.

```typescript
interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

Phrases with fewer than 2 pitched notes are always valid.

### `rulesForDifficulty(level): Partial<ValidationRules>`

| Level | maxInterval | maxConsecutiveLeaps | minStepRatio |
|---|---|---|---|
| 1–2 | 5 | 1 | 0.5 |
| 3–4 | 7 | 2 | 0.4 |
| 5–6 | 12 | 3 | 0.3 |
| 7+ | 14 | 3 | 0.25 |

### `isChordTone(midi, chordMidiNotes): boolean`

Check if a MIDI note (any octave) is a chord tone.

### `isInRange(notes, low, high): boolean`

Check if all pitched notes in an array are within a MIDI range.

---

## library-loader.ts

Indexes the curated lick library for fast querying.

### `LibraryQuery` interface

```typescript
interface LibraryQuery {
  category?: PhraseCategory;
  maxDifficulty?: number;
  minDifficulty?: number;
  tags?: string[];
  search?: string;
  scaleType?: ScaleType;
}
```

### Query functions

| Function | Signature | Description |
|---|---|---|
| `getAllLicks` | `() → Phrase[]` | All ~250 licks (curated + combinatorial + user-recorded) |
| `getLickById` | `(id) → Phrase \| undefined` | O(1) lookup by ID |
| `getLicksByCategory` | `(category) → Phrase[]` | Pre-built category index |
| `getCategories` | `() → { category, count }[]` | Categories sorted by count (descending) |
| `queryLicks` | `(query) → Phrase[]` | Multi-filter query |
| `pickRandomLick` | `(query?, key?) → Phrase \| null` | Random selection with optional transposition |

### `snapLickToScale(lick, key, scaleId, rangeHigh?): Phrase`

Adjust a transposed lick so every note lies in the given scale. Out-of-scale pitches are snapped to the nearest scale degree (ties break up). Useful for reusing major-family licks against non-major tonalities.

### `transposeLick(lick, targetKey): Phrase`

Transpose a lick from concert C to a target key. Shifts all MIDI pitches and harmony roots by the interval from C to the target key, then applies an **octave adjustment** via `bestOctaveShift()` to keep notes within the tenor sax range (MIDI 60–75, C4–Eb5).

The octave shift algorithm evaluates -3 to +3 octave shifts, maximizing notes in range and using proximity to the midpoint (67.5) as a tiebreaker. Returns the original phrase for `targetKey === 'C'`.

### `transposeLickForTonality(lick, key, scaleId): Phrase`

Transpose a lick for a specific tonality (key + scale). Handles three cases:

1. **Major-family progressions** (ii-V-I, turnarounds, rhythm changes): Transposes to the parent major key to preserve chord relationships
2. **Major-family single-chord licks**: Transposes to the modal root, snaps to scale
3. **Non-major scales** (blues, pentatonic, melodic minor): Transposes to key, snaps out-of-scale notes to nearest scale tone

### `queryLicks(query): Phrase[]`

Filters are applied in order:
1. Category match
2. Max difficulty
3. Min difficulty
4. Tag overlap (any tag matches)
5. Text search (name or tags, case-insensitive)
6. Scale type compatibility (via `isLickCompatible` from `scale-compatibility.ts`)

---

## combiner.ts

Combinatorial lick generation — pairs scale patterns with rhythm patterns (from `src/lib/data/patterns/`) to produce a large pool of `Phrase` objects. Output shows up in the library alongside curated licks.

### `realizeScalePattern(degrees, scaleId, key): number[] | null`

Map scale-degree indices to MIDI pitches against a scale in the given key. Anchors the root closest to C4 (MIDI 60) and indexes up/down from there through a MIDI 36–96 pool. Returns `null` if the scale is unknown, the root isn't in the pool, or any degree falls outside the pool bounds.

### `combine(sp, rp, scaleId, key, harmony): Phrase | null`

Pair a `ScalePattern` with a `RhythmPattern` and build a `Phrase`.

- Note counts must match (`sp.degrees.length === rp.noteCount`).
- If the scale pattern declares `compatibleFamilies`, the scale's family must be one of them.
- Difficulty is computed via `calculateDifficulty()` on the finished phrase.
- Phrases are tagged with `'combined'` and `source: 'combined'`. IDs are `cmb-<scale-pattern-id>_<rhythm-pattern-id>`.

### `generateAllCombinations(): Phrase[]`

Iterate over every `(ScalePattern, RhythmPattern)` cross-product whose category is mapped in the internal category→scale context table. Called once at module import time.

### `COMBINED_LICKS: Phrase[]`

Pre-computed array of all valid combinatorial licks (~evaluated at import). Consumed by the library loader to seed the in-memory lick index.
