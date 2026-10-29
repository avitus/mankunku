import { describe, it, expect } from 'vitest';
import {
	sanitizeEvidence,
	sanitizeRecognitionContext
} from '$lib/tunes/import/pdf-recognition-screen';
import { screenSystemBars, systemBarIssues } from '$lib/tunes/import/pdf-system-reading';
import { screenHarmonyReading } from '$lib/tunes/import/pdf-harmony-reading';
import type { RecognizedBar } from '$lib/tunes/import/pdf-recognition';

/**
 * The recognition seam takes JSON from the browser and from the model. Every
 * field is either a bounded, well-typed value or absent (null) — a malformed
 * reading never reaches section building half-parsed.
 */

describe('sanitizeRecognitionContext', () => {
	it('keeps a well-formed context', () => {
		expect(
			sanitizeRecognitionContext({ fifths: -3, clef: 'bass', timeSignature: [6, 8] })
		).toEqual({ fifths: -3, clef: 'bass', timeSignature: [6, 8] });
	});

	it.each([
		['a non-object', 'nonsense'],
		['null', null],
		['an empty object', {}]
	])('reads %s as no context at all', (_label, raw) => {
		expect(sanitizeRecognitionContext(raw)).toEqual({
			fifths: null,
			clef: null,
			timeSignature: null
		});
	});

	it('drops a key signature past seven accidentals or off the integer grid', () => {
		expect(sanitizeRecognitionContext({ fifths: 7 }).fifths).toBe(7);
		expect(sanitizeRecognitionContext({ fifths: -7 }).fifths).toBe(-7);
		expect(sanitizeRecognitionContext({ fifths: 8 }).fifths).toBeNull();
		expect(sanitizeRecognitionContext({ fifths: -8 }).fifths).toBeNull();
		expect(sanitizeRecognitionContext({ fifths: 1.5 }).fifths).toBeNull();
		expect(sanitizeRecognitionContext({ fifths: '2' }).fifths).toBeNull();
	});

	it('drops an unknown clef', () => {
		expect(sanitizeRecognitionContext({ clef: 'percussion' }).clef).toBeNull();
	});

	it('drops a meter that is not two positive integers up to 32', () => {
		expect(sanitizeRecognitionContext({ timeSignature: [32, 32] }).timeSignature).toEqual([32, 32]);
		for (const ts of [[4], [4, 4, 4], [0, 4], [4, 33], [3.5, 4], ['4', 4]]) {
			expect(sanitizeRecognitionContext({ timeSignature: ts }).timeSignature, String(ts)).toBeNull();
		}
	});
});

describe('sanitizeEvidence', () => {
	it('returns no evidence for a non-array', () => {
		expect(sanitizeEvidence({ count: 1, letters: ['C4'] }, 4)).toEqual([]);
	});

	it('keeps at most `count` entries, nulling each malformed one in place', () => {
		const raw = [
			{ count: 2, letters: ['C4', 'E-1'] },
			{ count: -1, letters: [] },
			{ count: 129, letters: [] },
			{ count: 1, letters: ['H4'] },
			{ count: 1, letters: 'C4' },
			null,
			{ count: 0, letters: [] }
		];
		expect(sanitizeEvidence(raw, 6)).toEqual([
			{ count: 2, letters: ['C4', 'E-1'] },
			null,
			null,
			null,
			null,
			null
		]);
	});

	it('copies the letters, bounded to 128', () => {
		const letters = Array.from({ length: 200 }, () => 'G3');
		const [ev] = sanitizeEvidence([{ count: 128, letters }], 1);
		expect(ev?.count).toBe(128);
		expect(ev?.letters).toHaveLength(128);
	});
});

