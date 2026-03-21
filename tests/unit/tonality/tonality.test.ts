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
	getScaleUnlockRequirements,
	getKeyUnlockRequirements,
	KEY_UNLOCK_ORDER,
	SCALE_UNLOCK_ORDER,
	SCALE_PREREQUISITES,
	KEY_UNLOCK_PREREQUISITES
} from '$lib/tonality/tonality.ts';
import type { UnlockContext } from '$lib/types/progress.ts';

/** Helper to build an UnlockContext with specific levels */
function ctx(
	scales: Record<string, number> = {},
	keys: Record<string, number> = {}
): UnlockContext {
	const scaleProficiency: Record<string, { level: number }> = {};
	for (const [k, v] of Object.entries(scales)) {
		scaleProficiency[k] = { level: v };
	}
	const keyProficiency: Record<string, { level: number }> = {};
	for (const [k, v] of Object.entries(keys)) {
		keyProficiency[k] = { level: v };
	}
	return { scaleProficiency, keyProficiency } as UnlockContext;
}

const EMPTY_CTX = ctx();

describe('proficiency-based scale unlock', () => {
	it('unlocks only major-pentatonic with no proficiency', () => {
		const scales = getUnlockedScaleTypes(EMPTY_CTX);
		expect(scales).toEqual(['major-pentatonic']);
	});

	it('unlocks minor-pentatonic and major when pentatonic proficiency >= 15', () => {
		const c = ctx({ 'major-pentatonic': 15 });
		const scales = getUnlockedScaleTypes(c);
		expect(scales).toContain('major-pentatonic');
		expect(scales).toContain('minor-pentatonic');
		expect(scales).toContain('major');
		expect(scales).not.toContain('blues'); // needs minor-pent >= 15
		expect(scales).not.toContain('dorian'); // needs minor-pent >= 20
	});

	it('unlocks blues when minor-pentatonic proficiency >= 15', () => {
		const c = ctx({ 'major-pentatonic': 15, 'minor-pentatonic': 15 });
		expect(isScaleTypeUnlocked('blues', c)).toBe(true);
	});

	it('unlocks dorian when minor-pentatonic proficiency >= 20', () => {
		const c = ctx({ 'major-pentatonic': 15, 'minor-pentatonic': 20 });
		expect(isScaleTypeUnlocked('dorian', c)).toBe(true);
		// But not minor yet (needs dorian >= 25)
		expect(isScaleTypeUnlocked('minor', c)).toBe(false);
	});

	it('unlocks minor when dorian proficiency >= 25', () => {
		const c = ctx({ 'major-pentatonic': 15, 'minor-pentatonic': 20, 'dorian': 25 });
		expect(isScaleTypeUnlocked('minor', c)).toBe(true);
	});

	it('unlocks mixolydian when major proficiency >= 20', () => {
		const c = ctx({ 'major-pentatonic': 15, 'major': 20 });
		expect(isScaleTypeUnlocked('mixolydian', c)).toBe(true);
	});

	it('unlocks melodic-minor when major >= 30 AND minor >= 25', () => {
		// Missing minor
		const c1 = ctx({ 'major-pentatonic': 15, 'major': 30, 'minor-pentatonic': 20, 'dorian': 25 });
		expect(isScaleTypeUnlocked('melodic-minor', c1)).toBe(false);

		// Both met
		const c2 = ctx({
			'major-pentatonic': 15, 'major': 30,
			'minor-pentatonic': 20, 'dorian': 25, 'minor': 25
		});
		expect(isScaleTypeUnlocked('melodic-minor', c2)).toBe(true);
	});

	it('unlocks altered and lydian-dominant when melodic-minor >= 40', () => {
		const c = ctx({
			'major-pentatonic': 15, 'major': 30,
			'minor-pentatonic': 20, 'dorian': 25, 'minor': 25,
			'melodic-minor': 40
		});
		expect(isScaleTypeUnlocked('altered', c)).toBe(true);
		expect(isScaleTypeUnlocked('lydian-dominant', c)).toBe(true);
	});

	it('unlocks bebop-dominant when mixolydian >= 35', () => {
		const c = ctx({ 'major-pentatonic': 15, 'major': 20, 'mixolydian': 35 });
		expect(isScaleTypeUnlocked('bebop-dominant', c)).toBe(true);
	});

	it('does not unlock scale when prereq is just below threshold', () => {
		expect(isScaleTypeUnlocked('minor-pentatonic', ctx({ 'major-pentatonic': 14 }))).toBe(false);
		expect(isScaleTypeUnlocked('minor-pentatonic', ctx({ 'major-pentatonic': 15 }))).toBe(true);
	});
});

describe('proficiency-based key unlock', () => {
	it('unlocks only C with no proficiency', () => {
		const keys = getUnlockedKeys(EMPTY_CTX);
		expect(keys).toEqual(['C']);
	});

	it('unlocks G and F when C key proficiency >= 10', () => {
		const c = ctx({}, { 'C': 10 });
		const keys = getUnlockedKeys(c);
		expect(keys).toContain('C');
		expect(keys).toContain('G');
		expect(keys).toContain('F');
		expect(keys).not.toContain('D'); // needs G >= 10
	});

	it('unlocks D when G key proficiency >= 10', () => {
		const c = ctx({}, { 'C': 10, 'G': 10 });
		expect(isKeyUnlocked('D', c)).toBe(true);
	});

	it('unlocks sharper keys at higher proficiency', () => {
		const c = ctx({}, { 'C': 15, 'G': 15, 'D': 15, 'A': 15, 'E': 15, 'B': 15 });
		expect(isKeyUnlocked('Gb', c)).toBe(true);
	});

	it('unlocks flat keys progressively', () => {
		const c = ctx({}, { 'C': 10, 'F': 10, 'Bb': 10, 'Eb': 15, 'Ab': 15 });
		expect(isKeyUnlocked('Bb', c)).toBe(true);
		expect(isKeyUnlocked('Eb', c)).toBe(true);
		expect(isKeyUnlocked('Ab', c)).toBe(true);
		expect(isKeyUnlocked('Db', c)).toBe(true);
	});

	it('does not unlock key when prereq is below threshold', () => {
		expect(isKeyUnlocked('G', ctx({}, { 'C': 9 }))).toBe(false);
		expect(isKeyUnlocked('G', ctx({}, { 'C': 10 }))).toBe(true);
	});
});

