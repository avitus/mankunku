import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import { flattenTune } from '$lib/tunes/flatten';
import { tuneToPhrase, tuneToPhraseWithFlat } from '$lib/tunes/to-phrase';
import { MANKUNKU_BLUES } from '$lib/data/tunes/mankunku-blues';
import { seg, section, sheet } from '../../helpers/tune-fixtures';

const NOTE: Note = { pitch: 60, duration: [1, 4], offset: [0, 1] };

/** A(repeat) | E1(ending 1) | E2(ending 2) — playback order A, E1, A, E2. */
function endingsSheet() {
	return sheet({
		sections: [
			section({
				label: 'A',
				bars: 1,
				repeatStart: true,
				notes: [NOTE],
				harmony: [seg('C', 'maj7', [0, 1], [1, 1])]
			}),
			section({
				label: 'A',
				bars: 1,
				ending: 1,
				repeatEnd: true,
				notes: [{ ...NOTE, pitch: 62 }],
				harmony: [seg('G', '7', [0, 1], [1, 1])]
			}),
			section({
				label: 'A',
				bars: 1,
				ending: 2,
				notes: [{ ...NOTE, pitch: 64 }],
				harmony: [seg('F', 'maj7', [0, 1], [1, 1])]
			})
		]
	});
}

describe('flattenTune provenance', () => {
	it('is the identity mapping when repeats are not expanded', () => {
		const flat = flattenTune(MANKUNKU_BLUES);
		expect(flat.noteSourceIndices).toEqual(flat.notes.map((_, i) => i));
		expect(flat.segmentSourceIndices).toEqual(flat.harmony.map((_, i) => i));
		expect(flat.sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 4 },
			{ sourceSection: 2, barOffset: 14 },
			{ sourceSection: 3, barOffset: 16 }
		]);
	});

	it('is the identity mapping for expandRepeats on a repeat-free sheet', () => {
		const tune = sheet({
			sections: [
				section({ bars: 2, notes: [NOTE], harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
				section({ label: 'B', bars: 2, notes: [{ ...NOTE, pitch: 62 }], harmony: [seg('F', 'maj7', [0, 1], [1, 1])] })
			]
		});
		const flat = flattenTune(tune, { expandRepeats: true });
		expect(flat.noteSourceIndices).toEqual([0, 1]);
		expect(flat.segmentSourceIndices).toEqual([0, 1]);
		expect(flat.sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 2 }
		]);
	});

	it('maps the second pass of a repeated body back to the same source indices', () => {
		const flat = flattenTune(endingsSheet(), { expandRepeats: true });
		expect(flat.noteSourceIndices).toEqual([0, 1, 0, 2]);
		expect(flat.segmentSourceIndices).toEqual([0, 1, 0, 2]);
		expect(flat.sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 1 },
			{ sourceSection: 0, barOffset: 2 },
			{ sourceSection: 2, barOffset: 3 }
		]);
		expect(flat.totalBars).toBe(4);
	});

	it('keeps provenance parallel to the emitted arrays on a real repeat form', () => {
		const flat = flattenTune(MANKUNKU_BLUES, { expandRepeats: true });
		expect(flat.noteSourceIndices).toHaveLength(flat.notes.length);
		expect(flat.segmentSourceIndices).toHaveLength(flat.harmony.length);

		expect(flat.sectionMap).toEqual([
			{ sourceSection: 0, barOffset: 0 },
			{ sourceSection: 1, barOffset: 4 },
			{ sourceSection: 2, barOffset: 14 },
			{ sourceSection: 1, barOffset: 16 },
			{ sourceSection: 3, barOffset: 26 }
		]);
		expect(flat.totalBars).toBe(28);

		// Second A pass mirrors the first pass segment-for-segment and
		// note-for-note (Intro contributes no notes).
		const [, a, e1] = MANKUNKU_BLUES.sections;
		const firstANotes = flat.noteSourceIndices.slice(0, a.notes.length);
		const secondANotes = flat.noteSourceIndices.slice(
			a.notes.length + e1.notes.length,
			a.notes.length + e1.notes.length + a.notes.length
		);
		expect(secondANotes).toEqual(firstANotes);

		const introSegs = MANKUNKU_BLUES.sections[0].harmony.length;
		const aSegs = a.harmony.length;
		const e1Segs = e1.harmony.length;
		const firstASegs = flat.segmentSourceIndices.slice(introSegs, introSegs + aSegs);
		const secondASegs = flat.segmentSourceIndices.slice(
			introSegs + aSegs + e1Segs,
			introSegs + aSegs + e1Segs + aSegs
		);
		expect(firstASegs).toEqual(Array.from({ length: aSegs }, (_, k) => introSegs + k));
		expect(secondASegs).toEqual(firstASegs);
	});

	it('keeps provenance intact through an unbalanced repeatStart fallback', () => {
		const tune = sheet({
			sections: [
				section({ bars: 1, repeatStart: true, notes: [NOTE], harmony: [seg('C', 'maj7', [0, 1], [1, 1])] }),
				section({ label: 'B', bars: 1, notes: [{ ...NOTE, pitch: 62 }], harmony: [seg('F', 'maj7', [0, 1], [1, 1])] })
			]
		});
		const flat = flattenTune(tune, { expandRepeats: true });
		expect(flat.noteSourceIndices).toEqual([0, 1]);
		expect(flat.segmentSourceIndices).toEqual([0, 1]);
		expect(flat.totalBars).toBe(2);
	});
});

describe('tuneToPhraseWithFlat', () => {
	it('returns the phrase and the provenance-bearing flatten from one pass', () => {
		const { phrase, flat } = tuneToPhraseWithFlat(MANKUNKU_BLUES, { expandRepeats: true });
		expect(phrase.notes).toBe(flat.notes);
		expect(phrase.harmony).toBe(flat.harmony);
		expect(phrase.difficulty.lengthBars).toBe(flat.totalBars);
		expect(phrase.source).toBe('tune');
	});

	it('keeps tuneToPhrase behavior unchanged', () => {
		const phrase = tuneToPhrase(MANKUNKU_BLUES, { expandRepeats: true });
		const { phrase: viaWith } = tuneToPhraseWithFlat(MANKUNKU_BLUES, { expandRepeats: true });
		expect(phrase).toEqual(viaWith);
	});
});