describe('screenSystemBars', () => {
	const bar = (melody: unknown[], extra: Record<string, unknown> = {}) => ({ melody, ...extra });

	it('screens a well-formed reading and its context', () => {
		const out = screenSystemBars({
			keySignature: { fifths: 1 },
			clef: 'treble',
			timeSignature: [4, 4],
			bars: [
				bar([[0, 2, 'G4'], [2, 2, 'rest', true]], { startRepeat: true, ending: 1 }),
				bar([[1, 3, 'F#5']], { pickup: true, endRepeat: 'yes' })
			]
		});
		expect(out).toEqual({
			fifths: 1,
			clef: 'treble',
			timeSignature: [4, 4],
			bars: [
				{
					startRepeat: true,
					endRepeat: false,
					ending: 1,
					pickup: false,
					melody: [[0, 2, 'G4'], [2, 2, 'rest', true]]
				},
				// A truthy-but-not-true flag is not a repeat.
				{ startRepeat: false, endRepeat: false, ending: null, pickup: true, melody: [[1, 3, 'F#5']] }
			]
		});
	});

	it('keeps the tie flag only when it is literally true', () => {
		const out = screenSystemBars({ bars: [bar([[0, 4, 'C4', 'true']])] });
		expect(out?.bars[0].melody).toEqual([[0, 4, 'C4']]);
	});

	it.each([
		['a non-object', 42],
		['no bars', {}],
		['more than 32 bars', { bars: Array.from({ length: 33 }, () => bar([])) }],
		['a bar that is not an object', { bars: ['|'] }],
		['a bar without a melody array', { bars: [{ melody: 'C D E' }] }],
		['a melody over 128 events', { bars: [bar(Array.from({ length: 129 }, () => [0, 1, 'C4']))] }],
		['a short note tuple', { bars: [bar([[0, 1]])] }],
		['a string beat', { bars: [bar([['0', 1, 'C4']])] }],
		['a negative beat', { bars: [bar([[-1, 1, 'C4']])] }],
		['a zero duration', { bars: [bar([[0, 0, 'C4']])] }],
		['an infinite duration', { bars: [bar([[0, Infinity, 'C4']])] }],
		['an unreadable pitch', { bars: [bar([[0, 1, 'H4']])] }],
		['a triple sharp', { bars: [bar([[0, 1, 'C###4']])] }]
	])('rejects the whole reading for %s', (_label, raw) => {
		expect(screenSystemBars(raw)).toBeNull();
	});

	it('accepts double accidentals, negative octaves and a capitalised rest', () => {
		const out = screenSystemBars({ bars: [bar([[0, 1, 'Bbb3'], [1, 1, 'C-1'], [2, 2, 'REST']])] });
		expect(out?.bars[0].melody.map((n) => n[2])).toEqual(['Bbb3', 'C-1', 'REST']);
	});

	it('nulls a malformed context without rejecting the bars', () => {
		const out = screenSystemBars({ keySignature: { fifths: 9 }, clef: 3, bars: [] });
		expect(out).toEqual({ fifths: null, clef: null, timeSignature: null, bars: [] });
	});
});

describe('systemBarIssues', () => {
	const recognized = (melody: RecognizedBar['melody'], pickup = false): RecognizedBar => ({
		startRepeat: false,
		endRepeat: false,
		ending: null,
		pickup,
		melody
	});

	it('flags a bar-count mismatch globally and tiling per bar', () => {
		const { global, perBar } = systemBarIssues(
			[recognized([[0, 4, 'C4']]), recognized([[0, 2, 'D4']])],
			3,
			4
		);
		expect(global).toEqual(['expected 3 bars but the transcription returned 2']);
		expect(perBar[0]).toEqual([]);
		expect(perBar[1].length).toBeGreaterThan(0);
		expect(perBar[1][0]).toMatch(/^bar 2:/);
	});

	it("excuses a pickup bar's unprinted leading silence, and only a pickup's", () => {
		const late: RecognizedBar['melody'] = [[3, 1, 'G4']];
		expect(systemBarIssues([recognized(late, true)], 1, 4).perBar[0]).toEqual([]);
		expect(systemBarIssues([recognized(late, false)], 1, 4).perBar[0]).not.toEqual([]);
	});
});

describe('screenHarmonyReading', () => {
	it('throws when the measure count disagrees with the layout', () => {
		expect(() => screenHarmonyReading({ bars: [[], []] }, 3, 4)).toThrow(/measure count/);
		expect(() => screenHarmonyReading(null, 0, 4)).toThrow(/measure count/);
	});

	it('keeps measure alignment: drops unreadable chords with an issue on THAT bar, sorted by beat', () => {
		const out = screenHarmonyReading(
			{
				bars: [
					[
						[2, 'G7'],
						[0, 'Dm7']
					],
					[
						[0, 'N.C.'],
						[4, 'C'],
						[1, 'Xq'],
						[-1, 'F']
					],
					'garbage'
				]
			},
			3,
			4
		);
		expect(out.bars).toEqual([
			[
				[0, 'Dm7'],
				[2, 'G7']
			],
			[[0, 'N.C.']],
			[]
		]);
		expect(out.issues[0]).toEqual([]);
		expect(out.issues[1]).toHaveLength(3);
		expect(out.issues[2]).toEqual(['unreadable chord symbols']);
	});
});
