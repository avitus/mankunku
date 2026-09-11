# Adding Scales

Guide to extending the scale catalog in Mankunku.

## Overview

The scale catalog lives in `src/lib/music/scales.ts`. It currently contains 33 scales across 7 families — major (7 modes), melodic minor (7), harmonic minor (7), symmetric (4), bebop (4), pentatonic (2), blues (2). Each scale is a `ScaleDefinition` object (type in `src/lib/types/music.ts`).

## ScaleDefinition Structure

```typescript
interface ScaleDefinition {
  id: string;                    // 'family.name' format (e.g. 'major.dorian')
  name: string;                  // Display name (e.g. 'Dorian')
  family: ScaleFamily;           // 'major' | 'melodic-minor' | 'harmonic-minor' | 'symmetric' | 'pentatonic' | 'blues' | 'bebop'
  mode: number | null;           // Mode number within parent scale (null for non-modal)
  intervals: number[];           // Semitone steps between degrees (must sum to 12)
  degrees: string[];             // Degree labels relative to major (e.g. '1', 'b3', '#4')
  chordApplications: ChordQuality[];  // Which chords this scale fits
  avoidNotes?: string[];         // Degrees to avoid as sustained notes (optional)
  targetNotes: string[];         // Chord tones the generator should land on (required)
}
```

## Step 1: Define the Scale

Example — adding the (symmetric, hexatonic) augmented scale, which the catalog lacks:

```typescript
{
  id: 'symmetric.augmented',
  name: 'Augmented',
  family: 'symmetric',
  mode: null,                          // Not a mode of a parent scale
  intervals: [3, 1, 3, 1, 3, 1],       // Must sum to 12
  degrees: ['1', '#2', '3', '5', '#5', '7'],
  chordApplications: ['maj7', 'aug'],
  targetNotes: ['1', '3', '5', '7']
}
```

**Critical:** The `intervals` array must sum to exactly 12 (one octave), and `degrees` must have one label per interval — each label naming the semitone the intervals actually reach (`#2` is three semitones up, so the first interval above must be 3).

## Step 2: Add to SCALE_CATALOG

Insert the scale into the `SCALE_CATALOG` array in `src/lib/music/scales.ts`, grouped with its family. **Order matters** for any chord quality it lists: `getScalesForChord(quality)` returns matches in catalog order, and its *first* match is the default scale that `scaleIdForQuality` (`tunes/segment-from-symbol.ts`) stamps on every chord typed into the tune editor or brought in by an importer — and the fallback scale for trick examples. A scale that lists `maj7` ahead of `major.ionian` would change the default for every major-seventh chord.

## Step 3: Add a New Family (if needed)

If the scale belongs to a new family, add the family name to the `ScaleFamily` type in `src/lib/types/music.ts`:

```typescript
export type ScaleFamily = 'major' | 'melodic-minor' | ... | 'your-family';
```

`DifficultyProfile.scaleTypes` in `src/lib/difficulty/params.ts` lists families per tier, but no app code selects content from it any more (the algorithmic generator that did was removed 2026-08-08). Only tests read it — they pin that the list grows tier by tier, and the curated-lick calibration test takes the first tier containing `bebop` as its chromatic floor. Add the family at the tier it belongs to so the table stays honest; it gates nothing.

## Step 4: Include in MVP (optional)

The Scales page (`/scales`) lists only the MVP subset, not the whole catalog. To show the scale there:

1. Add its ID to `MVP_SCALE_IDS` in `src/lib/music/scales.ts`
2. It will appear on the Scales page, under its family

## Step 5: Wire to Chords (optional)

If the scale should be suggested for certain chord qualities:

1. Add the chord quality to the scale's `chordApplications` array
2. The `getScalesForChord()` function will then return it (mind the ordering rule in Step 2)

## Step 6: Use in combinatorial lick generation (optional)

The combiner (`src/lib/phrases/combiner.ts`) realizes each lick category over ONE scale, named in that category's `CATEGORY_CONTEXT` entry. To build combinatorial licks over the new scale, point a category's `CATEGORY_CONTEXT` entry at the scale's ID, and make sure the relevant entries in `src/lib/data/patterns/scale-patterns.ts` either leave `compatibleFamilies` unset or include the scale's family — a pattern whose `compatibleFamilies` excludes it is skipped. Retargeting a category changes every combined lick in it, so re-run `tests/unit/phrases/`.

## Step 7: Make it a daily tonality (optional)

The daily key/scale rotation doesn't read the catalog directly — it has its own `ScaleType` union in `src/lib/tonality/tonality.ts`. A new daily scale needs an entry in `ScaleType`, `SCALE_TYPE_NAMES`, `SCALE_TYPE_TO_SCALE_ID` (pointing at the catalog ID), `SCALE_UNLOCK_ORDER` and `SCALE_PREREQUISITES`. Separately, a `SCALE_ID_COMPATIBILITY` entry (`tonality/scale-compatibility.ts`) decides which sessions offer single-chord licks whose harmony uses the scale; an unmapped scale ID matches every session. It then gets its own per-scale proficiency, so this is a product decision as much as a code change — see [Tonality System](../architecture/tonality-system.md).

## Verification

After adding a scale:

```sh
npx vitest run tests/integration/music-theory.test.ts tests/unit/music/scales.test.ts
```

`music-theory.test.ts` enforces that every catalog scale's intervals sum to 12 and that `degrees` has as many entries as `intervals`. `scales.test.ts` pins the per-family counts for major, melodic minor and bebop (update the count if you add to one of those) and that every `MVP_SCALE_IDS` entry resolves. Then:

1. Check the Scales page (`/scales`) renders it correctly (it lists the MVP scales only)
2. Verify `getScale(id)` returns the definition
3. Verify `getScalesByFamily(family)` includes it
4. If applicable, verify `getScalesForChord(quality)` includes it — and that its first result for that quality is still the scale you expect
5. If added to MVP, verify `getMvpScales()` includes it
6. Test scale realization: `realizeScale('C', yourScale.intervals)` (`music/keys.ts`) should produce correct pitch classes

## Reference: Interval Sums

Quick reference for verifying intervals sum to 12:

| Scale Type | Typical Pattern |
|---|---|
| 7-note | Sum of 7 intervals = 12 |
| 8-note (bebop) | Sum of 8 intervals = 12 |
| 5-note (pentatonic) | Sum of 5 intervals = 12 |
| 6-note (blues, whole tone) | Sum of 6 intervals = 12 |
| 12-note (chromatic) | Sum of 12 intervals = 12 |