describe('tonality unlock (key + scale)', () => {
	it('C major-pentatonic is always unlocked', () => {
		expect(isTonalityUnlocked({ key: 'C', scaleType: 'major-pentatonic' }, EMPTY_CTX)).toBe(true);
	});

	it('requires both key and scale to be unlocked', () => {
		// Scale unlocked but key locked
		const c1 = ctx({ 'major-pentatonic': 15 }, {});
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'minor-pentatonic' }, c1)).toBe(false);

		// Key unlocked but scale locked
		const c2 = ctx({}, { 'C': 10 });
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'minor-pentatonic' }, c2)).toBe(false);

		// Both unlocked
		const c3 = ctx({ 'major-pentatonic': 15 }, { 'C': 10 });
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'minor-pentatonic' }, c3)).toBe(true);
	});
});

describe('daily tonality selection', () => {
	it('returns C major-pentatonic at empty proficiency', () => {
		const t = getDailyTonality('2026-03-19', EMPTY_CTX);
		expect(t.key).toBe('C');
		expect(t.scaleType).toBe('major-pentatonic');
	});

	it('is deterministic for the same date and context', () => {
		const c = ctx({ 'major-pentatonic': 15, 'minor-pentatonic': 15 }, { 'C': 10 });
		const a = getDailyTonality('2026-03-19', c);
		const b = getDailyTonality('2026-03-19', c);
		expect(tonalitiesEqual(a, b)).toBe(true);
	});

	it('changes with different dates when many tonalities unlocked', () => {
		const c = ctx(
			{ 'major-pentatonic': 50, 'minor-pentatonic': 50, 'major': 50, 'blues': 50,
			  'dorian': 50, 'mixolydian': 50, 'minor': 50, 'lydian': 50,
			  'melodic-minor': 50, 'altered': 50, 'lydian-dominant': 50, 'bebop-dominant': 50 },
			{ 'C': 20, 'G': 20, 'F': 20, 'D': 20, 'Bb': 20, 'A': 20, 'Eb': 20, 'E': 20 }
		);
		const dates = Array.from({ length: 30 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
		const tonalities = dates.map(d => getDailyTonality(d, c));
		const unique = new Set(tonalities.map(t => `${t.key}-${t.scaleType}`));
		expect(unique.size).toBeGreaterThan(5);
	});

	it('only selects from unlocked tonalities', () => {
		const c = ctx({ 'major-pentatonic': 15 }, { 'C': 10 });
		for (let i = 0; i < 50; i++) {
			const date = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
			const t = getDailyTonality(date, c);
			expect(isTonalityUnlocked(t, c)).toBe(true);
		}
	});

	it('holds tonality for multiple days at early levels', () => {
		// 1 tonality unlocked → 3 days each
		const results = Array.from({ length: 9 }, (_, i) => {
			const day = String(i + 1).padStart(2, '0');
			return getDailyTonality(`2026-06-${day}`, EMPTY_CTX);
		});
		// With only 1 tonality, should always be the same
		for (const r of results) {
			expect(r.key).toBe('C');
			expect(r.scaleType).toBe('major-pentatonic');
		}
	});
});

describe('getUnlockedTonalities', () => {
	it('returns 1 tonality at empty proficiency (C major-pentatonic)', () => {
		const t = getUnlockedTonalities(EMPTY_CTX);
		expect(t).toHaveLength(1);
		expect(t[0]).toEqual({ key: 'C', scaleType: 'major-pentatonic' });
	});

	it('returns cross-product of unlocked keys and scales', () => {
		// pent >= 15 → 3 scales (pent, minor-pent, major); C key prof 10 → 3 keys (C, G, F)
		const c = ctx({ 'major-pentatonic': 15 }, { 'C': 10 });
		const t = getUnlockedTonalities(c);
		expect(t).toHaveLength(9); // 3 scales × 3 keys
	});
});

describe('unlock requirement helpers', () => {
	it('returns empty prereqs for major-pentatonic', () => {
		expect(getScaleUnlockRequirements('major-pentatonic')).toEqual([]);
	});

	it('returns correct prereqs for melodic-minor', () => {
		const reqs = getScaleUnlockRequirements('melodic-minor');
		expect(reqs).toHaveLength(2);
		expect(reqs).toContainEqual({ scales: ['major'], level: 30 });
		expect(reqs).toContainEqual({ scales: ['minor'], level: 25 });
	});

	it('returns empty prereqs for C key', () => {
		expect(getKeyUnlockRequirements('C')).toEqual([]);
	});

	it('returns correct prereqs for D key', () => {
		const reqs = getKeyUnlockRequirements('D');
		expect(reqs).toEqual([{ key: 'G', level: 10 }]);
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
