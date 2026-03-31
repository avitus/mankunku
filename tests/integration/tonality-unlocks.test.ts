/**
 * Integration tests for the tonality system and unlock mechanics.
 *
 * Tests daily tonality selection, scale/key unlock prerequisites,
 * scale compatibility filtering, and the interaction between
 * proficiency levels and available content.
 */

import { describe, it, expect } from 'vitest';
import {
	getDailyTonality,
	getUnlockedKeys,
	getUnlockedScaleTypes,
	getUnlockedTonalities,
	isKeyUnlocked,
	isScaleTypeUnlocked,
	isTonalityUnlocked,
	getAllTonalitiesWithUnlockInfo,
	formatTonality,
	tonalitiesEqual,
	KEY_UNLOCK_ORDER,
	SCALE_UNLOCK_ORDER,
	SCALE_PREREQUISITES,
	KEY_UNLOCK_PREREQUISITES,
	type ScaleType,
	type Tonality
} from '../../src/lib/tonality/tonality';
import {
	getCompatibleScaleTypes,
	isLickCompatible
} from '../../src/lib/tonality/scale-compatibility';
import type { UnlockContext } from '../../src/lib/types/progress';
import type { Phrase } from '../../src/lib/types/music';

// ─── Helpers ───────────────────────────────────────────────────

function emptyContext(): UnlockContext {
	return { scaleProficiency: {}, keyProficiency: {} };
}

function fullContext(): UnlockContext {
	const ctx: UnlockContext = { scaleProficiency: {}, keyProficiency: {} };

	for (const st of SCALE_UNLOCK_ORDER) {
		ctx.scaleProficiency[st] = { level: 100 };
	}

	for (const key of KEY_UNLOCK_ORDER) {
		ctx.keyProficiency[key] = { level: 100 };
	}

	return ctx;
}

function makeLick(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'test-lick',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes: [{ pitch: 60, offset: [0, 1] as [number, number], duration: [1, 4] as [number, number] }],
		harmony: [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1] as [number, number],
			duration: [1, 1] as [number, number]
		}],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated',
		...overrides
	};
}

// ─── Key Unlocks ───────────────────────────────────────────────

describe('key unlock system', () => {
	it('C is always unlocked (no prerequisites)', () => {
		const ctx = emptyContext();
		expect(isKeyUnlocked('C', ctx)).toBe(true);
	});

	it('G and F require C at level 10', () => {
		const ctx = emptyContext();

		expect(isKeyUnlocked('G', ctx)).toBe(false);
		expect(isKeyUnlocked('F', ctx)).toBe(false);

		ctx.keyProficiency['C'] = { level: 10 };
		expect(isKeyUnlocked('G', ctx)).toBe(true);
		expect(isKeyUnlocked('F', ctx)).toBe(true);
	});

	it('keys unlock progressively through circle of fifths', () => {
		const ctx = emptyContext();
		const unlocked = getUnlockedKeys(ctx);

		// Only C should be unlocked initially
		expect(unlocked).toEqual(['C']);
	});

	it('all keys unlock with max proficiency', () => {
		const ctx = fullContext();
		const unlocked = getUnlockedKeys(ctx);
		expect(unlocked).toHaveLength(12);
	});

	it('KEY_UNLOCK_ORDER contains all 12 keys', () => {
		expect(KEY_UNLOCK_ORDER).toHaveLength(12);
		expect(new Set(KEY_UNLOCK_ORDER).size).toBe(12);
	});

	it('all keys have defined prerequisites', () => {
		for (const key of KEY_UNLOCK_ORDER) {
			expect(KEY_UNLOCK_PREREQUISITES[key]).toBeDefined();
		}
	});
});

// ─── Scale Type Unlocks ────────────────────────────────────────

describe('scale type unlock system', () => {
	it('major-pentatonic is always unlocked', () => {
		const ctx = emptyContext();
		expect(isScaleTypeUnlocked('major-pentatonic', ctx)).toBe(true);
	});

	it('minor-pentatonic requires major-pentatonic at level 15', () => {
		const ctx = emptyContext();
		expect(isScaleTypeUnlocked('minor-pentatonic', ctx)).toBe(false);

		ctx.scaleProficiency['major-pentatonic'] = { level: 15 };
		expect(isScaleTypeUnlocked('minor-pentatonic', ctx)).toBe(true);
	});

	it('only major-pentatonic unlocked with empty context', () => {
		const ctx = emptyContext();
		const unlocked = getUnlockedScaleTypes(ctx);
		expect(unlocked).toEqual(['major-pentatonic']);
	});

	it('all scale types unlock with max proficiency', () => {
		const ctx = fullContext();
		const unlocked = getUnlockedScaleTypes(ctx);
		expect(unlocked).toHaveLength(SCALE_UNLOCK_ORDER.length);
	});

	it('melodic-minor has compound prerequisites (major + minor)', () => {
		const prereqs = SCALE_PREREQUISITES['melodic-minor'];
		expect(prereqs.length).toBe(2);

		// Must have both major and minor at required levels
		const ctx = emptyContext();
		ctx.scaleProficiency['major'] = { level: 30 };
		expect(isScaleTypeUnlocked('melodic-minor', ctx)).toBe(false); // missing minor

		ctx.scaleProficiency['minor'] = { level: 25 };
		expect(isScaleTypeUnlocked('melodic-minor', ctx)).toBe(true);
	});

	it('SCALE_UNLOCK_ORDER contains all defined types', () => {
		expect(SCALE_UNLOCK_ORDER).toHaveLength(12);
		expect(new Set(SCALE_UNLOCK_ORDER).size).toBe(12);
	});
});

