# API Reference: Music Theory

Modules for scales, chords, keys, intervals, notation, and transposition.

**Source:** `src/lib/music/`

---

## intervals.ts

MIDI and pitch math utilities. All MIDI note numbers are concert pitch.

### Note conversion

| Function | Signature | Description |
|---|---|---|
| `midiToPitchClass` | `(midi) → number` | Pitch class index 0–11 |
| `midiToOctave` | `(midi) → number` | Octave number (C4 = octave 4) |
| `pitchClassToMidi` | `(pc, octave) → number` | Pitch class + octave to MIDI |
| `midiToNoteName` | `(midi) → string` | e.g. `60 → 'C4'`, `58 → 'Bb3'` |
| `noteNameToMidi` | `(name) → number` | e.g. `'C4' → 60`, `'Bb3' → 58` |

`noteNameToMidi` handles sharps by converting to flat equivalents (e.g. `C# → Db`).

### Frequency conversion

| Function | Signature | Description |
|---|---|---|
| `frequencyToMidi` | `(freq) → number` | Fractional MIDI: `12 * log2(freq / 440) + 69` |
| `midiToFrequency` | `(midi) → number` | Hz: `440 * 2^((midi - 69) / 12)` |
| `quantizePitch` | `(fractionalMidi) → { midi, cents }` | Round to nearest integer MIDI + cents deviation |

### Interval measurement

| Function | Signature | Description |
|---|---|---|
| `semitoneDistance` | `(from, to) → number` | Signed interval |
| `intervalSize` | `(a, b) → number` | Absolute interval (always positive) |

### Fraction arithmetic

Fractions `[numerator, denominator]` represent note durations and offsets without floating-point error.

| Function | Signature | Description |
|---|---|---|
| `fractionToFloat` | `(f) → number` | `f[0] / f[1]` |
| `addFractions` | `(a, b) → Fraction` | Addition with GCD reduction |
| `subtractFractions` | `(a, b) → Fraction` | Subtraction with GCD reduction |
| `multiplyFraction` | `(f, scalar) → Fraction` | Multiply by integer scalar |
| `compareFractions` | `(a, b) → number` | `-1 / 0 / 1` sort comparator |
| `gcd` | `(a, b) → number` | Greatest common divisor (used internally by the fraction helpers) |

---

## scales.ts

Complete scale catalog — 35 scales across 7 families.

### `SCALE_CATALOG: ScaleDefinition[]`

| Family | Count | Examples |
|---|---|---|
| `major` | 7 | Ionian, Dorian, Mixolydian, Locrian |
| `melodic-minor` | 7 | Melodic Minor, Lydian Dominant, Altered |
| `harmonic-minor` | 7 | Harmonic Minor, Phrygian Dominant |
| `symmetric` | 4 | Whole-Half Diminished, Whole Tone, Chromatic |
| `pentatonic` | 2 | Minor, Major |
| `blues` | 2 | Minor, Major |
| `bebop` | 4 | Dominant, Dorian, Major, Melodic Minor |

Each `ScaleDefinition` contains:
- `id` — Unique identifier (e.g. `'major.dorian'`)
- `intervals` — Semitone steps between consecutive degrees (must sum to 12)
- `degrees` — Degree labels relative to major scale
- `chordApplications` — Applicable chord qualities
- `targetNotes` / `avoidNotes` — Improvisation guidance

### Query functions

| Function | Signature | Description |
|---|---|---|
| `getScale` | `(id) → ScaleDefinition \| undefined` | O(1) lookup by ID |
| `getScalesByFamily` | `(family) → ScaleDefinition[]` | All scales in a family |
| `getScalesForChord` | `(quality) → ScaleDefinition[]` | Scales applicable to a chord quality |
| `getMvpScales` | `() → ScaleDefinition[]` | 20 scales selected for MVP |

### `MVP_SCALE_IDS: string[]`

20 scale IDs selected for the MVP — 12 must-have + 8 should-have.

---

## chords.ts

Chord definitions and utilities.

### `CHORD_DEFINITIONS: Record<ChordQuality, ChordDefinition>`

18 chord qualities with intervals and display symbols:

| Quality | Name | Intervals | Symbol |
|---|---|---|---|
| `maj7` | Major 7th | [0, 4, 7, 11] | `maj7` |
| `min7` | Minor 7th | [0, 3, 7, 10] | `m7` |
| `7` | Dominant 7th | [0, 4, 7, 10] | `7` |
| `min7b5` | Half-Diminished | [0, 3, 6, 10] | `m7b5` |
| `dim7` | Diminished 7th | [0, 3, 6, 9] | `dim7` |
| `7alt` | Altered Dominant | [0, 4, 6, 10] | `7alt` |
| ... | (18 total) | ... | ... |

### `chordTones(rootMidi, quality): number[]`

Get chord tones as MIDI notes from a root MIDI note.

### `chordSymbol(root, quality): string`

Get display symbol (e.g. `chordSymbol('D', 'min7')` → `'Dm7'`).

---

## keys.ts

Key signatures, circle of fifths, and scale realization.

### `keySignatureAccidentals(key): number`

Sharps (positive) or flats (negative) for a major key. E.g. `'Bb' → -2`, `'D' → 2`.

