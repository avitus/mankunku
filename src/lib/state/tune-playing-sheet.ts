import type { PitchClass } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { transposeTune } from '$lib/tunes/book-loader';
import { getEffectiveHighestNote, getInstrument } from '$lib/state/settings.svelte';

/** Fit the whole melody once so the chart, practice targets and audio agree. */
export function tuneInPlayingRange(sheet: Tune, concertKey: PitchClass): Tune {
	return transposeTune(sheet, concertKey, getInstrument().concertRangeLow, getEffectiveHighestNote());
}
