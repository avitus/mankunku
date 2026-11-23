import { describe, expect, it } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { flattenTune } from '$lib/tunes/flatten';
import { jamChartAt, jamSheets } from '$lib/tunes/jam-sheets';
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
	it('omits melody and pickup when the player selects solos only', () => {
		const pickup: Tune = { ...tune, sections: [
			{ label: '', bars: 1, pickupLength: [1, 4], notes: [{ pitch: 67, offset: [3, 4], duration: [1, 4] }], harmony: [] }, ...tune.sections
		] };
		const jam = buildJamForm(pickup, 3, false);
		expect(jam.headBars).toBe(0);
		expect(jam.outroStartBar).toBeNull();
		expect(jam.phraseBars).toBe(6);
		expect(jam.notes).toEqual([]);
		expect(jam.harmony.map(chord => fractionToFloat(chord.startOffset))).toEqual([0, 2, 4]);
	});
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
	it('plays the opening melody and closing melody independently', () => {
		const headOnly = buildJamForm(tune, 2, true, false);
		expect(headOnly.notes.map(note => fractionToFloat(note.offset))).toEqual([0]);
		expect(headOnly.outroStartBar).toBeNull();
		const outroOnly = buildJamForm(tune, 2, false, true);
		expect(outroOnly.headBars).toBe(0);
		expect(outroOnly.outroStartBar).toBe(4);
		expect(outroOnly.notes.map(note => fractionToFloat(note.offset))).toEqual([4]);
	});
	it('plays a pitched second ending even when the returning chart is silent', () => {
		const endings: Tune = { ...tune, sections: [
			{ ...tune.sections[0], repeatStart: true, notes: [] },
			{ label: 'First', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [] },
			{ label: 'Second', bars: 1, ending: 2, notes: [{ pitch: 67, offset: [0, 1], duration: [1, 1] }], harmony: [] }
		] };
		const jam = buildJamForm(endings, 1, false, true);
		expect(jam.headBars).toBe(0);
		expect(jam.outroStartBar).toBe(3);
		expect(jam.notes.map(note => [note.pitch, fractionToFloat(note.offset)])).toEqual([[67, 5]]);
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
		expect(jam.sheet.sections.map(section => section.label)).toEqual(['A']);
		expect(jam.closingSheet.sections.map(section => section.label)).toEqual(['A']);
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
		const solosOnly = buildJamForm(endings, 2, false);
		expect(solosOnly.harmony).toEqual(silent.harmony);
		expect(solosOnly.notes).toEqual([]);
		expect(solosOnly.phraseBars).toBe(silent.phraseBars);
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
	it('flows either blues ending into bars 11 and 12 of the same form', () => {
		const blues = { ...MANKUNKU_BLUES, sections: MANKUNKU_BLUES.sections.slice(1) };
		const sheets = jamSheets(blues);
		for (const [sheet, ending] of [[sheets.returning, 1], [sheets.closing, 2]] as const) {
			expect(sheet.sections).toHaveLength(1);
			expect(tuneChordBars(sheet)[0].bars.map(bar => bar.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
			const authored = { ...blues, sections: blues.sections.filter(section => !section.ending || section.ending === ending) };
			expect(flattenTune(sheet).notes).toEqual(flattenTune(authored).notes);
			expect(flattenTune(sheet).harmony).toEqual(flattenTune(authored).harmony);
		}
		expect(blues.sections).toHaveLength(3);
	});
	it('plays the complete repeated head into a solo break, then closes on the shared Fine', () => {
		const source: Tune = { ...tune, sections: [
			{ label: '', bars: 1, pickupLength: [1, 8], notes: [{ pitch: 55, offset: [7, 8], duration: [1, 8] }], harmony: [] },
			{ ...tune.sections[0], repeatStart: true,
				notes: [...tune.sections[0].notes, { pitch: 65, offset: [15, 8], duration: [1, 8] }],
				directions: [{ offset: [15, 8], text: 'Fine' }] },
			{ label: '', bars: 1, ending: 1, repeatEnd: true,
				notes: [{ pitch: 62, offset: [0, 1], duration: [1, 4] }], harmony: [] },
			{ label: '', bars: 1, ending: 2, notes: [], harmony: [], directions: [{ offset: [0, 1], text: 'Solo break' }] }
		] };
		const jam = buildJamForm(source, 2);
		expect([jam.headBars, jam.soloBars, jam.outroStartBar, jam.phraseBars]).toEqual([7, 3, 13, 15]);
		expect(jam.notes.map(note => note.pitch)).toEqual([55, 60, 65, 62, 60, 65, 60, 65]);
		expect(jam.sessionBarMap).toEqual([0, 1, 2, 3, 4, 5, 6, 1, 2, 3, 1, 2, 3, 0, 1]);
		for (const [bar, printed] of [[0, 0], [3, 3], [4, 1], [6, 4], [7, 1], [13, 0], [14, 1]]) {
			const chart = jamChartAt(jam, bar, jam.headBars);
			expect(notationBarForPlaybackBar(chart.flat.sectionMap, chart.sheet.sections, jam.sessionBarMap![bar])).toBe(printed);
		}
		expect(jam.phrase.soloBreaks).toEqual([6]);
		expect(jam.opening?.sheet).toBe(source);
		expect(jam.closingSheet.sections.flatMap(section => section.directions ?? []).map(d => d.text)).toEqual(['Fine']);
		const solos = buildJamForm(source, 2, false);
		expect(solos.opening).toBeUndefined();
		expect(solos.phrase.soloBreaks).toEqual([5]);
		expect(solos.headBars).toBe(0);
		expect(solos.notes).toHaveLength(0);
	});
	it('moves the chosen ending’s printed directions with its music', () => {
		const source: Tune = { ...tune, sections: [
			{ ...tune.sections[0], repeatStart: true, directions: [{ offset: [7, 4], text: 'Fine' }] },
			{ label: '', bars: 1, ending: 1, repeatEnd: true, notes: [], harmony: [],
				directions: [{ offset: [0, 1], text: 'N.C.' }] },
			{ label: '', bars: 1, ending: 2, notes: [], harmony: [],
				directions: [{ offset: [0, 1], text: 'Solo break' }] }
		] };
		const { returning, closing } = jamSheets(source);
		for (const [chart, cue] of [[returning, 'N.C.'], [closing, 'Solo break']] as const) {
			expect(chart.sections[0].directions).toEqual([
				{ offset: [7, 4], text: 'Fine' }, { offset: [2, 1], text: cue }
			]);
		}
		expect(source.sections[0].directions).toHaveLength(1);
	});
	it('splits sustained harmony into actual chord bars', () => {
		const bars = tuneChordBars(tune)[0].bars;
		expect(bars.map(bar => bar.number)).toEqual([1, 2]);
		expect(bars.map(bar => bar.harmony[0].duration)).toEqual([[1, 1], [1, 1]]);
		expect(bars.map(bar => bar.harmony[0].startOffset)).toEqual([[0, 1], [0, 1]]);
	});
});
