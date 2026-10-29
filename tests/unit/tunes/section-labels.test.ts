import { describe, it, expect } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { editSectionLabel, sectionLabels, sectionGroups } from '$lib/tunes/section-labels';
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

describe('rehearsal section groups', () => {
	it('keeps Black Orpheus endings and continuation under C after moving B and C', () => {
		const original: Tune = { ...tune, sections: [
			{ label: 'A', bars: 33, pickupLength: [1, 4], notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] }], harmony: [] },
			{ label: 'B', bars: 3, repeatStart: true, notes: [], harmony: [] },
			{ label: 'B', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [] },
			{ label: 'B', bars: 1, ending: 2, notes: [], harmony: [] },
			{ label: 'C', bars: 1, notes: [], harmony: [] }
		] };
		const movedB = edit(original, 1, 17);
		const moved = edit(movedB, sectionLabels(movedB).find(m => m.label === 'C')!.sectionIdx, 33);
		const beforeGrouping = structuredClone(moved);
		expect(sectionGroups(moved).map(g => [g.label, g.bars, g.sectionIdx, g.endSectionIdx, g.startBar])).toEqual([
			['A', 17, 0, 1, 0], ['B', 16, 1, 2, 17], ['C', 6, 2, 6, 33]
		]);
		expect(moved).toEqual(beforeGrouping);
		expect(flattenTune(moved, { expandRepeats: true }).totalBars).toBe(flattenTune(original, { expandRepeats: true }).totalBars);
		const removed = edit(moved, 2, null);
		expect(sectionGroups(removed).map(g => [g.label, g.bars])).toEqual([['A', 17], ['B', 22]]);
		expect(flattenTune(removed, { expandRepeats: true })).toEqual(flattenTune(moved, { expandRepeats: true }));
	});
	it('groups inherited duplicate labels but keeps explicit repeated rehearsal marks separate', () => {
		const sheet: Tune = { ...tune, sections: [
			{ label: 'A', bars: 3, notes: [], harmony: [] },
			{ label: 'A', bars: 1, ending: 1, notes: [], harmony: [] },
			{ label: 'A', labelExplicit: true, bars: 4, notes: [], harmony: [] }
		] };
		expect(sectionGroups(sheet).map(g => [g.label, g.bars])).toEqual([['A', 4], ['A', 4]]);
	});
	it('names the leading pickup or intro, and keeps a completely unmarked form together', () => {
		const pickup: Tune['sections'][number] = { label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 60, offset: [3, 4], duration: [1, 4] }], harmony: [] };
		expect(sectionGroups({ ...tune, sections: [pickup, ...tune.sections] }).map(g => g.label)).toEqual(['Pickup', 'A', 'B']);
		expect(sectionGroups({ ...tune, sections: [{ ...pickup, pickupLength: undefined, notes: [], bars: 4 }, ...tune.sections] }).map(g => g.label)).toEqual(['Intro', 'A', 'B']);
		expect(sectionGroups({ ...tune, sections: tune.sections.map(s => ({ ...s, label: '' })) }).map(g => [g.label, g.bars])).toEqual([['Music', 12]]);
		expect(sectionGroups({ ...tune, sections: [] })).toEqual([]);
	});
});
