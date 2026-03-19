# Adding Scales

Guide to extending the scale catalog in Mankunku.

## Overview

The scale catalog lives in `src/lib/music/scales.ts`. It currently contains 35 scales across 7 families. Each scale is a `ScaleDefinition` object.

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
  targetNotes?: string[];        // Good notes to land on
  avoidNotes?: string[];         // Notes to treat carefully
}
```

## Step 1: Define the Scale

Example — adding a Lydian Augmented #2 scale:

```typescript
{
  id: 'harmonic-minor.lydian-augmented-sharp2',
  name: 'Lydian Augmented #2',
  family: 'harmonic-minor',
  mode: 3,
  intervals: [2, 2, 2, 2, 1, 2, 1],  // Must sum to 12
  degrees: ['1', '#2', '3', '#4', '#5', '6', '7'],
  chordApplications: ['maj7', 'aug'],
  targetNotes: ['1', '3', '#5', '7']
}
```

**Critical:** The `intervals` array must sum to exactly 12 (one octave).

## Step 2: Add to SCALE_CATALOG

Insert the scale into the `SCALE_CATALOG` array in `src/lib/music/scales.ts`, grouped with its family.

## Step 3: Add a New Family (if needed)

If the scale belongs to a new family:

1. Add the family name to the `ScaleFamily` type in `src/lib/types/music.ts`:
   ```typescript
   export type ScaleFamily = 'major' | 'melodic-minor' | ... | 'your-family';
   ```

2. Add the family to the appropriate difficulty profiles in `src/lib/difficulty/params.ts` — each `DifficultyProfile.scaleTypes` array controls which scale families are available at that level.

## Step 4: Include in MVP (optional)

If the scale should appear in the MVP scales reference:

1. Add its ID to `MVP_SCALE_IDS` in `src/lib/music/scales.ts`
2. It will appear on the Scales page (`/scales`)

## Step 5: Wire to Chords (optional)

If the scale should be suggested for certain chord qualities:

1. Add the chord quality to the scale's `chordApplications` array
2. The `getScalesForChord()` function will then return it

## Step 6: Use in Phrase Generation (optional)

To use the scale in the algorithmic generator:

1. Ensure the scale's family is in the `scaleTypes` array of the appropriate `DifficultyProfile` in `params.ts`
2. Create or update `HarmonicSegment` templates in `generator.ts:getDefaultHarmony()` to reference the scale's ID

## Verification

After adding a scale:

1. Check the Scales page (`/scales`) renders it correctly
2. Verify `getScale(id)` returns the definition
3. Verify `getScalesByFamily(family)` includes it
4. If applicable, verify `getScalesForChord(quality)` includes it
5. If added to MVP, verify `getMvpScales()` includes it
6. Test scale realization: `realizeScale('C', yourScale.intervals)` should produce correct pitch classes

## Reference: Interval Sums

Quick reference for verifying intervals sum to 12:

| Scale Type | Typical Pattern |
|---|---|
| 7-note | Sum of 7 intervals = 12 |
| 8-note (bebop) | Sum of 8 intervals = 12 |
| 5-note (pentatonic) | Sum of 5 intervals = 12 |
| 6-note (blues, whole tone) | Sum of 6 intervals = 12 |
| 12-note (chromatic) | Sum of 12 intervals = 12 |
