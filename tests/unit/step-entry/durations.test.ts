import { describe, it, expect } from 'vitest';
import { getDurationFraction } from '$lib/step-entry/durations';

describe('getDurationFraction', () => {
	it('returns base duration when triplet is false', () => {
		expect(getDurationFraction('quarter', false)).toEqual([1, 4]);
		expect(getDurationFraction('eighth', false)).toEqual([1, 8]);
	});

	it('returns triplet duration when triplet is true', () => {
		expect(getDurationFraction('quarter', true)).toEqual([1, 6]);
		expect(getDurationFraction('eighth', true)).toEqual([1, 12]);
		expect(getDurationFraction('whole', true)).toEqual([2, 3]);
	});

	it('returns half triplet correctly', () => {
		expect(getDurationFraction('half', true)).toEqual([1, 3]);
	});

	it('returns dotted duration for half and quarter', () => {
		expect(getDurationFraction('half', false, true)).toEqual([3, 4]);
		expect(getDurationFraction('quarter', false, true)).toEqual([3, 8]);
	});

	it('ignores dotted flag for whole and eighth', () => {
		expect(getDurationFraction('whole', false, true)).toEqual([1, 1]);
		expect(getDurationFraction('eighth', false, true)).toEqual([1, 8]);
	});

	it('dotted takes precedence over triplet', () => {
		expect(getDurationFraction('quarter', true, true)).toEqual([3, 8]);
	});
});
