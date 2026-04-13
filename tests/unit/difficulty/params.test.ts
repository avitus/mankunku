import { describe, it, expect } from 'vitest';
import { getProfile, levelToContentTier } from '$lib/difficulty/params.ts';

describe('getProfile', () => {
	it('returns correct profile for content tiers 1-10', () => {
		expect(getProfile(1).name).toBe('Roots & 5ths');
		expect(getProfile(7).name).toBe('Bebop Lines');
		expect(getProfile(10).name).toBe('No Limits');
	});

	it('maps player levels (1-100) to content tiers', () => {
		expect(getProfile(1).name).toBe('Roots & 5ths');
		expect(getProfile(15).name).toBe('Swing 8ths');       // tier 3
		expect(getProfile(50).name).toBe('Enclosures');        // tier 6
		expect(getProfile(70).name).toBe('Altered Harmony');   // tier 8
		expect(getProfile(100).name).toBe('No Limits');        // tier 10
	});

	it('throws for invalid level', () => {
		expect(() => getProfile(0)).toThrow();
	});
});

describe('levelToContentTier', () => {
	it('maps level 1 to tier 1', () => {
		expect(levelToContentTier(1)).toBe(1);
	});

	it('maps level 100 to tier 10', () => {
		expect(levelToContentTier(100)).toBe(10);
	});

	it('returns monotonically increasing tiers', () => {
		let prevTier = 0;
		for (let level = 1; level <= 100; level++) {
			const tier = levelToContentTier(level);
			expect(tier).toBeGreaterThanOrEqual(prevTier);
			prevTier = tier;
		}
	});
});
