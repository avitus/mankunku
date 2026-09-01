/**
 * Lead-sheet engraving of a lick for the lick-practice key stack: a
 * struggling key's row shows the phrase as ONE system with chord symbols
 * above the staff. The engraving reuses the tune path (`tuneToAbc`) via a
 * synthesized one-section Tune, so this file pins (a) the three ABC options
 * the row needs that the tune path lacked, and (b) the phrase → Tune adapter.
 *
 * The existing tune goldens (tune-notation.test.ts) are byte-identical with
 * every option at its default — that is the additive contract.
 */

import { describe, it, expect } from 'vitest';
import { tuneToAbc } from '$lib/music/tune-notation';
import { leadSheetTuneFor, leadSheetAbcOptions } from '$lib/music/lead-sheet';
import { seg, sheet, section, simpleSheet } from '../../helpers/tune-fixtures';
import type { Phrase, Note, HarmonicSegment } from '$lib/types/music';

function note(midi: number, offsetEighths: number, durationEighths = 1): Note {
	return { pitch: midi, offset: [offsetEighths, 8], duration: [durationEighths, 8] };
}

const HDR_DEFAULT =
	'X:1\nT:Test Tune\nM:4/4\nL:1/8\n%%partsbox 1\n%%measurenb 0\n%%stretchlast 0\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n';

describe('tuneToAbc options for a lead-sheet row', () => {
	it('keeps the default output byte-identical when no new option is set', () => {
		expect(tuneToAbc(simpleSheet())).toBe(
			HDR_DEFAULT + 'P:A\n[V:M]C8 | D4 z4 |]\n[V:H]"D-7"x4 "G7"x4 | "CΔ7"x8 |\n'
		);
	});

	it('prints a minor key field and spells by the relative major signature', () => {
		// D minor: one flat. A Bb reads as a signature note (plain B), and the
		// key field is Dm — as phraseToAbc already prints for a minor lick.
		const dMinor = sheet({
			key: 'D',
			sections: [
				section({
					bars: 1,
					notes: [note(62, 0, 4), note(70, 4, 4)], // D4, Bb4
					harmony: [seg('D', 'min7', [0, 1], [1, 1])]
				})
			]
		});
		const abc = tuneToAbc(dMinor, undefined, { mode: 'minor' });
		expect(abc).toContain('\nK:Dm\n');
		expect(abc).toContain('[V:M]D4 B4 |]');
		// Same sheet read as major spells the Bb explicitly.
		expect(tuneToAbc(dMinor)).toContain('\nK:D\n');
		expect(tuneToAbc(dMinor)).toContain('[V:M]D4 _B4 |]');
	});

	it('stretches the last system to full width on request', () => {
		expect(tuneToAbc(simpleSheet(), undefined, { stretchLast: true })).toContain(
			'\n%%stretchlast 1\n'
		);
	});

	it('omits measure numbers on request', () => {
		expect(tuneToAbc(simpleSheet(), undefined, { measureNumbers: false })).not.toContain(
			'%%measurenb'
		);
	});
});

function phrase(overrides: Partial<Phrase>): Phrase {
	return {
		id: 'lick-1',
		name: 'Test lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: [],
		harmony: [],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'short-ii-V-I-major',
		tags: [],
		source: 'curated',
		...overrides
	};
}

/** ii-V | I over two bars, the short ii-V-I template shape. */
const SHORT_II_V_I: HarmonicSegment[] = [
	seg('D', 'min7', [0, 1], [1, 2]),
	seg('G', '7', [1, 2], [1, 2]),
	seg('C', 'maj7', [1, 1], [1, 1])
];

