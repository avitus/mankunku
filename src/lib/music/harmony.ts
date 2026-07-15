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
	if (harmony.length === 0) return null;
	for (const seg of harmony) {
		const start = fractionToFloat(seg.startOffset);
		const end = start + fractionToFloat(seg.duration);
		if (wholeNotePosition >= start && wholeNotePosition < end) return seg;
	}
	// Only fall back to the final segment for positions past its end (a note
	// ringing past the last chord). Positions before the first segment or inside
	// a gap between non-contiguous segments have no active harmony → null.
	const last = harmony[harmony.length - 1];
	const lastEnd = fractionToFloat(last.startOffset) + fractionToFloat(last.duration);
	return wholeNotePosition >= lastEnd ? last : null;
}
