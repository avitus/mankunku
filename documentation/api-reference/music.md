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

Names use the app's canonical pitch-class spellings (flats, except `F#`). `noteNameToMidi` also accepts the other enharmonics — `C# D# G# A#` map to their flats, `Gb` to `F#`, and `Cb`/`B#`/`Fb`/`E#` to their naturals, with `Cb4` = B3 and `B#3` = C4 crossing the octave boundary correctly; anything else throws.

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
| `maj7` | Major 7th | [0, 4, 7, 11] | `Δ7` |
| `min7` | Minor 7th | [0, 3, 7, 10] | `-7` |
| `7` | Dominant 7th | [0, 4, 7, 10] | `7` |
| `min7b5` | Half-Diminished | [0, 3, 6, 10] | `-7b5` |
| `dim7` | Diminished 7th | [0, 3, 6, 9] | `dim7` |
| `7alt` | Altered Dominant | [0, 4, 6, 10] | `7alt` |
| `minMaj7` | Minor-Major 7th | [0, 3, 7, 11] | `-Δ7` |
| ... | (18 total) | ... | ... |

Symbols are the canonical ASCII-plus-Δ text (`formatChordSymbol` and ABC annotations use the same convention); the pretty forms (`Dø⁷`, `C-⁷`, `G⁷⁽♭⁹⁾`) are DISPLAY-ONLY and come from `chord-layout.ts`'s `chordDisplayModel`.

### `chordTones(rootMidi, quality): number[]`

Get chord tones as MIDI notes from a root MIDI note.

### `chordSymbol(root, quality): string`

Root + canonical symbol (e.g. `chordSymbol('D', 'min7')` → `'D-7'`).

---

## keys.ts

Key signatures, circle of fifths, and scale realization.

### `keySignatureAccidentals(key): number`

Sharps (positive) or flats (negative) for a major key. E.g. `'Bb' → -2`, `'D' → 2`.

### `circleOfFifths(): PitchClass[]`

Returns `['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']`.

### `circleOfFourths(): PitchClass[]`

Reverse of `circleOfFifths()` (without duplicating the starting note).

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

### `leadSheetTuneFor(phrase, maxBars = LEAD_SHEET_MAX_BARS): LeadSheet`

A lick as a one-system lead sheet for the lick-practice key stack: wraps the phrase as a single unlabelled, untitled `Tune` section (a phrase is one section, so offsets drop in unchanged) so `tuneToAbc` engraves chords above the staff and slashes melody-silent bars. Long cycles (a 12-bar blues under a 2-bar lick) are windowed to the bars the melody occupies, capped at `maxBars` (`LEAD_SHEET_MAX_BARS`, 4) from its first bar, with notes rebased and harmony clipped to the window — a fixed-height row cannot hold twelve bars on one staff and must not wrap. Returns `LeadSheet = { tune, startBar, bars }` (`startBar` the first engraved bar of the cycle, 0-based).

### `leadSheetAbcOptions(phrase, bars): TuneAbcOptions`

The row's engraving options: `mode: lickMode(phrase)`, `barsPerLine: bars` (one system), `stretchLast: true`, `measureNumbers: false`. These three options were added to `TuneAbcOptions` (`tune-notation.ts`) for this; every default is unchanged, so the tune goldens stay byte-identical.

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

Generate the same ABC string as `phraseToAbc`, plus a `noteAnchors: NoteAnchor[]` click-anchor map. Each anchor maps a rendered element — pitched note **or rest** — back to its index in `phrase.notes`, letting `NotationDisplay.svelte` resolve a click on the staff to a source element (this powers click-to-select on the `/licks/editor` staff, where ←/→ stop on rests MuseScore-style). A merged display rest is anchored to a REPRESENTATIVE source rest (the first it overlaps) with `sourceIndexEnd` closing the range when the segment swallowed several. Reads `lickMode(phrase)` for the `K:` field and the drawn signature.

