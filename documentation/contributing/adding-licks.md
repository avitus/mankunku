# Adding Curated Licks

Step-by-step guide to adding new curated licks to Mankunku's library.

## Overview

Curated licks are stored as TypeScript arrays in `src/lib/data/licks/`. All licks are written in **concert C** — the library loader handles transposition to other keys at query time.

## Step 1: Choose a File

Existing files:

| File | Category | Count |
|---|---|---|
| `beginner-cells.ts` | Beginner Cells | 50 |
| `ii-V-I-major.ts` | ii-V-I Major | 24 |
| `blues.ts` | Blues | 20 |
| `bebop-lines.ts` | Bebop Lines | 20 |
| `ii-V-I-minor.ts` | ii-V-I Minor | 15 |
| `pentatonic.ts` | Pentatonic | 10 |
| `modal.ts` | Modal | 10 |
| `rhythm-changes.ts` | Rhythm Changes | 7 |
| `ballad.ts` | Ballad | 7 |

Add to an existing file for existing categories, or create a new file for a new category. Note: `combiner.ts` generates ~86 additional licks algorithmically from scale pattern × rhythm template pairs — you don't need to add licks there manually.

## Step 2: Define the Lick

Each lick is a `Phrase` object. Here's an annotated example:

```typescript
{
  id: 'ii-V-I-major-21',             // Unique ID: category-number
  name: 'Ascending ii-V Resolution',  // Descriptive name
  timeSignature: [4, 4],              // Always 4/4 for now
  key: 'C',                           // Always C (canonical)

  // Notes: each note has pitch (MIDI), duration, offset, and optional velocity/articulation
  notes: [
    { pitch: 62, duration: [1, 8], offset: [0, 1], velocity: 80 },  // D4, eighth, beat 1
    { pitch: 64, duration: [1, 8], offset: [1, 8] },                // E4, eighth, beat 1.5
    { pitch: 65, duration: [1, 8], offset: [1, 4] },                // F4, eighth, beat 2
    { pitch: 67, duration: [1, 4], offset: [3, 8], velocity: 100 }, // G4, quarter, beat 2.5
    { pitch: 64, duration: [1, 2], offset: [5, 8] },                // E4, half, beat 3.5
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
    level: 3,                 // 1-7, matches difficulty profiles
    pitchComplexity: 3,
    rhythmComplexity: 2,
    lengthBars: 2             // Number of bars
  },

  category: 'ii-V-I-major',  // Must match PhraseCategory type
  tags: ['diatonic', 'ascending', 'resolution'],  // Searchable tags
  source: 'curated'           // Always 'curated' for library licks
}
```

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

Tenor sax range: MIDI 44 (Ab2) to 76 (E5).

## Step 5: Register the Lick

If adding to an existing file, simply add the `Phrase` object to the exported array.

If creating a new file:

1. Create `src/lib/data/licks/your-category.ts`:
   ```typescript
   import type { Phrase } from '$lib/types/music.ts';

   export const YOUR_CATEGORY_LICKS: Phrase[] = [
     // ... your licks
   ];
   ```

2. Update `src/lib/data/licks/index.ts`:
   ```typescript
   import { YOUR_CATEGORY_LICKS } from './your-category.ts';

   export const ALL_CURATED_LICKS: Phrase[] = [
     ...II_V_I_MAJOR_LICKS,
     ...BLUES_LICKS,
     ...BEBOP_LICKS,
     ...II_V_I_MINOR_LICKS,
     ...YOUR_CATEGORY_LICKS  // Add here
   ];
   ```

3. If the category is new, add it to the `PhraseCategory` type in `src/lib/types/music.ts`.

## Step 6: Validate

Run the app and verify:

1. The lick appears in the Library browser
2. The sheet music renders correctly
3. Playback sounds right
4. Transposition to other keys works
5. The category filter includes it

You can also write the lick in MuseScore or another notation editor first, then convert to MIDI values.

## Tips

- Listen to real jazz recordings for authentic lick vocabulary
- Keep licks concise — 1–2 bars for levels 1–4, up to 4 bars for levels 5–7
- Include approach notes and enclosures at higher difficulty levels
- Tag licks descriptively for search discoverability
- Ensure harmony matches the notes (chord tones on strong beats)
- Use `velocity: 100` for target notes and `velocity: 80` for passing tones
