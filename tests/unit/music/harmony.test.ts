import { describe, it, expect } from 'vitest';
import type { HarmonicSegment } from '$lib/types/music';
import { findHarmonyAt } from '$lib/music/harmony';

// Two non-contiguous segments over a bar: Dm7 on beats 1-2, G7 on beats 3-4,
// with a deliberate gap in the middle (beats 2-3) to exercise gap handling.
const SEGMENTS: HarmonicSegment[] = [
	{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 4] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'bebop.dominant', startOffset: [1, 2], duration: [1, 4] }
];

describe('findHarmonyAt', () => {
	it('returns null when there is no harmony', () => {
		expect(findHarmonyAt([], 0)).toBeNull();
	});

	it('returns the segment active at a position inside it', () => {
		expect(findHarmonyAt(SEGMENTS, 0)?.chord.root).toBe('D'); // start of Dm7
		expect(findHarmonyAt(SEGMENTS, 0.6)?.chord.root).toBe('G'); // inside G7
	});

	it('is half-open: the end of a segment belongs to the next / gap, not the segment', () => {
		// 0.25 is the end of Dm7 and the start of the gap → no active harmony.
		expect(findHarmonyAt(SEGMENTS, 0.25)).toBeNull();
	});

	it('returns null in a gap between non-contiguous segments', () => {
		expect(findHarmonyAt(SEGMENTS, 0.4)).toBeNull(); // between Dm7 end (0.25) and G7 start (0.5)
	});

	it('returns null before the first segment starts', () => {
		const later: HarmonicSegment[] = [
			{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [1, 4], duration: [1, 4] }
		];
		expect(findHarmonyAt(later, 0)).toBeNull();
	});

	it('falls back to the final segment for a position past its end (note ringing on)', () => {
		expect(findHarmonyAt(SEGMENTS, 1.0)?.chord.root).toBe('G'); // past G7 end (0.75)
	});
});
