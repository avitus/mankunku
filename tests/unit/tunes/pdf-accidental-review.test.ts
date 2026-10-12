import { describe, expect, it } from 'vitest';
import {
	comparePrintedAccidentals,
	screenAccidentalReading
} from '$lib/tunes/import/pdf-accidental-review';
import type { RecognizedBar } from '$lib/tunes/import/pdf-recognition';
const bar = (melody: RecognizedBar['melody']): RecognizedBar => ({
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody
});
const reading = { bars: [{ notes: 3, signs: [[1, 'sharp']] }] };
const evidence = [{ count: 3, letters: ['A4', 'A4', 'B4'] }];
const original = [
	bar([
		[0, 1, 'A4'],
		[1, 1, 'A4'],
		[2, 2, 'B4']
	])
];
describe('independent printed accidental review', () => {
	it('flags two matching symbol observations and their carry without rewriting notes', () => {
		const first = screenAccidentalReading(reading, 1);
		const result = comparePrintedAccidentals(original, evidence, first, first);
		expect(result.bars[0].melody).toEqual([
			[0, 1, 'A4'],
			[1, 1, 'A4'],
			[2, 2, 'B4']
		]);
		expect(result.warnings.join(' ')).toContain('accidental');
		expect(original[0].melody[0][2]).toBe('A4');
	});
	it.each([
		{ bars: [{ notes: 2, signs: [[1, 'sharp']] }] },
		{ bars: [{ notes: 3, signs: [[1, 'flat']] }] },
		{ bars: [{ notes: 3, signs: [] }] }
	])('retains the original when count or symbol readings disagree: %j', (other) => {
		const result = comparePrintedAccidentals(
			original,
			evidence,
			screenAccidentalReading(reading, 1),
			screenAccidentalReading(other, 1)
		);
		expect(result.bars).toEqual(original);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
	it('requires complete pitch alignment independently of symbol agreement', () => {
		const first = screenAccidentalReading(reading, 1);
		expect(
			comparePrintedAccidentals(original, [{ count: 3, letters: [] }], first, first).bars
		).toEqual(original);
		expect(
			comparePrintedAccidentals(original, [{ count: 3, letters: ['A4', 'A4', 'C5'] }], first, first)
				.bars
		).toEqual(original);
	});
	it('does not reset pitches when no explicit symbol is reported', () => {
		const first = screenAccidentalReading({ bars: [{ notes: 3, signs: [] }] }, 1);
		expect(comparePrintedAccidentals(original, evidence, first, first).bars).toEqual(original);
	});
	it('declines a correction that would contradict an incoming tie', () => {
		const bars = [bar([[0, 4, 'A4', true]]), bar([[0, 4, 'A4']])];
		const first = screenAccidentalReading(
			{
				bars: [
					{ notes: 1, signs: [] },
					{ notes: 1, signs: [[1, 'sharp']] }
				]
			},
			2
		);
		expect(
			comparePrintedAccidentals(
				bars,
				[
					{ count: 1, letters: ['A4'] },
					{ count: 1, letters: ['A4'] }
				],
				first,
				first
			).bars
		).toEqual(bars);
	});
	it.each([
		{ bars: [] },
		{ bars: [{ notes: 3, signs: [[0, 'sharp']] }] },
		{ bars: [{ notes: 3, signs: [[4, 'sharp']] }] },
		{ bars: [{ notes: 3, signs: [[1, 'maybe']] }] },
		{
			bars: [
				{
					notes: 3,
					signs: [
						[1, 'sharp'],
						[1, 'flat']
					]
				}
			]
		},
		{ bars: [{ notes: 3.5, signs: [] }] }
	])('rejects malformed or ambiguous symbol observations: %j', (raw) => {
		expect(() => screenAccidentalReading(raw, 1)).toThrow();
	});
});
