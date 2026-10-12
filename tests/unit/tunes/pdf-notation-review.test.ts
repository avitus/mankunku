import { describe, expect, it } from 'vitest';
import { notationReviewNeeded, notationReviewsAgree } from '$lib/tunes/import/pdf-notation-review';
import type { RecognizedBar } from '$lib/tunes/import/pdf-recognition';
const bar: RecognizedBar = {
	startRepeat: false,
	endRepeat: false,
	ending: null,
	pickup: false,
	melody: [
		[0, 2, 'A4', true],
		[2, 2, 'A4']
	]
};
const heads = { count: 2, letters: ['A4', 'A4'] };
describe('independent notation review policy', () => {
	it('checks dots and possible missing ties without assuming they are errors', () => {
		expect(notationReviewNeeded(bar, heads)).toBe(false);
		expect(
			notationReviewNeeded(
				{
					...bar,
					melody: [
						[0, 2, 'A4'],
						[2, 2, 'A4']
					]
				},
				heads
			)
		).toBe(true);
		expect(
			notationReviewNeeded(
				{
					...bar,
					melody: [
						[0, 3, 'A4'],
						[3, 0.5, 'rest'],
						[3.5, 0.5, 'A4']
					]
				},
				heads
			)
		).toBe(true);
		expect(notationReviewNeeded(bar, { count: 2, letters: [] })).toBe(false);
	});
	it('requests full notation when the rhythm fills the bar but the note count disagrees with complete head evidence', () => {
		expect(notationReviewNeeded(bar, { count: 3, letters: ['A4', 'A4', 'B4'] })).toBe(true);
	});
	it('requires two rhythmically valid readings with full independent head agreement', () => {
		expect(notationReviewsAgree(bar, structuredClone(bar), heads, 4)).toBe(true);
		expect(notationReviewsAgree(bar, bar, { count: 2, letters: [] }, 4)).toBe(false);
		expect(notationReviewsAgree(bar, bar, heads, 3)).toBe(false);
	});
	it.each([
		[
			[0, 2, 'A4'],
			[2, 2, 'A4']
		],
		[
			[0, 1, 'A4', true],
			[1, 3, 'A4']
		],
		[
			[0, 2, 'B4', true],
			[2, 2, 'B4']
		],
		[
			[0, 2, 'A4', true],
			[2, 1, 'rest'],
			[3, 1, 'A4']
		]
	] as RecognizedBar['melody'][])(
		'rejects differing timing, ties, notes or rest placement %j',
		(...melody) => {
			expect(notationReviewsAgree(bar, { ...bar, melody }, heads, 4)).toBe(false);
		}
	);
	it('does not accept two matching but impossible ties across different pitches', () => {
		const wrong: RecognizedBar = {
			...bar,
			melody: [
				[0, 2, 'A4', true],
				[2, 2, 'B4']
			]
		};
		expect(notationReviewsAgree(wrong, wrong, { count: 2, letters: ['A4', 'B4'] }, 4)).toBe(false);
	});
});
