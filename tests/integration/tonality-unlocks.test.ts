/**
 * Integration tests for the tonality system and unlock mechanics.
 *
 * Tests daily tonality selection, scale/key unlock prerequisites,
 * scale compatibility filtering, and the interaction between
 * proficiency levels and available content.
 *
 * The per-function unit pins live in tests/unit/tonality/; this file keeps
 * only the cross-function properties (the full unlock grid, the cross-product
 * of keys and scales, the end-to-end proficiency journey).
 */

import { describe, it, expect } from 'vitest';
import {
	getDailyTonality,
	getUnlockedKeys,
	getUnlockedScaleTypes,
	getUnlockedTonalities,
	isTonalityUnlocked,
	getAllTonalitiesWithUnlockInfo,
	tonalitiesEqual,
	KEY_UNLOCK_ORDER,
	SCALE_UNLOCK_ORDER,
	type Tonality
} from '../../src/lib/tonality/tonality';
import { getCompatibleScaleTypes } from '../../src/lib/tonality/scale-compatibility';
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
	it('KEY_UNLOCK_ORDER contains all 12 keys', () => {
		expect(KEY_UNLOCK_ORDER).toHaveLength(12);
		expect(new Set(KEY_UNLOCK_ORDER).size).toBe(12);
	});
});

// ─── Scale Type Unlocks ────────────────────────────────────────

describe('scale type unlock system', () => {
	it('SCALE_UNLOCK_ORDER contains all defined types', () => {
		expect(SCALE_UNLOCK_ORDER).toHaveLength(12);
		expect(new Set(SCALE_UNLOCK_ORDER).size).toBe(12);
	});
});

// ─── Tonality Unlocks ──────────────────────────────────────────

describe('tonality unlock system', () => {
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

		// Exactly the one prerequisite-free tonality is unlocked at start; the
		// grid keeps every locked one so the UI can show it as locked.
		const unlocked = all.filter(t => t.unlocked);
		expect(unlocked.map(t => t.tonality)).toEqual([{ key: 'C', scaleType: 'major-pentatonic' }]);
		expect(all.filter(t => !t.unlocked)).toHaveLength(143);
	});

	it('all tonalities unlocked with max proficiency', () => {
		const ctx = fullContext();
		const unlocked = getUnlockedTonalities(ctx);

		expect(unlocked).toHaveLength(12 * 12);
	});
});

// ─── Daily Tonality Selection ──────────────────────────────────

describe('daily tonality selection', () => {
	it('accepts Date objects and resolves them to the same day as the ISO string', () => {
		const ctx = fullContext();
		// Noon UTC is the same calendar day in every zone within ±12 h, so the
		// Date arm must land on the string arm's tonality — a timezone slip in
		// the day conversion would pick the neighbouring day's hash.
		const date = new Date('2024-06-15T12:00:00Z');

		const t = getDailyTonality(date, ctx);
		expect(tonalitiesEqual(t, getDailyTonality('2024-06-15', ctx))).toBe(true);
	});
});

// ─── Scale Compatibility ───────────────────────────────────────

describe('scale compatibility filtering', () => {
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
});

// ─── Display Helpers ───────────────────────────────────────────

describe('tonality display helpers', () => {
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
