import { expect, it } from 'vitest';
import { resolvePrintedTriplets } from '$lib/tunes/import/pdf-tuplets';
const events = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		x: 100 + i * 50,
		center: 114 + i * 50,
		duration: 0.5
	}));
it('solves two separately printed triplets together against the measure length', () => {
	const result = resolvePrintedTriplets(
		events(10),
		[
			{ x: 157, w: 14 },
			{ x: 407, w: 14 }
		],
		4,
		20
	);
	expect(result).toEqual([1 / 3, 1 / 3, 1 / 3, 0.5, 0.5, 1 / 3, 1 / 3, 1 / 3, 0.5, 0.5]);
});
it('uses notehead centers when matching a printed triplet number', () => {
	expect(resolvePrintedTriplets(events(9), [{ x: 177, w: 14 }], 4, 20)?.slice(0, 4)).toEqual([
		1 / 3,
		1 / 3,
		1 / 3,
		0.5
	]);
});
it('declines overlapping, equally plausible or rhythmically impossible triplet assignments', () => {
	expect(
		resolvePrintedTriplets(
			events(9),
			[
				{ x: 157, w: 14 },
				{ x: 157, w: 14 }
			],
			4,
			20
		)
	).toBeNull();
	expect(resolvePrintedTriplets(events(9), [{ x: 182, w: 14 }], 4, 20)).toBeNull();
	expect(resolvePrintedTriplets(events(8), [{ x: 157, w: 14 }], 4, 20)).toBeNull();
});
