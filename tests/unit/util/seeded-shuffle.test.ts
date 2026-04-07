import { describe, it, expect } from 'vitest';
import { seededShuffle } from '$lib/util/seeded-shuffle';

describe('seededShuffle', () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

	it('same seed produces same output', () => {
		const a = seededShuffle(items, 42);
		const b = seededShuffle(items, 42);
		expect(a).toEqual(b);
	});

	it('different seeds produce different output', () => {
		const a = seededShuffle(items, 1);
		const b = seededShuffle(items, 2);
		expect(a).not.toEqual(b);
	});

	it('preserves all elements (no drops or duplicates)', () => {
		const result = seededShuffle(items, 99);
		expect(result.sort((a, b) => a - b)).toEqual(items);
	});

	it('does not mutate the input', () => {
		const copy = [...items];
		seededShuffle(items, 7);
		expect(items).toEqual(copy);
	});

	it('returns empty array for empty input', () => {
		expect(seededShuffle([], 0)).toEqual([]);
	});

	it('returns single element for single-element input', () => {
		expect(seededShuffle(['a'], 123)).toEqual(['a']);
	});

	it('actually reorders elements', () => {
		const result = seededShuffle(items, 12345);
		expect(result).not.toEqual(items);
	});
});
