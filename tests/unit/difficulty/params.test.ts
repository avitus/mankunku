import { describe, it, expect } from 'vitest';
import {
	getProfileForLevel,
	getProfileForTier,
	levelToContentTier,
	noteCountFloorLevel,
	DIFFICULTY_PROFILES
} from '$lib/difficulty/params';

/**
 * The player-facing level scale (1-100) must map into content tiers
 * monotonically over its WHOLE range. The bug this pins: a single
 * `getProfile(n)` that read `n <= 10` as a content tier and `n > 10` as a
 * player level inverted the bottom tenth of the settings slider — dragging
 * "Difficulty" to 10, visually at the Beginner end of a 1-100 track, selected
 * tier 10 ("No Limits"), the hardest content in the app.
 */
describe('player level → profile', () => {
	it('level 10 is beginner content, not the top tier', () => {
		const profile = getProfileForLevel(10);
		expect(profile.level).toBe(levelToContentTier(10)); // tier 2
		expect(profile.name).toBe('Full Pentatonic');
		expect(profile.maxNotes).toBeLessThan(Number.POSITIVE_INFINITY);
	});

	it('names the content each slider position selects', () => {
		expect(getProfileForLevel(1).name).toBe('Roots & 5ths');      // tier 1
		expect(getProfileForLevel(15).name).toBe('Swing 8ths');       // tier 3
		expect(getProfileForLevel(50).name).toBe('Enclosures');       // tier 6
		expect(getProfileForLevel(70).name).toBe('Altered Harmony');  // tier 8
		expect(getProfileForLevel(100).name).toBe('No Limits');       // tier 10
	});

	it('the bottom of the slider stays in the bottom tiers', () => {
		for (let level = 1; level <= 10; level++) {
			expect(getProfileForLevel(level).level).toBeLessThanOrEqual(2);
		}
	});

	it('tier never decreases as the level rises', () => {
		let prev = 0;
		for (let level = 1; level <= 100; level++) {
			const tier = getProfileForLevel(level).level;
			expect(tier, `level ${level}`).toBeGreaterThanOrEqual(prev);
			prev = tier;
		}
	});

	it('has no discontinuity at the old 10/11 heuristic boundary', () => {
		const at10 = getProfileForLevel(10).level;
		const at11 = getProfileForLevel(11).level;
		expect(at11 - at10).toBeLessThanOrEqual(1);
		expect(at11).toBeGreaterThanOrEqual(at10);
	});

	it('agrees with levelToContentTier at every level', () => {
		for (let level = 1; level <= 100; level++) {
			expect(getProfileForLevel(level).level, `level ${level}`).toBe(levelToContentTier(level));
		}
	});

	it('clamps out-of-range levels instead of throwing', () => {
		expect(getProfileForLevel(0).level).toBe(1);
		expect(getProfileForLevel(-5).level).toBe(1);
		expect(getProfileForLevel(500).level).toBe(10);
	});
});

describe('content tier → profile', () => {
	it('returns the profile whose level is that tier', () => {
		for (let tier = 1; tier <= 10; tier++) {
			expect(getProfileForTier(tier).level).toBe(tier);
		}
	});

	it('names the tier it returns', () => {
		expect(getProfileForTier(1).name).toBe('Roots & 5ths');
		expect(getProfileForTier(7).name).toBe('Bebop Lines');
		expect(getProfileForTier(10).name).toBe('No Limits');
	});

	it('rejects values outside 1-10 rather than guessing', () => {
		expect(() => getProfileForTier(0)).toThrow();
		expect(() => getProfileForTier(11)).toThrow();
		expect(() => getProfileForTier(50)).toThrow();
		expect(() => getProfileForTier(2.5)).toThrow();
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

/**
 * Phrase LENGTH is a difficulty dimension in its own right: playing back a
 * 13-note line by ear is a memory task a beginner cannot do, however diatonic
 * and slow the notes are. Each content tier therefore declares how many notes
 * it admits, and every level-gated pool is expected to honour it.
 */
describe('note-count ceilings', () => {
	it('every tier declares a maxNotes', () => {
		for (const profile of DIFFICULTY_PROFILES) {
			expect(profile.maxNotes).toBeGreaterThan(0);
		}
	});

	it('maxNotes never decreases as tiers rise', () => {
		const sorted = [...DIFFICULTY_PROFILES].sort((a, b) => a.level - b.level);
		for (let i = 1; i < sorted.length; i++) {
			expect(sorted[i].maxNotes).toBeGreaterThanOrEqual(sorted[i - 1].maxNotes);
		}
	});

	it('the top tier admits phrases of any length', () => {
		expect(getProfileForTier(10).maxNotes).toBe(Number.POSITIVE_INFINITY);
	});

	it('floor level lands in a tier that actually admits that many notes', () => {
		for (let count = 1; count <= 40; count++) {
			const level = noteCountFloorLevel(count);
			expect(level).toBeGreaterThanOrEqual(1);
			expect(level).toBeLessThanOrEqual(100);
			expect(getProfileForLevel(level).maxNotes).toBeGreaterThanOrEqual(count);
		}
	});

	it('floor level is the LOWEST level admitting that many notes', () => {
		// `noteCountFloorLevel` returns a player level, so resolving it has to go
		// through the level-taking lookup. Under the old magnitude heuristic the
		// tier-2 floor (level 6) resolved to tier 6, which made this "floor"
		// property silently false for 6- and 7-note lines.
		for (let count = 1; count <= 40; count++) {
			const level = noteCountFloorLevel(count);
			if (level === 1) continue;
			expect(getProfileForLevel(level).maxNotes, `count ${count}`).toBeGreaterThanOrEqual(count);
			expect(getProfileForLevel(level - 1).maxNotes, `count ${count}`).toBeLessThan(count);
		}
	});

	it('floor level is the first level of its tier', () => {
		for (let count = 1; count <= 40; count++) {
			const level = noteCountFloorLevel(count);
			if (level === 1) continue;
			expect(levelToContentTier(level - 1)).toBe(levelToContentTier(level) - 1);
		}
	});

	it('floor level rises monotonically with note count', () => {
		let prev = 0;
		for (let count = 1; count <= 40; count++) {
			const level = noteCountFloorLevel(count);
			expect(level).toBeGreaterThanOrEqual(prev);
			prev = level;
		}
	});

	it('a 13-note line is not beginner content', () => {
		// The reported bug: a 13-note major-scale line served at proficiency 20.
		expect(noteCountFloorLevel(13)).toBeGreaterThan(20);
	});

	it('short cells stay available to beginners', () => {
		expect(noteCountFloorLevel(2)).toBe(1);
		expect(noteCountFloorLevel(4)).toBe(1);
	});

	it('treats non-positive counts as beginner content', () => {
		expect(noteCountFloorLevel(0)).toBe(1);
		expect(noteCountFloorLevel(-3)).toBe(1);
	});
});