// ─── Tonality Unlocks ──────────────────────────────────────────

describe('tonality unlock system', () => {
	it('C Major Pentatonic is the only unlocked tonality at start', () => {
		const ctx = emptyContext();
		const unlocked = getUnlockedTonalities(ctx);

		expect(unlocked).toHaveLength(1);
		expect(unlocked[0].key).toBe('C');
		expect(unlocked[0].scaleType).toBe('major-pentatonic');
	});

	it('isTonalityUnlocked checks both key and scale type', () => {
		const ctx = emptyContext();
		ctx.keyProficiency['C'] = { level: 10 };
		ctx.scaleProficiency['major-pentatonic'] = { level: 15 };

		// C + major-pentatonic: both unlocked
		expect(isTonalityUnlocked({ key: 'C', scaleType: 'major-pentatonic' }, ctx)).toBe(true);

		// G + major-pentatonic: G needs C at 10, which we have
		expect(isTonalityUnlocked({ key: 'G', scaleType: 'major-pentatonic' }, ctx)).toBe(true);

		// C + minor-pentatonic: minor-pent needs major-pent at 15, which we have
		expect(isTonalityUnlocked({ key: 'C', scaleType: 'minor-pentatonic' }, ctx)).toBe(true);
	});

	it('getAllTonalitiesWithUnlockInfo returns complete grid', () => {
		const ctx = emptyContext();
		const all = getAllTonalitiesWithUnlockInfo(ctx);

		// 12 scale types × 12 keys = 144 tonalities
		expect(all).toHaveLength(12 * 12);

		// Most should be locked at start
		const unlocked = all.filter(t => t.unlocked);
		expect(unlocked.length).toBeGreaterThanOrEqual(1);
		expect(unlocked.length).toBeLessThan(all.length);
	});

	it('all tonalities unlocked with max proficiency', () => {
		const ctx = fullContext();
		const unlocked = getUnlockedTonalities(ctx);

		expect(unlocked).toHaveLength(12 * 12);
	});
});

// ─── Daily Tonality Selection ──────────────────────────────────

describe('daily tonality selection', () => {
	it('returns deterministic result for same date + context', () => {
		const ctx = fullContext();

		const t1 = getDailyTonality('2024-06-15', ctx);
		const t2 = getDailyTonality('2024-06-15', ctx);

		expect(tonalitiesEqual(t1, t2)).toBe(true);
	});

	it('different dates may produce different tonalities', () => {
		const ctx = fullContext();

		const results = new Set<string>();
		for (let day = 1; day <= 30; day++) {
			const date = `2024-06-${String(day).padStart(2, '0')}`;
			const t = getDailyTonality(date, ctx);
			results.add(`${t.key}-${t.scaleType}`);
		}

		// With all tonalities unlocked, 30 days should hit multiple
		expect(results.size).toBeGreaterThan(1);
	});

	it('falls back to C Major Pentatonic with no unlocked tonalities', () => {
		// Edge case: empty context but getUnlockedTonalities returns
		// at least C Major Pentatonic since it has no prereqs
		const ctx = emptyContext();
		const t = getDailyTonality('2024-06-15', ctx);

		expect(t.key).toBe('C');
		expect(t.scaleType).toBe('major-pentatonic');
	});

	it('multi-day blocks for early levels (1-3 tonalities)', () => {
		const ctx = emptyContext();

		// Only 1 tonality unlocked → 3-day blocks
		const t1 = getDailyTonality('2024-06-15', ctx);
		const t2 = getDailyTonality('2024-06-16', ctx);
		const t3 = getDailyTonality('2024-06-17', ctx);

		// All should be the same (only 1 tonality)
		expect(tonalitiesEqual(t1, t2)).toBe(true);
		expect(tonalitiesEqual(t2, t3)).toBe(true);
	});

	it('accepts Date objects', () => {
		const ctx = fullContext();
		const date = new Date('2024-06-15T12:00:00Z');

		const t = getDailyTonality(date, ctx);
		expect(t.key).toBeDefined();
		expect(t.scaleType).toBeDefined();
	});
});

// ─── Scale Compatibility ───────────────────────────────────────

