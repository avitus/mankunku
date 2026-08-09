# API Reference: Phrases

Phrase mutation, validation, and curated library loading.

**Source:** `src/lib/phrases/`

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

`level` is on the 1–100 proficiency scale. Five bands, each also setting `leapRecoveryThreshold` and `minDirectionChanges`:

| Level | maxInterval | maxConsecutiveLeaps | minStepRatio | leapRecoveryThreshold | minDirectionChanges |
|---|---|---|---|---|---|
| ≤20 | 5 | 1 | 0.5 | 5 | 1 |
| ≤40 | 7 | 2 | 0.4 | 6 | 2 |
| ≤60 | 10 | 2 | 0.35 | 7 | 2 |
| ≤80 | 12 | 3 | 0.3 | 7 | 2 |
| >80 | 14 | 3 | 0.25 | 8 | 2 |

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
| `getAllLicks` | `() → Phrase[]` | All licks: ~538 curated (452 hand-written + ~86 combinatorial) plus the user's own and adopted-community licks |
| `getLickById` | `(id) → Phrase \| undefined` | O(1) lookup by ID |
| `getLicksByCategory` | `(category) → Phrase[]` | Pre-built category index |
| `getCategories` | `() → { category, count }[]` | Categories sorted by count (descending) |
| `queryLicks` | `(query) → Phrase[]` | Multi-filter query |

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

---

## duplicate-detection.ts

Recognizes that the phrase being typed already exists in the library, so the
editor can offer *adopt* instead of a second copy. A duplicate means **same
melody + same rhythm, regardless of key or octave**.

### `pitchClassContour(phrase): ContourEntry[]`

Reduce a phrase to one entry per note: `[pitch % 12, reducedDuration]` for
pitched notes, `[null, reducedDuration]` for rests. Octave is collapsed;
rhythm is kept exactly. **Trailing rests are stripped**, because a saved lick
is stored padded out to the bar (`getPaddedNotes()`) while the phrase being
typed is not — without that, no in-progress entry would ever match.

### `contoursMatchAnyKey(a, b): boolean`

True when `b` is a transposition of `a`. It does not try all 12 rotations: the
shift is *derived* from the first pitched index in `a` and its counterpart in
`b`, then verified across the whole contour. A rest where a pitch should be
fails immediately — no rotation can repair a pitch/rest disagreement.

### `findDuplicateLick(entered, library): Phrase | null`

The first library lick matching `entered`, or `null`. Returns `null` outright
below 4 pitched notes — short fragments collide constantly and the warning
would be noise. Candidates sharing `entered`'s id are skipped, so re-opening a
saved lick for edit never flags itself.

---

## adopted-phrase-validator.ts

Structural validation for phrases arriving from **outside** this browser —
community adoption and cloud hydration. Local generation is trusted; foreign
payloads are not.

### `validateAdoptedPhrase(input: unknown): AdoptedPhraseValidation`

Returns `{ valid, errors }`. Checks shape (notes, harmony, offsets, non-overlapping
harmony segments within tolerance), enforces the size caps below, and rejects
dangerous-looking strings in names and tags.

| Constant | Value | Why |
|---|---|---|
| `MAX_NOTES_PER_ADOPTED_PHRASE` | 2000 | A malicious author could otherwise schedule enough Tone.js events to freeze the practice UI |
| `MAX_ADOPTED_NAME_LENGTH` | 200 | Long names break layout and signal abuse |
| `MAX_ADOPTED_TAG_LENGTH` | 80 | Matches common tag-UI conventions |

The dangerous-content pattern (`<[a-z]`, `javascript:`, `on\w+\s*=`) is
**defense in depth**, not the primary defense — Svelte escapes interpolated
strings at render time. It is deliberately narrow enough that `"V - I"` and
`"I<3 jazz"` pass.

Two things it deliberately does **not** reject: an unknown `category` (unknown
categories simply render as "user") and a `scaleId` missing from the local scale
library (the practice pipeline already has a fallback). Rejecting either would
break adoption across app versions for no safety gain.