### `circleOfFifths(): PitchClass[]`

Returns `['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F']`.

### `circleOfFourths(): PitchClass[]`

Reverse of `circleOfFifths()` (without duplicating the starting note).

### `getNextKeyInCircle(current, direction?): PitchClass`

Return the next key around the circle of fifths. `direction` is `1` (fifths, default) or `-1` (fourths).

### `getKeyAtIndex(index: number): PitchClass`

Return the key at the given position in the circle of fifths. The index wraps around (negative values and values ≥ 12 are normalized via modulo).

### `relativeMajor(minorKey): PitchClass`

### `relativeMinor(majorKey): PitchClass`

### `realizeScale(root, intervals): number[]`

Returns pitch class indices (0–11) for a scale.

### `realizeScaleMidi(root, intervals, lowMidi, highMidi): number[]`

Returns all MIDI notes in a scale within a range.

### `scalePitchClasses(root, intervals): PitchClass[]`

Returns all pitch classes in a scale.

---

## notation.ts

ABC notation generation from `Phrase` data. Used by `NotationDisplay.svelte` to render sheet music via [abcjs](https://paulrosen.github.io/abcjs/).

### `phraseToAbc(phrase, instrument?, defaultLength?): string`

Generate an ABC notation string.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `phrase` | `Phrase` | — | The phrase to render |
| `instrument` | `InstrumentConfig` | — | If provided, transposes to written pitch |
| `defaultLength` | `[number, number]` | `[1, 8]` | ABC `L:` field (eighth note) |

**Output includes:**
- ABC header: `X:`, `T:`, `M:`, `L:`, `K:` fields
- Notes with proper ABC octave conventions (uppercase C4, lowercase c5, apostrophes/commas)
- **Key-signature-aware accidentals**: Notes matching the key signature (e.g., F# in D major) omit the accidental symbol. Natural signs (`=`) are emitted when a note cancels a key signature accidental. Chromatic alterations outside the key signature display as before.
- Duration modifiers relative to `L:` value
- Final barline `|]`

Uses `KEY_SIG_ACCIDENTALS` lookup table (maps each key to its altered pitch classes) to determine which accidentals are implicit vs. explicit.

### `displayPitchClass(pc, keyContext): string`

Return a pitch class name spelled for a given key context (preferring sharps in sharp keys and flats in flat keys). Used by UI chips that show the current scale's notes.

### `midiToDisplayName(midi, useFlats?): string`

Convert MIDI to display name (e.g. `60 → 'C4'`, `58 → 'Bb3'`). Defaults to flats.

---

## transposition.ts

Concert/written pitch conversion for transposing instruments.

### `concertToWritten(concertMidi, instrument): number`

Concert pitch → written pitch. `written = concert + transpositionSemitones`.

### `writtenToConcert(writtenMidi, instrument): number`

Written pitch → concert pitch. `concert = written - transpositionSemitones`.

### `concertKeyToWritten(concertKey, instrument): PitchClass`

Transpose a key name (e.g. C concert → D for Bb instruments).

### `writtenKeyToConcert(writtenKey, instrument): PitchClass`

Reverse key transposition.

### `transpose(midi, semitones): number`

Simple MIDI transposition.

### `transposePitchClass(pc, semitones): PitchClass`

Transpose a pitch class by semitones.

### `pitchClassInterval(from, to): number`

Ascending interval in semitones between two pitch classes.

### `isInRange(midi, instrument): boolean`

Check if a MIDI note is within an instrument's concert range.

---

## key-ordering.ts

Staged 12-key orderings for lick practice. The order a lick cycles through the 12 keys is chosen from a pool of "stages" unlocked at the current tempo.

### Ordering generators

| Function | Signature | Description |
|---|---|---|
| `circleOfFifthsFrom` | `(start) → PitchClass[]` | Rotate the standard circle of fifths so `start` is first |
| `chromaticFrom` | `(start) → PitchClass[]` | Semitone-step ordering starting on `start` |
| `wholeTonePairFrom` | `(start) → PitchClass[]` | The six keys of the whole-tone scale containing `start`, then the six keys of the complementary whole-tone scale |
| `shufflePitchClasses` | `(rng?) → PitchClass[]` | Fisher–Yates shuffle, RNG-parameterizable for deterministic tests |

### `KeyOrderingStage` type

```typescript
export type KeyOrderingStage = 0 | 1 | 2 | 3 | 4;
```

### `unlockedStages(tempo, minBpm): KeyOrderingStage[]`

Return the stages unlocked at `tempo`:
- Stage 0 always unlocked — circle of fifths from the player's written C.
- Stages 1 and 2 unlock linearly between `minBpm` and 150 BPM — circle of fifths / chromatic from a random root.
- Stages 3 and 4 unlock together at 150 BPM — whole-tone pair and full shuffle.

### `PlanLickKeysArgs` interface

```typescript
interface PlanLickKeysArgs {
  tempo: number;
  minBpm: number;
  instrument: InstrumentConfig;   // resolves "written C" for Stage 0
  rng?: () => number;
}
```

### `planLickKeys(args): PitchClass[]`

Pick a stage uniformly at random from `unlockedStages(tempo, minBpm)`, then draw that stage's 12-key ordering. The returned array is always a permutation of all 12 pitch classes.
