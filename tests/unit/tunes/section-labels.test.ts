import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { editSectionLabel, sectionLabels } from '$lib/tunes/section-labels';
import { flattenTune } from '$lib/tunes/flatten';
import { fractionToFloat } from '$lib/music/intervals';
import { tuneToAbcWithMap } from '$lib/music/tune-notation';

const tune: Tune = { id: 'marks', title: 'Marks', key: 'C', timeSignature: [4, 4], source: 'user', tags: [], sections: [
	{ label: 'A', bars: 8, repeatStart: true, notes: [{ pitch: 60, offset: [3, 1], duration: [2, 1] }],
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [8, 1], scaleId: 'major.ionian' }] },
	{ label: 'B', bars: 4, repeatEnd: true, notes: [{ pitch: 64, offset: [0, 1], duration: [1, 1] }], harmony: [] }
] };
const edit = (sheet: Tune, from: number | null, to: number | null, label?: string): Tune => {
	const sections = editSectionLabel(sheet, from, to, label);
	expect(sections).not.toBeNull();
	return { ...sheet, sections: sections! };
};
const notes = (sheet: Tune) => flattenTune(sheet).notes.map(n => ({ pitch: n.pitch, start: fractionToFloat(n.offset), length: fractionToFloat(n.duration), tied: n.tied }));

describe('bar-anchored section labels', () => {
	it('allows an explicit A after A without confusing it with inherited ending labels', () => {
		const added = edit(tune, null, 4, 'A');
		expect(sectionLabels(added).map(m => [m.label, m.bar])).toEqual([['A', 0], ['A', 4], ['B', 8]]);
		expect(tuneToAbcWithMap(added).abc.match(/P:A/g)).toHaveLength(2);
	});
	it('moves B across a sustained note without moving pitches, chords, or repeat anchors', () => {
		const moved = edit(tune, 1, 4);
		expect(sectionLabels(moved).map(m => [m.label, m.bar])).toEqual([['A', 0], ['B', 4]]);
		expect(notes(moved)).toEqual([
			{ pitch: 60, start: 3, length: 1, tied: true }, { pitch: 60, start: 4, length: 1, tied: undefined }, { pitch: 64, start: 8, length: 1, tied: undefined }
		]);
		expect(moved.sections[0].repeatStart).toBe(true);
		expect(moved.sections.at(-1)?.repeatEnd).toBe(true);
		expect(flattenTune(moved, { expandRepeats: true }).totalBars).toBe(24);
		expect(flattenTune(moved).harmony.map(h => [fractionToFloat(h.startOffset), fractionToFloat(h.duration)])).toEqual([[0, 4], [4, 4]]);
		expect(notes(tune)).toHaveLength(2); // no mutation
	});
	it('adds and deletes only the mark, keeping the full timeline and ending signs', () => {
		const added = edit(tune, null, 6, 'Bridge');
		const removed = edit(added, sectionLabels(added).find(m => m.label === 'Bridge')!.sectionIdx, null);
		expect(notes(removed)).toEqual(notes(tune));
		expect(flattenTune(removed).totalBars).toBe(12);
		expect(sectionLabels(removed).map(m => m.label)).toEqual(['A', 'B']);
		const unlabeled = edit(edit(tune, 1, null), 0, null);
		expect(sectionLabels(unlabeled)).toEqual([]);
		expect(flattenTune(unlabeled, { expandRepeats: true }).totalBars).toBe(24);
	});
	it('refuses occupied bars, out-of-range drops and multiline ABC injection', () => {
		expect(editSectionLabel(tune, 1, 0)).toBeNull();
		expect(editSectionLabel(tune, 1, 12)).toBeNull();
		expect(editSectionLabel(tune, null, 2, 'B\nK:F')).toBeNull();
	});
	it('preserves first/second endings and their repeat anchors when their shared label is removed', () => {
		const endings: Tune = { ...tune, sections: [
			{ ...tune.sections[0], label: 'C', bars: 3, notes: [], harmony: [] },
			{ label: 'C', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [] },
			{ label: 'C', bars: 1, ending: 2, notes: [], harmony: [] }
		] };
		const removed = edit(endings, 0, null);
		expect(removed.sections.map(s => [s.label, s.bars, s.ending, s.repeatStart, s.repeatEnd])).toEqual([
			['', 3, undefined, true, undefined], ['', 1, 1, undefined, true], ['', 1, 2, undefined, undefined]
		]);
	});
	it('supports non-4/4 bar boundaries', () => {
		const waltz = { ...tune, timeSignature: [3, 4] as [number, number] };
		const moved = edit(waltz, 1, 2);
		expect(notes(moved)).toEqual(notes(waltz));
	});
});
