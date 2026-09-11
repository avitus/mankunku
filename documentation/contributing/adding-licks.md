# Adding Curated Licks

Step-by-step guide to adding new curated licks to Mankunku's catalog.

## Overview

Curated licks are stored as TypeScript arrays in `src/lib/data/licks/`. All licks are written in **concert C** — on the TONIC: a minor lick is C minor, `key: 'C'` with `mode: 'minor'` on the literal (never its relative major). The library loader transposes to other keys at query time (`transposeLickForTonality` in `phrases/library-loader.ts`; a minor cadence lick goes tonic → tonality root and is never snapped). Every lick in a minor category (`MINOR_CATEGORIES` in `music/mode.ts`) must resolve `lickMode(lick) === 'minor'` (pinned by `tests/unit/data/curated-minor-mode.test.ts`); the hand-written minor files carry the field explicitly because a short ii-V has no tonic segment to infer from.

Curated licks feed **ear training** — not the Licks page, which lists only the user's own and adopted-community licks, and not lick practice, which drills those.

## Step 1: Choose a File

Existing files (452 licks):

| File | `category` values | Count |
|---|---|---|
| `blues.ts` | `blues` | 120 |
| `blues-blue-note.ts` | `blues` | 75 |
| `beginner-cells.ts` | `pentatonic` (45), `blues` (10) | 55 |
| `major-4-7.ts` | `ii-V-I-major`, `bebop-lines`, `digital-patterns`, `major-chord` | 40 |
| `major-4-7-vol2.ts` | `ii-V-I-major`, `bebop-lines`, `digital-patterns`, `major-chord` | 40 |
| `ii-V-I-major.ts` | `ii-V-I-major` | 24 |
| `bebop-lines.ts` | `bebop-lines` | 20 |
| `ii-V-I-minor.ts` | `ii-V-I-minor` | 15 |
| `modal.ts` | `modal` | 10 |
| `pentatonic.ts` | `pentatonic` | 10 |
| `ballad.ts` | `ballad` | 7 |
| `rhythm-changes.ts` | `rhythm-changes` | 7 |
| `short-ii-V-I-major.ts` | `short-ii-V-I-major` | 6 |
| `short-ii-V-I-minor.ts` | `short-ii-V-I-minor` | 6 |
| `major-chord.ts` | `major-chord` | 4 |
| `dominant-chord.ts` | `dominant-chord` | 3 |
| `v-i-major.ts` | `V-I-major` | 3 |
| `minor-chord.ts` | `minor-chord` | 3 |
| `diminished-chord.ts` | `diminished-chord` | 2 |
| `v-i-minor.ts` | `V-I-minor` | 2 |

Add to an existing file for existing categories, or create a new file for a new category. A file may mix categories — `category` is per lick.

The combiner (`src/lib/phrases/combiner.ts`) generates a further **471** licks at import time, in C, by pairing the scale patterns in `src/lib/data/patterns/scale-patterns.ts` with the rhythm templates in `rhythm-patterns.ts` — every exact note-count fit, plus a shape laid two or three times (repeated, or sequenced a step up or down) to fill a longer rhythm. They carry `source: 'combined'` and join `ALL_CURATED_LICKS`, so ear training draws on 923 catalog licks before the player's own and adopted ones (`getAllLicks`). Don't add licks there by hand; to widen a category, add a pattern (its `category` must have a `CATEGORY_CONTEXT` entry in `combiner.ts`). `tests/unit/phrases/combinatorial-coverage.test.ts` checks that the ear-training categories stay covered.

## Step 2: Define the Lick

Each lick is a `Phrase` object. Here's an annotated example:

```typescript
{
  id: 'ii-V-I-maj-025',               // Unique ID: the file's prefix + next zero-padded number
  name: 'Ascending ii-V Resolution',  // Descriptive name
  timeSignature: [4, 4],              // Every curated lick is 4/4
  key: 'C',                           // Always C — the tonic (C minor for a minor lick)
  // mode: 'minor',                   // Required on hand-written minor licks; omit for major

  // Notes: pitch (MIDI, null = rest), duration, offset. Leave velocity/articulation
  // unset — the playback expression pass (music/expression.ts) shapes dynamics and
  // articulation from the line itself, and an authored value overrides it.
  notes: [
    { pitch: 62, duration: [1, 8], offset: [0, 1] },  // D4, eighth, beat 1
    { pitch: 64, duration: [1, 8], offset: [1, 8] },  // E4, eighth, beat 1.5
    { pitch: 65, duration: [1, 8], offset: [1, 4] },  // F4, eighth, beat 2
    { pitch: 67, duration: [1, 4], offset: [3, 8] },  // G4, quarter, beat 2.5
    { pitch: 64, duration: [1, 2], offset: [5, 8] },  // E4, half, beat 3.5
  ],

  // Harmony: chord progression for this lick
  harmony: [
    {
      chord: { root: 'D', quality: 'min7' },
      scaleId: 'major.dorian',
      startOffset: [0, 1],    // Start at beginning
      duration: [1, 1]        // One whole note (one bar)
    },
    {
      chord: { root: 'G', quality: '7' },
      scaleId: 'major.mixolydian',
      startOffset: [1, 1],
      duration: [1, 1]
    },
    {
      chord: { root: 'C', quality: 'maj7' },
      scaleId: 'major.ionian',
      startOffset: [2, 1],
      duration: [1, 1]
    }
  ],

  // Difficulty metadata
  difficulty: {
    level: 35,                // 1-100; must sit within ±35 of calculateDifficulty()
    pitchComplexity: 30,      // 1-100
    rhythmComplexity: 20,     // 1-100
    lengthBars: 2             // Number of bars
    // pickupBars: 1          // Optional: whole bars of lead-in before the bulk's downbeat
  },

  category: 'ii-V-I-major',  // Must match PhraseCategory type
  tags: ['diatonic', 'ascending', 'resolution'],  // Searchable tags
  source: 'curated'           // Always 'curated' for catalog licks
}
```

