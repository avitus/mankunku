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

Complete scale catalog — 33 scales across 7 families.

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

Returns `['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']`.

### `circleOfFourths(): PitchClass[]`

Reverse of `circleOfFifths()` (without duplicating the starting note).

### `getNextKeyInCircle(current, direction?): PitchClass`

Return the next key around the circle of fourths. `direction` is `1` (fourths, default) or `-1` (fifths).

### `getKeyAtIndex(index: number): PitchClass`

Return the key at the given position in the circle of fourths. The index wraps around (negative values and values ≥ 12 are normalized via modulo).

### `relativeMajor(minorKey): PitchClass`

The relative major of a minor tonic (D → F). Used by the minor key-signature table and the editor's "Read as relative key" relabel.

### `relativeMinor(majorKey): PitchClass`

The relative minor of a major key (F → D).

### `realizeScale(root, intervals): number[]`

Returns pitch class indices (0–11) for a scale.

### `realizeScaleMidi(root, intervals, lowMidi, highMidi): number[]`

Returns all MIDI notes in a scale within a range.

### `scalePitchClasses(root, intervals): PitchClass[]`

Returns all pitch classes in a scale.

---

## lead-sheet.ts

### `leadSheetTuneFor(phrase, maxBars = LEAD_SHEET_MAX_BARS): { tune, startBar, bars }`

A lick as a one-system lead sheet for the lick-practice key stack: wraps the phrase as a single unlabelled, untitled `Tune` section (a phrase is one section, so offsets drop in unchanged) so `tuneToAbc` engraves chords above the staff and slashes melody-silent bars. Long cycles (a 12-bar blues under a 2-bar lick) are windowed to the bars the melody occupies, capped at `maxBars` (4) from its first bar, with notes rebased and harmony clipped to the window.

### `leadSheetAbcOptions(phrase, bars): TuneAbcOptions`

The row's engraving options: `mode: lickMode(phrase)`, `barsPerLine: bars` (one system), `stretchLast: true`, `measureNumbers: false`. These three options were added to `TuneAbcOptions` (`tune-notation.ts`) for this; every default is unchanged, so the tune goldens stay byte-identical.

## beat-cursor.ts

### `noteIndexAtBeat(notes, beat, timeSignature): number | null`

Index of the note sounding at a beat position (started, not yet ended); null before the first note, during a rest, for a negative (parked) beat, or an empty phrase. Drives the lead-sheet row's `cursorIndex`.

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
- **Enharmonic spelling follows one shared policy** (`resolveUseFlats` / `spellingContextAt`, below): the note's explicit `spelling` › the enharmonic the key signature already covers › the segment's declared scale › the governing chord › the key-side default. The chord and scale are judged at written pitch.
- Duration modifiers relative to `L:` value
- Final barline `|]`

Uses `KEY_SIG_ACCIDENTALS` lookup table (maps each key to its altered pitch classes) to determine which accidentals are implicit vs. explicit.

`phraseToAbc` is a thin wrapper around `phraseToAbcWithMap` (below) that discards the click-anchor map.

### `phraseToAbcWithMap(phrase, instrument?, defaultLength?): { abc, noteAnchors }`

Generate the same ABC string as `phraseToAbc`, plus a `noteAnchors: PitchedNoteAnchor[]` click-anchor map. Each anchor maps a rendered pitched-note token back to its index in `phrase.notes`, letting `NotationDisplay.svelte` resolve a click on a notehead to a source note (this powers click-to-select on the `/licks/editor` staff). Rest elements are intentionally absent from `noteAnchors`.

```typescript
export interface PitchedNoteAnchor {
  startChar: number;   // char index in the ABC string where this note's token begins
  endChar: number;     // char index just past the end of the token
  sourceIndex: number; // index into the original phrase.notes array
}
```

### `displayPitchClass(pc, keyContext, mode?): string`

Return a pitch class name spelled for a given key context (major by default). In flat keys `F#` reads `Gb`; in sharp keys a canonical flat name that is DIATONIC to the key is spelled the key's way (`G#` in A, `D#` in E) while chromatic roots keep their flat names. With `mode: 'minor'` the context is the minor key's DRAWN signature — the relative major's, or six flats for Eb minor, where every flat name is kept and only `F#` → `Gb`. Used by chord charts and the UI chips that show the current scale's notes.

### Enharmonic spelling policy

One chain decides sharp-vs-flat for every named pitch — the chart renderer and every note-name display call it — so a session's note list spells exactly what its chart showed.