```typescript
export interface NoteAnchor {
  startChar: number;       // char index in the ABC string where this element's token begins
  endChar: number;         // char index just past the end of the token
  sourceIndex: number;     // index into the original phrase.notes array
  rest?: true;             // present when the anchor covers a rest element
  sourceIndexEnd?: number; // last source rest a merged display rest covers
  offset?: number;         // absolute whole-note offset — tune path only
  gliss?: boolean;         // this note starts a glissando into the next pitched note
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

### Low-level ABC primitives

Exported so `tune-notation.ts` (and the tests) can reuse them; `phraseToAbcWithMap` orchestrates them for a lick.

| Export | Purpose |
|---|---|
| `KeySigMap`, `KEY_SIG_ACCIDENTALS`, `FLAT_KEYS` | A key's altered letters (`'^'` sharp / `'_'` flat), the per-key table, and the five conventionally-flat keys (`F Bb Eb Ab Db`) |
| `SHARP_LETTER` / `FLAT_LETTER` | Black-key pitch class → the letter each enharmonic spelling uses |
| `keyChipLabel(writtenKey, mode?)` | Chord-symbol-style key chip: `D`, `D-`, `Eb-`, `G#-` — minor takes the jazz `-` suffix (the key ring's dots); `keyLabel` gives the `Dm` form |
| `governingSegment(harmony, offset)` | The chord governing a note offset: the last change at or before it — segments are change points, a chord rules until the next one |
| `BarAccidentalState`, `initBarState(sig)` | Per-bar accidental memory (an accidental shown on a letter persists to the bar's end), seeded from the signature at every barline |
| `midiToAbcPitch(midi, useFlats, keySigAccidentals, barState)` | One note's ABC pitch token, emitting `^`/`_`/`=` only when the bar state requires it and mutating the state |
| `durationToAbc(duration, defaultLength)` | Duration multiplier relative to `L:` |
| `getTripletBase(d)`, `sameDuration(a, b)`, `shorterFraction(a, b)`, `approxToFraction(f)` | Triplet → base-duration lookup, fraction equality, the shorter of two fractions, float → nearest standard musical fraction |
| `getBeamGroupDuration(timeSignature, minDurationInGroup)` | Beam span: eighth-or-longer runs beam in fours in 4/4 and 2/4 (the lead-sheet convention); any 16th in the span reverts it to per-beat beaming |
| `mergeConsecutiveRests(notes, timeSignature)` | Collapses runs of rests into standard groupings; returns `{ display, sourceMap, sourceEndMap }` so anchors can point a merged rest back at its source run |

---

## mode.ts

The single resolver for "is this lick major or minor". `Phrase.key` is always the TONIC; `Phrase.mode` says how to read it, and when absent (legacy rows, curated licks written before the field) the HARMONY decides.

| Export | Purpose |
|---|---|
| `lickMode(phrase)` | `Mode`: explicit `mode` › `harmonyTonicMode` › `'major'` |
| `harmonyTonicMode(phrase)` | The mode the harmony implies for the tonic, or `null` when nothing is rooted on the key (a ii-chord lick keyed C over Dm7 says nothing about C). The RESOLUTION decides — the last segment on the key root by time — and it reads minor iff its quality is in `MINOR_TONIC_QUALITIES` |
| `MINOR_TONIC_QUALITIES` | `min7`, `min6`, `minMaj7` — a ø or dim chord on the root is not a tonic |
| `MINOR_CATEGORIES` | `ii-V-I-minor`, `short-ii-V-I-minor`, `V-I-minor`, `minor-chord` — categories whose licks are minor by construction; they seed the **editor's default mode only** |

**Never infer from the category.** The user's existing minor-category licks were entered with key = the relative MAJOR (the editor's key signature was major-only), so a category rule would relabel a "D minor lick stored as F" as F minor.

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
  mode?: Mode;                // How to read sheet.key: 'minor' draws the relative
                              // major's signature and prints K:Dm (default 'major')
  stretchLast?: boolean;      // Stretch the last system to the full staff width
                              // (default false — short systems stay short)
  measureNumbers?: boolean;   // Measure number at each system start (default true)
}
```

`mode`, `stretchLast` and `measureNumbers` were added for the lick-practice lead-sheet row (`lead-sheet.ts`); every default is unchanged, so existing output is byte-identical.

The chart is emitted as two voices: **M** (melody) and **H** (the chord line). Any `"` or control character in an imported `HarmonicSegment.symbol` is stripped before emission — ABC delimits chord annotations with double quotes, so a raw imported symbol containing one would break the whole voice-line's parse. Legitimate chord text never contains them, so this is lossless in practice.

