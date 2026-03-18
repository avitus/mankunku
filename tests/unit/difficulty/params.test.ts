import { describe, it, expect } from 'vitest';
import { DIFFICULTY_PROFILES, getProfile } from '$lib/difficulty/params.ts';

describe('DIFFICULTY_PROFILES', () => {
	it('has 10 levels', () => {
		expect(DIFFICULTY_PROFILES).toHaveLength(10);
	});

	it('levels are sequential 1-10', () => {
		DIFFICULTY_PROFILES.forEach((p, i) => {
			expect(p.level).toBe(i + 1);
		});
	});

	it('tempo ranges increase with level', () => {
		for (let i = 1; i < DIFFICULTY_PROFILES.length; i++) {
			const prev = DIFFICULTY_PROFILES[i - 1];
			const curr = DIFFICULTY_PROFILES[i];
			expect(curr.tempoRange[1]).toBeGreaterThanOrEqual(prev.tempoRange[1]);
		}
	});

	it('max interval increases with level', () => {
		for (let i = 1; i < DIFFICULTY_PROFILES.length; i++) {
			const prev = DIFFICULTY_PROFILES[i - 1];
			const curr = DIFFICULTY_PROFILES[i];
			expect(curr.maxInterval).toBeGreaterThanOrEqual(prev.maxInterval);
		}
	});
});

describe('getProfile', () => {
	it('returns correct profile', () => {
		expect(getProfile(1).name).toBe('Roots & 5ths');
		expect(getProfile(7).name).toBe('Bebop Lines');
	});

	it('throws for invalid level', () => {
		expect(() => getProfile(0)).toThrow();
		expect(() => getProfile(11)).toThrow();
	});
});