Ear training only offers a lick whose *effective* difficulty (`effectiveDifficultyLevel`, which also enforces a floor for the note count) is at or below the player's proficiency on the day's scale, so an under-rated lick still won't reach a beginner. It must also suit the day's scale type (`tonality/scale-compatibility.ts`): progression categories map through `CATEGORY_COMPATIBILITY`, everything else through its first harmony segment's `scaleId`.

## Step 3: Duration and Offset Reference

Durations and offsets are fractions of a **whole note**:

| Musical Value | Fraction | Example |
|---|---|---|
| Whole note | `[1, 1]` | |
| Half note | `[1, 2]` | |
| Quarter note | `[1, 4]` | |
| Eighth note | `[1, 8]` | |
| Dotted quarter | `[3, 8]` | |
| Triplet eighth | `[1, 12]` | |
| Dotted eighth | `[3, 16]` | |
| Sixteenth | `[1, 16]` | |

Offsets work the same way. Beat positions in 4/4:

| Beat | Offset |
|---|---|
| Beat 1 | `[0, 1]` |
| Beat 1.5 (and of 1) | `[1, 8]` |
| Beat 2 | `[1, 4]` |
| Beat 2.5 | `[3, 8]` |
| Beat 3 | `[1, 2]` |
| Beat 4 | `[3, 4]` |
| Bar 2, Beat 1 | `[1, 1]` |

## Step 4: MIDI Reference

Common MIDI note numbers (concert pitch):

| Note | MIDI | Note | MIDI |
|---|---|---|---|
| C3 | 48 | C4 | 60 |
| D3 | 50 | D4 | 62 |
| E3 | 52 | E4 | 64 |
| F3 | 53 | F4 | 65 |
| G3 | 55 | G4 | 67 |
| A3 | 57 | A4 | 69 |
| Bb3 | 58 | Bb4 | 70 |
| B3 | 59 | B4 | 71 |

Tenor sax range: MIDI 44 (Ab2) to 76 (E5) concert (`INSTRUMENTS` in `src/lib/types/instruments.ts`). The data-integrity test allows curated licks 44–84, leaving room for altissimo; playback transposition folds a line into the player's own range.

## Step 5: Register the Lick

If adding to an existing file, simply add the `Phrase` object to the exported array.

If creating a new file:

1. Create `src/lib/data/licks/your-category.ts`:
   ```typescript
   import type { Phrase } from '$lib/types/music';

   export const YOUR_CATEGORY_LICKS: Phrase[] = [
     // ... your licks
   ];
   ```

2. Update `src/lib/data/licks/index.ts` — import the array, spread it into `ALL_CURATED_LICKS` (which also holds `...COMBINED_LICKS`), and add it to the named-export list at the bottom:
   ```typescript
   import { YOUR_CATEGORY_LICKS } from './your-category';

   export const ALL_CURATED_LICKS: Phrase[] = [
     ...BEGINNER_CELL_LICKS,
     ...COMBINED_LICKS,
     // ...the other files...
     ...YOUR_CATEGORY_LICKS  // Add here
   ];
   ```

3. If the category is new:
   - add it to the `PhraseCategory` union **and** `CATEGORY_LABELS` in `src/lib/types/music.ts` (the labels are an exhaustive `Record`, so the type check fails until both agree), and to `VALID_CATEGORIES` in `tests/integration/data-integrity.test.ts`;
   - a multi-chord progression category also goes in `PROGRESSION_CATEGORIES` (`phrases/library-loader.ts`, parent-key transposition) and `CATEGORY_COMPATIBILITY` (`tonality/scale-compatibility.ts`);
   - a minor category goes in `MINOR_CATEGORIES` (`music/mode.ts`), and its licks state `mode: 'minor'`.

## Step 6: Validate

```sh
npx vitest run tests/integration/data-integrity.test.ts tests/unit/data
```

`data-integrity.test.ts` checks the whole catalog: unique non-empty ids and names, a valid category, integer MIDI (or `null`) and well-formed fractions, non-decreasing offsets, at least one harmony segment with a valid root, `ChordQuality` and resolvable `scaleId`, difficulty fields in range with `level` within ±35 of `calculateDifficulty()`, `key: 'C'`, `source` `'curated'` (or `'combined'`), a valid time signature, and curated pitches within 44–84. `tests/unit/data/` adds the minor-mode convention and the note-count difficulty floor. (The contour rules in `phrases/validator.ts` — interval limits, leap recovery, step ratio — are applied to generated trick examples, not to curated licks; they are still a fair guide to what sounds idiomatic.)

Then run the app and verify:

1. The lick comes up in ear training (at a proficiency and scale type that admit it — see Step 2)
2. The sheet music renders correctly
3. Playback sounds right
4. Transposition to other keys works

You can also write the lick in MuseScore or another notation editor first, then convert to MIDI values.

## Tips

- Listen to real jazz recordings for authentic lick vocabulary
- Keep licks concise — 1–2 bars for lower difficulty levels, up to 4 bars for higher ones
- Include approach notes and enclosures at higher difficulty levels
- Tag licks descriptively for search discoverability
- Ensure harmony matches the notes (chord tones on strong beats)
- Leave dynamics to the expression pass; no curated lick sets `velocity` or `articulation`
