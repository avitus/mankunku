/**
 * Curated lead-sheet index — re-exports all curated tunes.
 * Both melodies are originals, written for this app.
 */
import type { Tune } from '$lib/types/tune';
import { MANKUNKU_BLUES } from './mankunku-blues';
import { RHYTHM_CHANGES } from './rhythm-changes';

export const ALL_CURATED_TUNES: Tune[] = [MANKUNKU_BLUES, RHYTHM_CHANGES];

export { MANKUNKU_BLUES, RHYTHM_CHANGES };
