import { describe, it, expect } from 'vitest';
import {
	DURATIONS,
	BASE_DURATION_IDS,
	DURATION_DISPLAY_NAMES,
	KEYBOARD_SHORTCUTS,
	getDurationFraction,
	type DurationId,
	type BaseDurationId
} from '$lib/step-entry/durations';

describe('DURATIONS', () => {
	it('has all 8 duration entries', () => {
		expect(Object.keys(DURATIONS)).toHaveLength(8);
	});

	it('whole note is [1, 1]', () => {
		expect(DURATIONS.whole).toEqual([1, 1]);
	});

	it('quarter note is [1, 4]', () => {
		expect(DURATIONS.quarter).toEqual([1, 4]);
	});

	it('triplet durations are 2/3 of base', () => {
		// whole-triplet = 2/3, half-triplet = 1/3
		expect(DURATIONS['whole-triplet']).toEqual([2, 3]);
		expect(DURATIONS['half-triplet']).toEqual([1, 3]);
		expect(DURATIONS['quarter-triplet']).toEqual([1, 6]);
		expect(DURATIONS['eighth-triplet']).toEqual([1, 12]);
	});
});

describe('BASE_DURATION_IDS', () => {
	it('lists 4 base durations in order', () => {
		expect(BASE_DURATION_IDS).toEqual(['whole', 'half', 'quarter', 'eighth']);
	});
});

describe('DURATION_DISPLAY_NAMES', () => {
	it('has a display name for every DurationId', () => {
		const allIds: DurationId[] = [
			'whole', 'half', 'quarter', 'eighth',
			'whole-triplet', 'half-triplet', 'quarter-triplet', 'eighth-triplet'
		];
		for (const id of allIds) {
			expect(DURATION_DISPLAY_NAMES[id]).toBeTruthy();
		}
	});
});

describe('KEYBOARD_SHORTCUTS', () => {
	it('maps 1-4 to base durations', () => {
		expect(KEYBOARD_SHORTCUTS['1']).toBe('whole');
		expect(KEYBOARD_SHORTCUTS['2']).toBe('half');
		expect(KEYBOARD_SHORTCUTS['3']).toBe('quarter');
		expect(KEYBOARD_SHORTCUTS['4']).toBe('eighth');
	});
});

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
});
