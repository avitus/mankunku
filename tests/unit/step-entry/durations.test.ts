import { describe, it, expect } from 'vitest';
import {
	BASE_DURATION_IDS,
	DOTTED_BASES,
	DURATIONS,
	DURATION_DISPLAY_NAMES,
	KEYBOARD_SHORTCUTS,
	TRIPLET_BASES,
	getDurationFraction,
	resolveDurationId
} from '$lib/step-entry/durations';

describe('getDurationFraction', () => {
	it('returns base duration when triplet is false', () => {
		expect(getDurationFraction('quarter', false)).toEqual([1, 4]);
		expect(getDurationFraction('eighth', false)).toEqual([1, 8]);
		expect(getDurationFraction('sixteenth', false)).toEqual([1, 16]);
	});

	it('returns triplet duration when triplet is true', () => {
		expect(getDurationFraction('quarter', true)).toEqual([1, 6]);
		expect(getDurationFraction('eighth', true)).toEqual([1, 12]);
		expect(getDurationFraction('whole', true)).toEqual([2, 3]);
	});

	it('returns half triplet correctly', () => {
		expect(getDurationFraction('half', true)).toEqual([1, 3]);
	});

	it('returns dotted duration for half, quarter and eighth', () => {
		expect(getDurationFraction('half', false, true)).toEqual([3, 4]);
		expect(getDurationFraction('quarter', false, true)).toEqual([3, 8]);
		expect(getDurationFraction('eighth', false, true)).toEqual([3, 16]);
	});

	it('ignores dotted flag for bases with no dotted variant', () => {
		expect(getDurationFraction('whole', false, true)).toEqual([1, 1]);
		expect(getDurationFraction('sixteenth', false, true)).toEqual([1, 16]);
	});

	it('ignores triplet flag for bases with no triplet variant', () => {
		// A sixteenth triplet is deliberately outside the entry vocabulary; the
		// toggle must fall back to the plain sixteenth rather than resolving to
		// an absent DURATIONS key.
		expect(getDurationFraction('sixteenth', true)).toEqual([1, 16]);
	});

	it('dotted takes precedence over triplet', () => {
		expect(getDurationFraction('quarter', true, true)).toEqual([3, 8]);
		expect(getDurationFraction('eighth', true, true)).toEqual([3, 16]);
	});

	it('returns a usable fraction for every toggle combination', () => {
		for (const base of BASE_DURATION_IDS) {
			for (const triplet of [false, true]) {
				for (const dotted of [false, true]) {
					const fraction = getDurationFraction(base, triplet, dotted);
					expect(fraction, `${base} triplet=${triplet} dotted=${dotted}`).toBeDefined();
					expect(fraction[0]).toBeGreaterThan(0);
					expect(fraction[1]).toBeGreaterThan(0);
				}
			}
		}
	});
});

describe('resolveDurationId', () => {
	it('resolves to a key that exists in DURATIONS for every combination', () => {
		for (const base of BASE_DURATION_IDS) {
			for (const triplet of [false, true]) {
				for (const dotted of [false, true]) {
					const id = resolveDurationId(base, triplet, dotted);
					expect(DURATIONS[id], `${base} triplet=${triplet} dotted=${dotted}`).toBeDefined();
					expect(DURATION_DISPLAY_NAMES[id]).toBeTruthy();
				}
			}
		}
	});

	it('agrees with getDurationFraction', () => {
		for (const base of BASE_DURATION_IDS) {
			for (const triplet of [false, true]) {
				for (const dotted of [false, true]) {
					expect(DURATIONS[resolveDurationId(base, triplet, dotted)]).toEqual(
						getDurationFraction(base, triplet, dotted)
					);
				}
			}
		}
	});
});

describe('duration vocabulary', () => {
	it('offers the sixteenth note in the selector row', () => {
		expect(BASE_DURATION_IDS).toContain('sixteenth');
	});

	it('binds a keyboard shortcut to every base duration', () => {
		const bound = Object.values(KEYBOARD_SHORTCUTS);
		for (const base of BASE_DURATION_IDS) {
			expect(bound, `no shortcut for ${base}`).toContain(base);
		}
	});

	it('declares a modifier set only for bases that have that variant', () => {
		for (const base of BASE_DURATION_IDS) {
			expect(DURATIONS[`${base}-dotted` as keyof typeof DURATIONS] !== undefined).toBe(
				DOTTED_BASES.has(base)
			);
			expect(DURATIONS[`${base}-triplet` as keyof typeof DURATIONS] !== undefined).toBe(
				TRIPLET_BASES.has(base)
			);
		}
	});
});