**Pickup (anacrusis) bars.** The timeline keeps a FULL bar and only the engraving is short: for every section `resolvePickupLength` (`pickup.ts`) decides the printed length, and the renderer gap-fills from the silent prefix (stored rests inside it dropped, a straddling note clipped), shortens `chordBar`'s spacers in voice H to match, breaks lines so the partial bar occupies no bars-per-line column (`EndingSectionShape.pickupBar`), and emits `[I:setbarnb 1]` after its barline because abcjs would otherwise count the anacrusis as bar 1. A pickup-only section (blank label, one bar) closes with a thin `|` — or lets the next section's `|:` be its barline, since a thin bar before `|:` prints two — and carries the boxed letter of the section it leads into, because abcjs draws part labels only at a line start; `NotationDisplay` then nudges that box over the first full bar.

The module re-exports `CHART_STAFF_WIDTH`, `suggestBarsPerLine`, `slashBarAbc`, `emptyMelodyBars`, `multiRestRuns` (chart-layout.ts) and `placeEndingSection` (ending-layout.ts) so call sites share one surface.

### `tuneToAbcWithMap(sheet, instrument?, options?): { abc, noteAnchors, barAnchors, chordSlotAnchors }`

Same parameters as `tuneToAbc` — which is a thin wrapper that discards everything but `abc`. Returns the ABC plus `noteAnchors` (the same `NoteAnchor[]` shape `phraseToAbcWithMap` produces, indexing the notation-order flattened notes, with `offset` populated on this path) and the char-span anchors the hit-zone layer maps onto rendered geometry:

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

## pickup.ts

The ONE resolver for a tune's anacrusis. The timeline never has a short bar — a pickup occupies a full meter bar with its melody right-aligned (leading silence), so playback, the backing grid, the playhead and every `bars × barLength` consumer stay uniform. Only notation and its hit geometry care about the PRINTED length, and they all read it here.

### `resolvePickupLength(sheet, secIdx): Fraction | null`

The printed length of a section's first bar, or `null` for a full bar. Two sources, in order: (1) the explicit `TuneSection.pickupLength` when it is strictly inside one bar and no pitched note of bar 0 starts inside the silent prefix it implies; (2) otherwise, ONLY for the legacy import shape every importer wrote before the field existed — the FIRST section, blank label, exactly one bar, with more sections after it — the length inferred from the melody, so pre-field imports and community tunes render right with no re-import and no hydrate-time write. A lone blank section is a lick's lead-sheet window, never a pickup; a labelled section whose first bar is a padded pickup (the curated Amazing Grace / Saints charts) needs the field.

