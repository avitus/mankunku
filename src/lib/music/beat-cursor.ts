/**
 * Which note of a phrase is sounding at a beat position — the cursor a
 * lead-sheet row lights as the session's beat indicator advances, so the
 * eye is on the note the band is at. Beats are in the phrase's own time
 * signature (quarters in 4/4); offsets and durations are whole-note
 * fractions, as everywhere else in the app.
 */

import type { Note } from '$lib/types/music';
import { fractionToFloat } from '$lib/music/intervals';

/**
 * Index (into `notes`) of the note that has started at `beat` and has not
 * yet ended; null before the first note, during a rest, for a negative
 * (parked) beat, or for an empty phrase. Does not assume `notes` is sorted.
 */
export function noteIndexAtBeat(
	notes: readonly Note[],
	beat: number,
	timeSignature: [number, number]
): number | null {
	if (beat < 0) return null;
	const beatUnit = timeSignature[1];
	let best: number | null = null;
	let bestStart = -Infinity;
	for (let i = 0; i < notes.length; i++) {
		const start = fractionToFloat(notes[i].offset) * beatUnit;
		const end = start + fractionToFloat(notes[i].duration) * beatUnit;
		if (start <= beat && beat < end && start >= bestStart) {
			best = i;
			bestStart = start;
		}
	}
	return best;
}