| Function | Description |
|---|---|
| `chordSpellingPreference(midi, root, quality)` | `'sharp' \| 'flat' \| null` — proper interval spelling against the governing chord (the third of A7 is C#, the minor third of C-7 is Eb). Letter steps from the chord root; the quality guesses the three ambiguous degrees (b3 vs #9, b5 vs #11, #5 vs b13). Abstains for white keys and double accidentals. |
| `scaleSpellingPreference(midi, root, degrees)` | `'sharp' \| 'flat' \| null` — the declared scale's answer for **only** those three ambiguous degrees: a blues line over C7 carries Eb and Gb, not the #9/#11 the dominant quality suggests. Abstains everywhere else, so a theoretical mode label (the altered scale's "b4") never respells an unambiguous chord tone. |
| `signatureSpelling(pc, sig)` | The enharmonic already in the key signature (a C# in D major must not print as Db), or null. |
| `resolveUseFlats(midi, ctx: SpellingContext)` | The chain: `explicit` › signature › scale › chord › `defaultFlats` (the drawn signature's side — `signatureFlatsFor(key, mode)`: flats iff the display key is in `FLAT_KEYS`, or its relative major is, or it is Eb minor). |
| `spellingContextAt({ displayKey, mode?, harmony?, offset?, transpositionSemitones?, scaleId?, explicit? })` | Builds the `SpellingContext` the chart uses for one note (`mode` = major/minor reading of `displayKey`, default major — a minor key draws the relative major's signature and, with no chord and no `scaleId`, frames itself in harmonic minor at the tonic): the chord governing `offset` (concert harmony, roots shifted to written pitch and respelled for the key) with its declared scale; or, when no chord governs, `scaleId` rooted at the key with the chord it implies (`chordApplications[0]`). |

The scale fallback is what makes a key with no signature spell "true to the key": written C alone says nothing about Bb vs A#, but C blues does (2026-08-22 user report — a written-C blues session listed its b7 as A#).

### Minor keys — `signatureAccidentalsFor`, `signatureFlatsFor`, `keyLabel`, `keyLabelLong`, `abcKeyField`

A lick's `key` is its TONIC; `Phrase.mode` (resolved by `lickMode` in `music/mode.ts` — explicit › harmony's tonic segment › major, never the category) says how to read it. `signatureAccidentalsFor(key, mode)` draws the relative major's signature for a minor key — six flats for Eb minor, whose relative major the canonical pitch-class map spells F# — and `signatureFlatsFor` gives the key-side flat/sharp default. Labels: `keyLabel('D','minor')` → `Dm`, `keyLabel('Eb','minor')` → `Ebm`, `keyLabel('Ab','minor')` → `G#m`, `keyLabel('Db','minor')` → `C#m` (sharp-side names for the two tonics whose relative majors are sharp keys, so label and drawn signature agree); `keyLabelLong` → `D minor`; `abcKeyField` → the `K:` field (`Dm`, `Ebm`, `G#m`, `C#m` — all read by abcjs). `phraseToAbcWithMap` reads `lickMode(phrase)`, prints `K:Dm`, and passes `mode` into `spellingContextAt`, where a minor key with no governing chord and no scale frames itself in harmonic minor rooted at the tonic (leading tone sharp, b6 flat). `displayPitchClass(pc, keyContext, mode?)` respells chord roots against the minor key's drawn signature.

### `midiToDisplayName(midi, useFlatsOrKey?, scaleId?, mode?): string`

Convert MIDI to display name (e.g. `60 → 'C4'`, `58 → 'Bb3'`). The second argument is either an explicit `useFlats` boolean (default `true`) or a written key name, in which case the name goes through the spelling policy above — key signature, then the optional `scaleId` rooted at the key, then the key-side default. `midiToDisplayName(70, 'C')` is `'A#4'`; `midiToDisplayName(70, 'C', 'blues.minor')` is `'Bb4'`.

---

## tune-notation.ts

ABC generation from a `Tune` — the multi-system leadsheet renderer. **A separate entry point from `notation.ts`**: `phraseToAbc` is untouched by anything here, so lick rendering can never regress from a chart change.

### `tuneToAbc(sheet, instrument?, options?): string`

Render a full song form: chord symbols above the staff, section letters, repeat barlines, numbered endings, slash bars for melody-silent measures, and density-aware multi-system reflow.

| Parameter | Type | Description |
|---|---|---|
| `sheet` | `Tune` | The tune to render |
| `instrument` | `InstrumentConfig?` | If provided, transposes to that instrument's written pitch |
| `options` | `TuneAbcOptions` | Layout overrides; defaults to `{}` |

`instrument` is the **second** positional parameter, matching `phraseToAbc`. Passing options where the instrument belongs silently renders at concert pitch.

```typescript
interface TuneAbcOptions {
  defaultLength?: Fraction;   // ABC L: field
  barsPerLine?: number;       // Bars per system before a line break
}
```

The chart is emitted as two voices: **M** (melody) and **H** (the chord line). Any `"` or control character in an imported `HarmonicSegment.symbol` is stripped before emission — ABC delimits chord annotations with double quotes, so a raw imported symbol containing one would break the whole voice-line's parse. Legitimate chord text never contains them, so this is lossless in practice.

### `tuneToAbcWithMap(sheet, instrument?, options?): { abc, noteAnchors, barAnchors, chordSlotAnchors, … }`

Same parameters as `tuneToAbc` — which is a thin wrapper that discards everything but `abc`. Returns the ABC plus `noteAnchors` (the same `PitchedNoteAnchor[]` shape `phraseToAbcWithMap` produces, indexing the notation-order flattened notes) and the char-span anchors the hit-zone layer maps onto rendered geometry:

```typescript
interface BarAnchor {         // one rendered melody bar (voice M)
  startChar: number;          // first melody token of the bar
  endChar: number;            // just past its closing barline token
  sectionIdx: number;
  bar: number;                // 0-based within the section
}

interface ChordSlotAnchor {   // one chord-voice segment (voice H)
  startChar: number;          // includes the quoted "chord" prefix
  endChar: number;
  sectionIdx: number;
  bar: number;
  beat: number;               // segment start within the bar, float (off-beats like 1.5)
  chord: string | null;       // display text when this segment starts a chord event
}
```

Bar spans deliberately exclude leading `|:` / `[n` decorations and any inter-system chord flush. Chord segments are cut at chord events, sound-span boundaries, and bar edges, so one bar can hold several slots.

These drive on-chart click-to-edit and the inline chord editor in `NotationDisplay.svelte`. See [Tune System](../architecture/tune-system.md#engraving).

---

## chart-layout.ts

Pure engraving layout policy for tune charts.

| Export | Purpose |
|---|---|
| `CHART_STAFF_WIDTH` | abcjs staff width in user units (750 — wider than the phrase default, for print-like density) |
| `BARS_PER_LINE_MIN` / `_MAX` / `_DEFAULT` | 3 / 6 / 4 |
| `suggestBarsPerLine(sheet)` | Density-aware reflow — dense sixteenth-note heads pack fewer bars per system, sparse intros pack more |
| `slashCountForMeter(ts)` | Rhythmic slashes for an empty bar: one per beat in simple meters, one per compound beat in 6/8, 9/8, 12/8 (the jazz chart convention) |
| `slashCellDuration(ts)`, `slashBarAbc(...)` | Emit the slash bar |
| `emptyMelodyBars(sheet)` | Which printed bars have no melody |
| `multiRestRuns(...)` | Consecutive-empty-bar runs, for multi-rest collapse |

---

## chord-layout.ts

Structured chord-symbol layout, MuseScore Jazz style — root + quality on the main baseline, alterations stacked in a column **to the right of the quality** (never over the root), slash bass hanging below:

```text
E7  b9
    #11
   /G
```

`layoutChordParts` / `layoutFromChordSymbol` produce `ChordLayoutParts`; `chordTspanSpecs` turns those into positioned SVG tspans; `chordDisplayLine` / `chordAbcAnnotation` produce the flat-text forms. `CHORD_STACK_GAP_EM` and `alterationStackX` are the geometry constants.

---

## ending-layout.ts

Pure first/second-ending (volta) placement policy, following Sibelius / Real Book convention:

- `[1]` continues the approach system when there's room (inline).
- `[2]` **always** opens a fresh system with no musical pad bars; its alignment under `[1]` is a post-render indent, not invisible measures inside the volta.
- When `[1]` would start at the left margin, both endings start at column 0.
- Stacked `[2]` glyphs are **repositioned, never horizontally scaled** — scaling noteheads and chords was the original source of squashing and "2"/chord collisions.

`initialEndingLayoutState` / `placeEndingSection` / `advanceEndingLayout` drive the incremental walk; `planEndingPlacements` does it in one pass. `endingAlignTransform` / `endingAlignMatrix` produce the post-render transform applied by `notation/ending-align-dom.ts`.

---

## chord-symbol.ts

The canonical chord model. `ChordSymbol` preserves what a lead sheet actually says — base quality, stacked extension, alterations, slash bass — independent of the closed `ChordQuality` union the audio layer voices.

| Export | Purpose |
|---|---|
| `ChordBaseQuality` | `'maj' \| 'min' \| 'dom' \| 'dim' \| 'halfdim' \| 'aug' \| 'minmaj' \| 'sus4' \| 'sus2'` |
| `parseChordSymbol(input)` | Text → `ChordSymbol`, or `null` when unparseable |
| `formatChordSymbol(cs)` | `ChordSymbol` → canonical display text |
| `transposeChordSymbol(cs, semitones, …)` | Transpose with correct re-spelling |
| `chordSymbolToQuality(cs)` | Map onto the nearest playable `ChordQuality` for the audio layer |

The raw source string travels separately in `HarmonicSegment.symbol`, so **display never loses fidelity** even where the enum mapping is lossy.

---

## progression-display.ts

### `progressionColor(type): string`

Each of the ten `ChordProgressionType` values has an identity hue, returned as a `var(--prog-*)` reference so it stays theme-aware (hues live in `src/app.css` for both themes, mirroring how `difficultyDisplay` returns `var(--difficulty-N)`).

The backing map is an explicit `Record<ChordProgressionType, string>`, so **a new progression won't type-check until it has a colour**. Unknown/legacy tags fall back to `var(--color-accent)` rather than rendering an invalid colour.

The colour is carried through the library card (tinted category pill + dots), the lick-practice session header, and the insertion-point bands on a tune chart — so a progression looks the same everywhere it appears.

---

## scale-degree.ts

`scaleDegreeOf(...)` labels a pitch class against a tonic as a `ScaleDegree` (`'1'`, `'b3'`, `'#4'`, …). Used by the progression detector to label a detected local key against the tune's global key ("the IV key").

---

## Smaller modules

| Module | Purpose |
|---|---|
| `harmony.ts` | Harmony lookup helpers shared by playback and scoring |
| `swing.ts` | Swing-ratio math for eighth-note pairs. `applySwingToBeats(beats, swing)` shifts only off-beat eighths (triplets are immune by construction) and is shared by playback, scoring and backing. `swingForTempo(bpm)` is the Friberg–Sundström curve, `min(0.78, max(0.5, 1 − bpm/600))`. The uncapped `1 − bpm/600` term is what holds the short eighth near 100 ms; the 0.78 clamp overrides it below ~132 BPM, pinning the ratio at ≈3.5:1 and letting the short eighth grow in absolute terms (≈220 ms at 60 BPM). Straight by 300. It belongs only to the **backing** engine: a unit test bans it from playback, scoring and tricks, because the band's feel must never move the grid the player is graded against |
| `key-ordering.ts` | `planUnlockedKeys` — the alternating sharp/flat-side ramp out from a lick's entry key on the circle of fifths, returning the first N keys while a lick has fewer than 12; `planLickKeys` takes over for staged variety once all 12 are earned. Also the raw orderings (`circleOfFifthsFrom`, `circleOfFourthsFrom`, `chromaticFrom`, `wholeTonePairFrom`, `shufflePitchClasses`) and the tempo-gated `unlockedStages` |
| `expression.ts` | Tier-1 musical expression (dynamics + articulation) applied as a pure pass at `phraseToEvents` |
| `articulation-abc.ts` | Articulation → ABC decoration mapping |

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

Key orderings for lick practice, in two phases: a gradually-unlocked ramp (`planUnlockedKeys`) used until a lick has earned all 12 keys, then staged 12-key orderings (`planLickKeys`) chosen from a pool of tempo-gated "stages".

### `planUnlockedKeys(entryKey, unlockedCount): PitchClass[]`

Build the gradually-unlocked key set for a lick that hasn't reached its full 12-key range. Adds keys easiest-to-hardest by accidental count, alternating sharp/flat neighbours of `entryKey` on the circle of fifths (entry, +1 fifth, -1 fifth, +2 fifths, ..., ±6). Returns the first `unlockedCount` keys (clamped to 1..12). For entry key C: C, G, F, D, Bb, A, Eb, E, Ab, B, Db, F#. Once `unlockedCount` reaches 12, callers switch to `planLickKeys`.

### Ordering generators

| Function | Signature | Description |
|---|---|---|
| `circleOfFifthsFrom` | `(start) → PitchClass[]` | Rotate the standard circle of fifths so `start` is first |
| `circleOfFourthsFrom` | `(start) → PitchClass[]` | Rotate the standard circle of fourths so `start` is first (used for ramp-up display ordering) |
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
