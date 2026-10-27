import { describe, expect, it } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { jamSheets } from '$lib/tunes/jam-sheets';
import { buildJamForm } from '$lib/tunes/jam-form';
import { tuneChordBars } from '$lib/tunes/chord-bars';
import { fractionToFloat } from '$lib/music/intervals';
import { playbackBarForSessionBar, notationBarForPlaybackBar } from '$lib/state/tune-practice-plan';

const tune: Tune = {
	id: 'jam', title: 'Jam', key: 'C', timeSignature: [4, 4], tags: [], source: 'user',
	sections: [{ label: 'A', bars: 2,
		notes: [{ pitch: 60, offset: [0, 1], duration: [1, 4] }],
		harmony: [{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [2, 1], scaleId: 'major.ionian' }] }]
};

describe('a finite jazz jam', () => {
	it('plays the head, N melody-free solos and the head out on one continuous timeline', () => {
		const jam = buildJamForm(tune, 3);
		expect(jam.headBars).toBe(2);
		expect(jam.outroStartBar).toBe(8);
		expect(jam.phraseBars).toBe(10);
		expect(jam.notes.map(note => fractionToFloat(note.offset))).toEqual([0, 8]);
		expect(jam.noteSourceIndices).toEqual([0, 0]);
		expect(jam.harmony.map(chord => fractionToFloat(chord.startOffset))).toEqual([0, 2, 4, 6, 8]);
		expect(jam.sectionMap.map(section => section.barOffset)).toEqual([0, 2, 4, 6, 8]);
	});
	it('takes the second ending on the outro and maps its notes back to that ending', () => {
		const endings: Tune = { ...tune, sections: [
			{ ...tune.sections[0], repeatStart: true },
			{ label: 'First', bars: 1, ending: 1, repeatEnd: true, notes: [{ pitch: 62, offset: [0, 1], duration: [1, 1] }], harmony: [] },
			{ label: 'Second', bars: 1, ending: 2, notes: [{ pitch: 60, offset: [0, 1], duration: [1, 1] }], harmony: [] }
		] };
		const jam = buildJamForm(endings, 2);
		expect(jam.headBars).toBe(3);
		expect(jam.outroStartBar).toBe(9);
		expect(jam.phraseBars).toBe(12);
		expect(jam.notes.map(note => note.pitch)).toEqual([60, 62, 60, 60]);
		expect(jam.noteSourceIndices).toEqual([0, 1, 0, 1]);
		const sourceBar = playbackBarForSessionBar(11.5, jam.flat.totalBars, jam.headBars, jam.practiceStartBar, jam.closingStartBar, jam.outroSourceStartBar);
		expect(notationBarForPlaybackBar(jam.closingFlat.sectionMap, jam.closingSheet.sections, sourceBar)).toBe(2.5);
		expect(jam.sheet.sections.map(section => section.label)).toEqual(['A', 'First']);
		expect(jam.closingSheet.sections.map(section => section.label)).toEqual(['A', 'Second']);
	});
	it('returns through the first ending on every solo, then closes through the second', () => {
		const endings: Tune = { ...tune, sections: [
			{ ...tune.sections[0], repeatStart: true },
			{ label: 'Turnaround', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [{ chord: { root: 'G', quality: '7' }, startOffset: [0, 1], duration: [1, 1], scaleId: 'major.mixolydian' }] },
			{ label: 'Finish', bars: 2, ending: 2, notes: [], harmony: [{ chord: { root: 'F', quality: 'maj7' }, startOffset: [0, 1], duration: [2, 1], scaleId: 'major.ionian' }] }
		] };
		const jam = buildJamForm(endings, 2);
		expect(jam.harmony.map(h => h.chord.root)).toEqual(['C', 'G', 'C', 'G', 'C', 'G', 'C', 'F']);
		expect(jam.outroStartBar).toBe(9);
		expect(jam.phraseBars).toBe(13);
		const silent = buildJamForm({ ...endings, sections: endings.sections.map(section => ({ ...section, notes: [] })) }, 2);
		expect(silent.harmony.map(h => h.chord.root)).toEqual(['C', 'G', 'C', 'F']);
		expect(silent.headBars).toBe(0);
		expect(silent.outroStartBar).toBeNull();
		expect(silent.closingStartBar).toBe(3);
		expect(silent.phraseBars).toBe(7);
	});
	it('plays the pickup on the way in, with no extra silent bar between choruses', () => {
		const pickup: Tune = { ...tune, sections: [
			{ label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 67, offset: [3, 4], duration: [1, 4] }], harmony: [] }, ...tune.sections
		] };
		const jam = buildJamForm(pickup, 2);
		expect(jam.headBars).toBe(3);
		expect(jam.outroStartBar).toBe(7);
		expect(jam.phraseBars).toBe(9);
		expect(jam.notes.map(note => fractionToFloat(note.offset))).toEqual([.75, 1, 7]);
		expect(jam.noteSourceIndices).toEqual([0, 1, 1]);
	});
	it('handles chord-only charts as solo choruses without phantom melody sections', () => {
		const jam = buildJamForm({ ...tune, sections: tune.sections.map(section => ({ ...section, notes: [] })) }, 2);
		expect(jam.headBars).toBe(0);
		expect(jam.outroStartBar).toBeNull();
		expect(jam.phraseBars).toBe(4);
		expect(jam.notes).toEqual([]);
	});
	it('keeps an intro outside the repeat on the opening head only', () => {
		const intro: Tune = { ...tune, sections: [
			{ ...tune.sections[0], label: 'Intro', harmony: [{ ...tune.sections[0].harmony[0], chord: { root: 'Bb', quality: '7' } }] },
			{ ...tune.sections[0], repeatStart: true },
			{ label: 'First', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [] },
			{ label: 'Second', bars: 1, ending: 2, notes: [], harmony: [] }
		] };
		const jam = buildJamForm(intro, 2);
		expect(jam.headBars).toBe(5);
		expect(jam.practiceStartBar).toBe(2);
		expect(jam.outroStartBar).toBe(11);
		expect(jam.phraseBars).toBe(14);
		expect(jam.harmony.map(h => h.chord.root)).toEqual(['Bb', 'C', 'C', 'C', 'C']);
	});
	it('leaves first and second endings inside a longer form intact', () => {
		const internal: Tune = { ...tune, sections: [
			{ ...tune.sections[0], repeatStart: true },
			{ label: 'First', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [] },
			{ label: 'Second', bars: 1, ending: 2, notes: [], harmony: [] },
			{ ...tune.sections[0], label: 'Bridge', bars: 8 }
		] };
		expect(jamSheets(internal)).toEqual({ returning: internal, closing: internal, soloStartBar: 0 });
		expect(buildJamForm(internal, 1).headBars).toBe(14);
	});
	it('splits sustained harmony into actual chord bars', () => {
		const bars = tuneChordBars(tune)[0].bars;
		expect(bars.map(bar => bar.number)).toEqual([1, 2]);
		expect(bars.map(bar => bar.harmony[0].duration)).toEqual([[1, 1], [1, 1]]);
		expect(bars.map(bar => bar.harmony[0].startOffset)).toEqual([[0, 1], [0, 1]]);
	});
});
