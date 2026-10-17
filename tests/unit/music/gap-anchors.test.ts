import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { tuneToAbcWithMap } from '$lib/music/tune-notation';

/**
 * Gap rests — silence the engraver fills in where a section stores no
 * element — carry a GapAnchor (2026-10-16): a PDF import stores no rests at
 * all, so without one a click on such a rest had nothing to select and fell
 * through to the bar. The ABC itself is unchanged; anchors ride beside it.
 */
function sheet(notes: Tune['sections'][number]['notes'], bars = 2): Tune {
	return { id: 'g', title: 'Gaps', key: 'C', timeSignature: [4, 4], tags: [], source: 'user', sections: [{ label: 'A', bars, notes, harmony: [] }] };
}

describe('gap anchors', () => {
	it('anchors the gap after a half note with its section-local offset and length, and leaves a slash bar alone', () => {
		const { abc, gapAnchors, noteAnchors } = tuneToAbcWithMap(sheet([{ pitch: 62, duration: [1, 2], offset: [0, 1] }]), undefined, { preserveRestBoundaries: true });
		expect(noteAnchors).toHaveLength(1);
		expect(gapAnchors).toHaveLength(1); // bar 2 is a slash bar: a bar click, not a gap
		expect(gapAnchors[0]).toMatchObject({ sectionIdx: 0, offset: 0.5, duration: 0.5 });
		expect(gapAnchors[0].startChar).toBeGreaterThan(noteAnchors[0].endChar - 1);
		expect(abc).toBe(tuneToAbcWithMap(sheet([{ pitch: 62, duration: [1, 2], offset: [0, 1] }])).abc);
	});

	it('anchors a gap between two notes and one in a later bar, each at its own offset', () => {
		const { gapAnchors } = tuneToAbcWithMap(sheet([
			{ pitch: 62, duration: [1, 4], offset: [0, 1] },
			{ pitch: 64, duration: [1, 4], offset: [1, 2] },
			{ pitch: 65, duration: [1, 4], offset: [1, 1] }
		]), undefined, { preserveRestBoundaries: true });
		// One anchor per engraved segment: the 3/4 gap in bar 2 is drawn as a
		// quarter and a half (rests never cross the bar's midpoint).
		expect(gapAnchors.map((g) => [g.offset, g.duration])).toEqual([[0.25, 0.25], [0.75, 0.25], [1.25, 0.25], [1.5, 0.5]]);
	});

	it('a stored rest is a note anchor, never a gap anchor', () => {
		const { gapAnchors, noteAnchors } = tuneToAbcWithMap(sheet([
			{ pitch: 62, duration: [1, 2], offset: [0, 1] },
			{ pitch: null, duration: [1, 2], offset: [1, 2] }
		]), undefined, { preserveRestBoundaries: true });
		expect(noteAnchors.filter((a) => a.rest)).toHaveLength(1);
		expect(gapAnchors).toHaveLength(0);
	});
});