| Export | Purpose |
|---|---|
| `pickupLengthFromMelody(notes, timeSignature)` | Bar minus the earliest PITCHED onset, floored to the beat unit (a note on the and-of-4 is still a one-beat pickup); stored rests ignored — an explicit leading rest is how the editor writes the prefix back. `null` when bar 0 has no pitched note or starts on the downbeat |
| `pickupPrefix(length, ts)` / `pickupFirstBeat(length, ts)` | The silent lead-in (one bar minus the length) as a fraction, and as a beat index in denominator-note beats (may be fractional) |
| `isPickupOnlySection(sheet, secIdx)` | A blank-labelled one-bar section that IS the pickup — the import shape, and what the editor's Pickup control creates |
| `pickupLengthOptions(ts)` | Every eighth-note multiple strictly inside one bar — the editor's choices |
| `pickupLengthLabel(length, ts)` | `"½ beat"`, `"1 beat"`, `"1½ beats"` — named EXACTLY in the meter's beats (eighth multiples are half beats in 4/4 but quarter beats in 2/2); a remainder with no glyph is spelled out (`"1/16 beat"`), never rounded |

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
| `multiRestRuns(sheet, emptyBars, chordEvents)`, `MultiRestRun` | Consecutive-empty-bar runs (≥ 2) with no chord change after the run's downbeat — multi-measure-rest candidates; a mid-run chord change keeps slash bars |

Empty bars currently engrave as beat-aligned slashes (jazz idiom). Collapsing them to ABC `Z{n}` multi-rests is **deferred** — it fights bar anchors, system reflow and playhead zones — so the two multi-rest helpers are exported for callers and tests only.

---

## chord-layout.ts

The app-wide **pretty chord convention** (chosen 2026-08-26), rendered by NotationDisplay's SVG tspans, the HTML chord chart and `ChordSymbolText`, all in `--chord-font` (Fraunces + Edwin supplying Δ ♭ ♯). DISPLAY-ONLY: canonical and serialized strings stay ASCII-plus-Δ (`formatChordSymbol`, ABC text); this layer maps them to what the reader sees.

### `chordDisplayModel(cs, keyContext?): ChordDisplayModel` · `chordDisplayModelFromText(text, keyContext?)`

```typescript
interface ChordDisplayModel {
  root: string;                 // "C", "B♭", "F♯" — baseline, full size
  baselineQuality: '' | '-';    // the minor "-" (also min-maj) — baseline, full size
  sup: string;                  // ONE superscript run: "7", "Δ7", "ø7", "°7", "+7", "7sus4", "7(♭9)", "7alt", ""
  supStack: string[] | null;    // two+ alterations as a stacked column ("♭9", "♯11"), else null
  bass: string | null;          // slash bass without the slash
}
```

Root and the minor `-` sit full-size on the baseline; everything after them is one superscript run — extensions, Δ, ø, °, +, sus, and a **single** accidental alteration parenthesized (`G⁷⁽♭⁹⁾`, `Dø⁷`, `C-⁷`, `F♯°⁷`). Two or more accidental alterations become `supStack`, one tall paren pair around a vertical column (the renderer draws the parens); word tokens (`alt`, `add9`) append bare — jazz never parenthesizes them. Accidentals are real glyphs; the ASCII stays in `aria`/`title` attributes and editable inputs. The text form returns the input as a bare root when unparseable, so the engraver never drops ink.

### `chordTspanSpecs(model): ChordTspanSpec[]` · `CHORD_SUP_SIZE_EM` (0.58) · `CHORD_SUP_RISE_EM` (−0.42)

