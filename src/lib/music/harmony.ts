/**
 * Harmony lookup helpers.
 *
 * Pure functions for resolving which harmonic segment is active at a given
 * point in a phrase. Positions are expressed in whole-note units (matching
 * `HarmonicSegment.startOffset` / `.duration`), i.e. `fractionToFloat(offset)`.
 */

import type { HarmonicSegment } from '$lib/types/music';
import { fractionToFloat } from './intervals';

/**
 * Find the harmonic segment active at a whole-note position.
 * Falls back to the final segment when the position lands past the last
 * segment's end (e.g. a phrase-ending note that rings past the last chord),
 * and returns null only when there is no harmony at all.
 */
export function findHarmonyAt(
	harmony: HarmonicSegment[],
	wholeNotePosition: number
): HarmonicSegment | null {
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset);
		const end = start + fractionToFloat(seg.duration);
		if (wholeNotePosition >= start && wholeNotePosition < end) return seg;
	}
	return harmony[harmony.length - 1] ?? null;
}
