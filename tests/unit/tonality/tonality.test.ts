import { describe, it, expect } from 'vitest';
import {
	getUnlockedKeys,
	getUnlockedScaleTypes,
	isKeyUnlocked,
	isScaleTypeUnlocked,
	isTonalityUnlocked,
	getDailyTonality,
	getUnlockedTonalities,
	formatTonality,
	tonalitiesEqual,
	xpRequiredForKey,
	xpRequiredForScaleType,
	xpRequiredForTonality,
	KEY_UNLOCK_ORDER,
	SCALE_UNLOCK_ORDER
} from '$lib/tonality/tonality.ts';

describe('tonality unlock system', () => {
	it('unlocks C major-pentatonic, C major, and C blues at 0 XP', () => {
		const keys = getUnlockedKeys(0);
		const scales = getUnlockedScaleTypes(0);
		expect(keys).toEqual(['C']);
		expect(scales).toEqual(['major-pentatonic', 'major', 'blues']);
	});

	it('unlocks more keys as XP increases', () => {
		const keys200 = getUnlockedKeys(200);
		expect(keys200).toContain('C');
		expect(keys200).toContain('G');
		expect(keys200).not.toContain('D');

		const keys700 = getUnlockedKeys(700);
		expect(keys700).toContain('D');
	});

	it('unlocks more scale types as XP increases', () => {
		const scales300 = getUnlockedScaleTypes(300);
		expect(scales300).toContain('major');
		expect(scales300).toContain('blues');
		expect(scales300).toContain('dorian');
		expect(scales300).not.toContain('mixolydian');

		const scales600 = getUnlockedScaleTypes(600);
		expect(scales600).toContain('mixolydian');
	});

	it('checks individual key unlock status', () => {
		expect(isKeyUnlocked('C', 0)).toBe(true);
		expect(isKeyUnlocked('G', 0)).toBe(false);
		expect(isKeyUnlocked('G', 200)).toBe(true);
	});

	it('checks individual scale type unlock status', () => {
		expect(isScaleTypeUnlocked('major', 0)).toBe(true);
		expect(isScaleTypeUnlocked('dorian', 0)).toBe(false);
		expect(isScaleTypeUnlocked('dorian', 300)).toBe(true);
	});

	it('checks tonality unlock (requires both key and scale)', () => {
		expect(isTonalityUnlocked({ key: 'C', scaleType: 'major' }, 0)).toBe(true);
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'major' }, 0)).toBe(false);
		expect(isTonalityUnlocked({ key: 'C', scaleType: 'dorian' }, 0)).toBe(false);
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'dorian' }, 300)).toBe(true);
	});

	it('returns correct XP thresholds', () => {
		expect(xpRequiredForKey('C')).toBe(0);
		expect(xpRequiredForKey('G')).toBe(200);
		expect(xpRequiredForScaleType('major')).toBe(0);
		expect(xpRequiredForScaleType('dorian')).toBe(300);
		// Tonality XP = max of key + scale
		expect(xpRequiredForTonality({ key: 'G', scaleType: 'dorian' })).toBe(300);
		expect(xpRequiredForTonality({ key: 'D', scaleType: 'dorian' })).toBe(700);
	});
});

describe('daily tonality selection', () => {
	it('returns C major-pentatonic, C major, or C blues at 0 XP', () => {
		const t = getDailyTonality('2026-03-19', 0);
		expect(t.key).toBe('C');
		expect(['major-pentatonic', 'major', 'blues']).toContain(t.scaleType);
	});

	it('is deterministic for the same date and XP', () => {
		const a = getDailyTonality('2026-03-19', 500);
		const b = getDailyTonality('2026-03-19', 500);
		expect(tonalitiesEqual(a, b)).toBe(true);
	});

	it('changes with different dates', () => {
		// With enough unlocked tonalities, different dates should (usually) differ
		const dates = Array.from({ length: 30 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
		const tonalities = dates.map(d => getDailyTonality(d, 5000));
		const unique = new Set(tonalities.map(t => `${t.key}-${t.scaleType}`));
		// With 5000 XP there are many tonalities; 30 days should produce variety
		expect(unique.size).toBeGreaterThan(5);
	});

	it('only selects from unlocked tonalities', () => {
		for (let i = 0; i < 50; i++) {
			const date = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
			const t = getDailyTonality(date, 0);
			expect(isTonalityUnlocked(t, 0)).toBe(true);
		}
	});
});

describe('getUnlockedTonalities', () => {
	it('returns 3 tonalities at 0 XP (C major-pentatonic, C major, C blues)', () => {
		const t = getUnlockedTonalities(0);
		expect(t).toHaveLength(3);
		expect(t[0]).toEqual({ key: 'C', scaleType: 'major-pentatonic' });
		expect(t[1]).toEqual({ key: 'C', scaleType: 'major' });
		expect(t[2]).toEqual({ key: 'C', scaleType: 'blues' });
	});

	it('returns cross-product of unlocked keys and scales', () => {
		// At 300 XP: keys=[C, G], scales=[major-pentatonic, major, blues, dorian] => 8 tonalities
		const t = getUnlockedTonalities(300);
		expect(t).toHaveLength(8);
	});
});

describe('display helpers', () => {
	it('formats tonality correctly', () => {
		expect(formatTonality({ key: 'D', scaleType: 'dorian' })).toBe('D Dorian');
		expect(formatTonality({ key: 'Bb', scaleType: 'blues' })).toBe('Bb Blues');
		expect(formatTonality({ key: 'C', scaleType: 'major' })).toBe('C Major');
	});

	it('compares tonalities for equality', () => {
		expect(tonalitiesEqual(
			{ key: 'C', scaleType: 'major' },
			{ key: 'C', scaleType: 'major' }
		)).toBe(true);
		expect(tonalitiesEqual(
			{ key: 'C', scaleType: 'major' },
			{ key: 'D', scaleType: 'major' }
		)).toBe(false);
	});
});