Pure engraving geometry: root and `-` flow on the baseline at size 1; the sup run flows after them at `CHORD_SUP_SIZE_EM`, raised by `CHORD_SUP_RISE_EM` (top near the root's cap height); a stack is a raised column at 0.56 em wrapped in one paren pair sized `0.62 + 0.32·n`, flagged `stackRight` so the renderer places it past the measured right edge of the main line; the bass hangs below at 0.72 em. Each spec carries `{ text, size, dyEm, role, stackRight }` with `role` one of `root | quality | sup | alteration | paren | bass`.

### Structural parts — `layoutChordParts(text, keyContext?)` · `layoutFromChordSymbol(cs, keyContext?)` · `ChordLayoutParts`

The unprettified split `{ root, quality, alterations[], bass }` (roots and bass respelled for the key via `displayPitchClass`) that the display model is built from. `formatAlterations(alts)` renders the tokens for single-line contexts (one bare, two+ as `(b9,#11)`), `chordDisplayLine(text, keyContext?)` is the compact flat form (`E7(b9,#11)/G`). `CHORD_STACK_GAP_EM` (0.12) and `alterationStackX(mainBox, baseSize, gapEm?)` give the column's left edge from the painted main-line box — callers must place alterations with `text-anchor="start"`, or abcjs's default `middle` centres each one on that point and paints its left half over the quality.

---

## ending-layout.ts

Pure first/second-ending (volta) placement policy, following Sibelius / Real Book convention:

- `[1]` continues the approach system when there's room (inline).
- `[2]` **always** opens a fresh system with no musical pad bars; its alignment under `[1]` is a post-render indent, not invisible measures inside the volta.
- When `[1]` would start at the left margin, both endings start at column 0.
- Stacked `[2]` glyphs are **repositioned, never horizontally scaled** — scaling noteheads and chords was the original source of squashing and "2"/chord collisions.

`EndingSectionShape` is `{ bars, ending?, pickupBar? }`: a section whose first bar is a partial pickup fills one column fewer (`columnsOf(sec)` = `bars − 1`), and a one-bar section with it — the lone pickup section every importer writes — fills none at all and leaves its system open for the section after it.

`initialEndingLayoutState` / `placeEndingSection` / `advanceEndingLayout` drive the incremental walk; `planEndingPlacements` does it in one pass (a test scaffold — the notation pass places sections inline). `endingAlignTransform` / `endingAlignMatrix` produce the post-render transform (`x' = sx·x + tx`, line art only) applied by `notation/ending-align-dom.ts`; the rigid-glyph helpers keep noteheads, barlines and chord text at their own width under it — `endingGlyphTranslateDx` / `endingGlyphTranslate` (pure translate of a glyph centre, never a scale), `rigidGlyphScreenSpanAfterTranslate`, `endingLabelHookNudge` (+dx so the full-size volta number clears the scaled left hook by `ENDING_LABEL_HOOK_MIN_GAP`, 5 u), `endingChordGroupNudge` (uniform +dx so every chord clears the label by `ENDING_LABEL_CHORD_MIN_GAP`, 8 u), `endingChordVerticalMatchDy` (drops a floating `[2]` chord row onto `[1]`'s; never raises it), `meanFinite`, and `planStackedEndingRigidGlyphs`, which composes them under four test-locked invariants (glyph width unchanged, centres map to `sx·cx + tx`, the number clears the hook, label and chords never overlap).

---

## chord-symbol.ts

The canonical chord model. `ChordSymbol` preserves what a lead sheet actually says — base quality, stacked extension, alterations, slash bass — independent of the closed `ChordQuality` union the audio layer voices.

| Export | Purpose |
|---|---|
| `ChordBaseQuality` | `'maj' \| 'min' \| 'dom' \| 'dim' \| 'halfdim' \| 'aug' \| 'minmaj' \| 'sus4' \| 'sus2'` |
| `parseChordSymbol(input)` | Text → `ChordSymbol`, or `null` when unparseable |
| `formatChordSymbol(cs)` | `ChordSymbol` → canonical display text |
| `transposeChordSymbol(symbol, semitones)` | Takes the raw chord TEXT: parses it, transposes root and slash bass by pitch class, re-formats canonically. `undefined` for missing or unparseable text — callers drop the symbol rather than display a wrong-key one |
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

`scaleDegreeOf(root, key): ScaleDegree` labels a chord root against a key in the **major-scale frame** (`Tune.key` carries no mode) as `{ semitones, degree, accidental, label }` — labels `'1' 'b2' '2' 'b3' '3' '4' '#4' '5' 'b6' '6' 'b7' '7'`, flat-preferred except the tritone. Used by the progression detector to label a detected local key against the tune's global key ("the IV key").

---

## Smaller modules

| Module | Purpose |
|---|---|
| `harmony.ts` | `findHarmonyAt(harmony, wholeNotePosition)` — the segment active at a whole-note position; falls back to the FINAL segment only for positions past its end (a note ringing past the last chord), `null` before the first segment, inside a gap, or with no harmony at all. Shared by playback and scoring |
| `swing.ts` | Swing-ratio math for eighth-note pairs. `STRAIGHT_SWING` (0.5) is the floor of the setting and the value every "no swing" branch tests against; `MAX_SWING` (0.8) the heaviest the UI allows. `applySwingToBeats(beats, swing)` shifts only off-beat eighths (triplets are immune by construction) and is shared by playback, scoring and backing. `swingForTempo(bpm)` is the Friberg–Sundström curve, `min(0.78, max(0.5, 1 − bpm/600))`. The uncapped `1 − bpm/600` term is what holds the short eighth near 100 ms; the 0.78 clamp overrides it below ~132 BPM, pinning the ratio at ≈3.5:1 and letting the short eighth grow in absolute terms (≈220 ms at 60 BPM). Straight by 300. It belongs only to the **backing** engine: a unit test bans it from playback, scoring and tricks, because the band's feel must never move the grid the player is graded against |
| `key-ordering.ts` | `planUnlockedKeys` — the alternating sharp/flat-side ramp out from a lick's entry key on the circle of fifths, returning the first N keys while a lick has fewer than 12; `planLickKeys` takes over for staged variety once all 12 are earned. Also the raw orderings (`circleOfFifthsFrom`, `circleOfFourthsFrom`, `chromaticFrom`, `wholeTonePairFrom`, `shufflePitchClasses`), the tempo-gated `unlockedStages`, and `MAX_UNLOCKED_KEYS` (12) — see the full section below |
| `expression.ts` | Tier-1 musical expression (dynamics + articulation) applied as a pure pass at `phraseToEvents`. `extractSoundingNotes(notes)` is the rest-skip + tie-merge walk producing `SoundingNote[]` (mirrors `phraseToEvents` exactly, so the two stay aligned; also what `scoreAttempt` scores against); `computeExpression(...)` yields one `NoteExpression` per sounding note — authored `velocity` / `articulation` honoured as explicit intent, everything else derived from metric position, harmonic role, contour and phrase shape. `ExpressionOptions` / `ExpressionIntensity` (`'subtle' \| 'moderate' \| 'pronounced'`) tune the pass |
| `articulation-abc.ts` | `articulationAbcPrefix(articulation)` / `noteArticulationPrefix(note)` — accent → `!>!`, staccato → `.`, ghost → `!pp!`, bend-up → `!slide!`; legato and normal print nothing (a slur needs a multi-note span) |

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

### `MAX_UNLOCKED_KEYS: 12`

The full circle — the ceiling on any per-item unlocked-key count. Lives here rather than in the persistence layer because it is a fact about music, not storage; the stores that clamp their unlock counters import it from this module, and `newestUnlockedKey` (state/lick-practice-rotation.ts) returns `null` at it.

### `planUnlockedKeys(entryKey, unlockedCount): PitchClass[]`

Build the gradually-unlocked key set for a lick that hasn't reached its full 12-key range. Adds keys easiest-to-hardest by accidental count, alternating sharp/flat neighbours of `entryKey` on the circle of fifths (entry, +1 fifth, -1 fifth, +2 fifths, ..., ±6). Returns the first `unlockedCount` keys (clamped to 1..12). For entry key C: C, G, F, D, Bb, A, Eb, E, Ab, B, Db, F#. Once `unlockedCount` reaches 12, callers switch to `planLickKeys`. The ramp's LAST entry is the key being learned — the lead-sheet reveal rule keys off it, no timestamp needed.

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
