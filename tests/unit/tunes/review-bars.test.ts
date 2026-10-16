import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { absoluteBarToSection, clearEditedSuspectBars, nextSuspectBar } from '$lib/tunes/review-bars';

/**
 * The PDF import's review loop (phase 4, 2026-10-16): suspect bars are
 * 1-based absolute bar numbers; a bar leaves the list once its melody is
 * edited, `N` jumps to the next one, and absolute bars map onto sections.
 */
function tune(notes: Tune['sections'][number]['notes'], bars = 8): Tune {
	return { id: 't', title: 'T', key: 'C', timeSignature: [4, 4], tags: [], source: 'user', sections: [
		{ label: 'A', bars, notes, harmony: [] },
		{ label: 'B', bars: 4, notes: [], harmony: [] }
	] };
}

describe('clearEditedSuspectBars', () => {
	it('drops a suspect bar whose notes changed and keeps the others', () => {
		const before = tune([{ pitch: 60, duration: [1, 4], offset: [1, 1] }, { pitch: 62, duration: [1, 4], offset: [2, 1] }]);
		const after = tune([{ pitch: 60, duration: [1, 4], offset: [1, 1] }, { pitch: 64, duration: [1, 4], offset: [2, 1] }]);
		expect(clearEditedSuspectBars(before, after, [2, 3, 5])).toEqual([2, 5]);
	});

	it('a note that only moved into a bar counts as an edit of that bar', () => {
		const before = tune([{ pitch: 60, duration: [1, 4], offset: [1, 1] }]);
		const after = tune([{ pitch: 60, duration: [1, 4], offset: [2, 1] }]);
		expect(clearEditedSuspectBars(before, after, [2, 3])).toEqual([]);
	});

	it('ignores rests — a page stores its gap rests on its first commit, and that is not a review', () => {
		const before = tune([{ pitch: 60, duration: [1, 4], offset: [4, 1] }]);
		const after = tune([{ pitch: null, duration: [4, 1], offset: [0, 1] }, { pitch: 60, duration: [1, 4], offset: [4, 1] }]);
		expect(clearEditedSuspectBars(before, after, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
	});

	it('leaves the list alone when nothing in those bars changed', () => {
		const before = tune([{ pitch: 60, duration: [1, 4], offset: [0, 1] }]);
		const after = tune([{ pitch: 62, duration: [1, 4], offset: [0, 1] }]);
		expect(clearEditedSuspectBars(before, after, [3])).toEqual([3]);
	});

	it('reads bars across sections', () => {
		const before = tune([]);
		const after = tune([]);
		after.sections[1].notes = [{ pitch: 60, duration: [1, 4], offset: [1, 1] }]; // B's 2nd bar = bar 10
		expect(clearEditedSuspectBars(before, after, [10, 11])).toEqual([11]);
	});
});

describe('nextSuspectBar / absoluteBarToSection', () => {
	it('finds the next suspect bar after the current one, wrapping round', () => {
		expect(nextSuspectBar([2, 5, 9], 0)).toBe(2);
		expect(nextSuspectBar([2, 5, 9], 2)).toBe(5);
		expect(nextSuspectBar([2, 5, 9], 9)).toBe(2);
		expect(nextSuspectBar([], 3)).toBeNull();
	});

	it('maps a 0-based absolute bar onto its section and bar', () => {
		const t = tune([]);
		expect(absoluteBarToSection(t, 0)).toEqual({ sectionIdx: 0, barInSection: 0 });
		expect(absoluteBarToSection(t, 9)).toEqual({ sectionIdx: 1, barInSection: 1 });
		expect(absoluteBarToSection(t, 12)).toBeNull();
	});
});