describe('scale compatibility filtering', () => {
	it('user-recorded licks are compatible with all scale types', () => {
		const lick = makeLick({ source: 'user' });
		const compatible = getCompatibleScaleTypes(lick);

		expect(compatible).toHaveLength(SCALE_UNLOCK_ORDER.length);
	});

	it('major.ionian licks are compatible with major, lydian, mixolydian, bebop', () => {
		// Use a non-progression category so scale-level mapping is used
		const lick = makeLick({
			category: 'pentatonic',
			harmony: [{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		});

		const compatible = getCompatibleScaleTypes(lick);

		expect(compatible).toContain('major');
		expect(compatible).toContain('lydian');
		expect(compatible).toContain('mixolydian');
		expect(compatible).toContain('bebop-dominant');
		expect(compatible).not.toContain('blues');
	});

	it('blues.minor licks are compatible with blues, minor-pent, dorian, minor', () => {
		const lick = makeLick({
			category: 'pentatonic',
			harmony: [{
				chord: { root: 'C', quality: '7' },
				scaleId: 'blues.minor',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		});

		const compatible = getCompatibleScaleTypes(lick);

		expect(compatible).toContain('blues');
		expect(compatible).toContain('minor-pentatonic');
		expect(compatible).toContain('dorian');
	});

	it('ii-V-I-major category uses broader compatibility', () => {
		const lick = makeLick({ category: 'ii-V-I-major' });

		const compatible = getCompatibleScaleTypes(lick);

		expect(compatible).toContain('major');
		expect(compatible).toContain('dorian');
		expect(compatible).toContain('mixolydian');
		expect(compatible).toContain('lydian');
	});

	it('isLickCompatible checks specific scale type', () => {
		const lick = makeLick({
			harmony: [{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		});

		expect(isLickCompatible(lick, 'major')).toBe(true);
		expect(isLickCompatible(lick, 'blues')).toBe(false);
	});

	it('pentatonic licks are compatible with parent modes', () => {
		const majorPentLick = makeLick({
			category: 'pentatonic',
			harmony: [{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'pentatonic.major',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		});

		const compatible = getCompatibleScaleTypes(majorPentLick);

		// Pentatonic is subset of major, lydian, mixolydian
		expect(compatible).toContain('major-pentatonic');
		expect(compatible).toContain('major');
		expect(compatible).toContain('lydian');
	});

	it('unknown scale ID falls back to all types', () => {
		// Use a non-progression category that isn't in CATEGORY_COMPATIBILITY
		const lick = makeLick({
			category: 'pentatonic',
			harmony: [{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'unknown.scale',
				startOffset: [0, 1],
				duration: [1, 1]
			}]
		});

		const compatible = getCompatibleScaleTypes(lick);
		expect(compatible).toHaveLength(SCALE_UNLOCK_ORDER.length);
	});
});

// ─── Display Helpers ───────────────────────────────────────────

describe('tonality display helpers', () => {
	it('formatTonality produces readable string', () => {
		expect(formatTonality({ key: 'C', scaleType: 'major' })).toBe('C Major');
		expect(formatTonality({ key: 'Bb', scaleType: 'blues' })).toBe('Bb Blues');
		expect(formatTonality({ key: 'D', scaleType: 'dorian' })).toBe('D Dorian');
	});

	it('tonalitiesEqual compares both key and scaleType', () => {
		const a: Tonality = { key: 'C', scaleType: 'major' };
		const b: Tonality = { key: 'C', scaleType: 'major' };
		const c: Tonality = { key: 'D', scaleType: 'major' };
		const d: Tonality = { key: 'C', scaleType: 'dorian' };

		expect(tonalitiesEqual(a, b)).toBe(true);
		expect(tonalitiesEqual(a, c)).toBe(false);
		expect(tonalitiesEqual(a, d)).toBe(false);
	});
});

// ─── Unlock Progression Integration ────────────────────────────

describe('unlock progression — full journey', () => {
	it('progressive proficiency unlocks more content', () => {
		const ctx = emptyContext();

		// Stage 1: Beginner — only C + major-pentatonic
		let keys = getUnlockedKeys(ctx);
		let scales = getUnlockedScaleTypes(ctx);
		expect(keys).toHaveLength(1);
		expect(scales).toHaveLength(1);

		// Stage 2: Gain C key proficiency → unlock G and F
		ctx.keyProficiency['C'] = { level: 10 };
		keys = getUnlockedKeys(ctx);
		expect(keys).toContain('G');
		expect(keys).toContain('F');

		// Stage 3: Gain major-pentatonic proficiency → unlock minor-pent + major
		ctx.scaleProficiency['major-pentatonic'] = { level: 15 };
		scales = getUnlockedScaleTypes(ctx);
		expect(scales).toContain('minor-pentatonic');
		expect(scales).toContain('major');

		// Stage 4: Gain minor-pentatonic → unlock blues + dorian
		ctx.scaleProficiency['minor-pentatonic'] = { level: 20 };
		scales = getUnlockedScaleTypes(ctx);
		expect(scales).toContain('blues');
		expect(scales).toContain('dorian');

		// Stage 5: Gain major + minor → eventually unlock melodic-minor
		ctx.scaleProficiency['major'] = { level: 30 };
		ctx.scaleProficiency['dorian'] = { level: 25 };
		ctx.scaleProficiency['minor'] = { level: 25 };
		scales = getUnlockedScaleTypes(ctx);
		expect(scales).toContain('melodic-minor');

		// More tonalities should be unlocked now
		const tonalities = getUnlockedTonalities(ctx);
		expect(tonalities.length).toBeGreaterThan(5);
	});
});