describe('leadSheetTuneFor', () => {
	it('wraps a short-cycle phrase as one unlabelled section covering the whole cycle', () => {
		const p = phrase({
			notes: [note(64, 0), note(62, 1), note(60, 2), note(59, 3), note(60, 8, 4)],
			harmony: SHORT_II_V_I
		});
		const { tune, startBar, bars } = leadSheetTuneFor(p);
		expect(startBar).toBe(0);
		expect(bars).toBe(2);
		expect(tune.sections).toHaveLength(1);
		expect(tune.sections[0].label).toBe('');
		expect(tune.sections[0].bars).toBe(2);
		expect(tune.sections[0].notes).toBe(p.notes); // untouched, same reference
		expect(tune.sections[0].harmony).toBe(p.harmony);
		expect(tune.key).toBe('C');
		expect(tune.timeSignature).toEqual([4, 4]);
		// No title: abcjs reserves masthead height for one even when CSS hides it.
		expect(tune.title).toBe('');
	});

	it('engraves the whole cycle even when the melody stops early', () => {
		const p = phrase({ notes: [note(64, 0), note(62, 1)], harmony: SHORT_II_V_I });
		expect(leadSheetTuneFor(p).bars).toBe(2);
	});

	it('windows a long cycle to the bars the melody occupies', () => {
		// 12-bar blues cycle; a 2-bar lick sitting on bars 9–10 (0-based 8–9).
		const blues: HarmonicSegment[] = Array.from({ length: 12 }, (_, bar) =>
			seg(bar === 8 ? 'D' : bar === 9 ? 'G' : 'C', bar === 8 ? 'min7' : '7', [bar, 1], [1, 1])
		);
		const p = phrase({
			notes: [note(62, 64), note(64, 65), note(65, 66, 2), note(67, 72, 8)],
			harmony: blues
		});
		const { tune, startBar, bars } = leadSheetTuneFor(p);
		expect(startBar).toBe(8);
		expect(bars).toBe(2);
		// Notes rebased to the window start; harmony clipped to the window.
		expect(tune.sections[0].notes.map((n) => n.offset)).toEqual([
			[0, 1],
			[1, 8],
			[1, 4],
			[1, 1]
		]);
		expect(tune.sections[0].harmony.map((h) => [h.chord.root, h.startOffset, h.duration])).toEqual([
			['D', [0, 1], [1, 1]],
			['G', [1, 1], [1, 1]]
		]);
	});

	it('caps the window at the maximum bars, from the melody\'s first bar', () => {
		const eightBars: HarmonicSegment[] = Array.from({ length: 8 }, (_, bar) =>
			seg('C', 'maj7', [bar, 1], [1, 1])
		);
		// Melody spans bars 0–5; window is the first four.
		const p = phrase({
			notes: [note(60, 0), note(60, 40, 8)],
			harmony: eightBars
		});
		const { startBar, bars, tune } = leadSheetTuneFor(p, 4);
		expect(startBar).toBe(0);
		expect(bars).toBe(4);
		expect(tune.sections[0].notes).toHaveLength(1); // the bar-5 note falls outside
	});

	it('produces the row options: minor mode from the phrase, one system, stretched, unnumbered', () => {
		const p = phrase({ key: 'D', mode: 'minor', harmony: SHORT_II_V_I });
		expect(leadSheetAbcOptions(p, 2)).toEqual({
			mode: 'minor',
			barsPerLine: 2,
			stretchLast: true,
			measureNumbers: false
		});
	});

	it('golden: a short ii-V-I lick engraves as one system with chords over the notes', () => {
		const p = phrase({
			notes: [note(64, 0), note(62, 1), note(60, 2), note(59, 3), note(60, 8, 4)],
			harmony: SHORT_II_V_I
		});
		const { tune, bars } = leadSheetTuneFor(p);
		expect(tuneToAbc(tune, undefined, leadSheetAbcOptions(p, bars))).toBe(
			'X:1\nT:\nM:4/4\nL:1/8\n%%partsbox 1\n%%stretchlast 1\n%%score (M H)\nK:C\nV:M\nV:H stem=down\n' +
				'[V:M]EDCB, z4 | C4 z4 |]\n[V:H]"D-7"x4 "G7"x4 | "CΔ7"x8 |\n'
		);
	});
});
