import { describe, it, expect } from 'vitest';
import {
	accuracyTier,
	accuracyTierInfo,
	ACCURACY_TIERS,
	GRADE_COLORS
} from '$lib/ui/score-colors';
import { GRADE_LABELS } from '$lib/scoring/grades';

describe('accuracyTierInfo', () => {
	it('maps ≥ 0.95 to gold', () => {
		expect(accuracyTierInfo(0.95).key).toBe('gold');
		expect(accuracyTierInfo(1).key).toBe('gold');
	});

	it('maps [0.85, 0.95) to silver', () => {
		expect(accuracyTierInfo(0.85).key).toBe('silver');
		expect(accuracyTierInfo(0.9499).key).toBe('silver');
	});

	it('maps [0.70, 0.85) to bronze', () => {
		expect(accuracyTierInfo(0.7).key).toBe('bronze');
		expect(accuracyTierInfo(0.84).key).toBe('bronze');
	});

	it('maps [0.55, 0.70) to teal (needs work)', () => {
		expect(accuracyTierInfo(0.55).key).toBe('teal');
		expect(accuracyTierInfo(0.69).key).toBe('teal');
	});

	it('maps < 0.55 to deep teal (rough)', () => {
		expect(accuracyTierInfo(0.54).key).toBe('deep');
		expect(accuracyTierInfo(0).key).toBe('deep');
	});

	it('clamps out-of-range input', () => {
		expect(accuracyTierInfo(1.5).key).toBe('gold');
		expect(accuracyTierInfo(-1).key).toBe('deep');
	});
});

describe('accuracyTier', () => {
	it('returns the tier CSS custom property', () => {
		expect(accuracyTier(0.97)).toBe('var(--accuracy-gold)');
		expect(accuracyTier(0.6)).toBe('var(--accuracy-teal)');
		expect(accuracyTier(0.2)).toBe('var(--accuracy-deep)');
	});
});

describe('ACCURACY_TIERS', () => {
	it('is ordered by descending threshold', () => {
		const mins = ACCURACY_TIERS.map((t) => t.min);
		expect(mins).toEqual([...mins].sort((a, b) => b - a));
	});

	it('bottoms out at 0 so every score matches a tier', () => {
		expect(ACCURACY_TIERS[ACCURACY_TIERS.length - 1].min).toBe(0);
	});
});

describe('GRADE_COLORS', () => {
	it('maps every grade to an accuracy-tier CSS var', () => {
		for (const key of Object.keys(GRADE_LABELS) as (keyof typeof GRADE_COLORS)[]) {
			expect(GRADE_COLORS[key]).toMatch(/^var\(--accuracy-/);
		}
	});

	it('walks the medal scale from perfect (gold) to try-again (deep)', () => {
		expect(GRADE_COLORS.perfect).toBe('var(--accuracy-gold)');
		expect(GRADE_COLORS.great).toBe('var(--accuracy-silver)');
		expect(GRADE_COLORS.good).toBe('var(--accuracy-bronze)');
		expect(GRADE_COLORS.fair).toBe('var(--accuracy-teal)');
		expect(GRADE_COLORS['try-again']).toBe('var(--accuracy-deep)');
	});
});
