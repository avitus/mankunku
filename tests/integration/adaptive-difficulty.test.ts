/**
 * Integration tests for the adaptive difficulty system: scale/key
 * proficiency tracking (the live engine that gates content and unlocks),
 * plus the level→tier profile mapping and difficulty display bands.
 *
 * The global pitch/rhythm complexity ratchet (`processAttempt`) was retired
 * 2026-08-31 — nothing consumed its output. Only the frozen initial-state
 * shape is still pinned, because `progress.adaptive` round-trips sync.
 */

import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	createInitialScaleProficiency,
	createInitialKeyProficiency,
	processScaleAttempt,
	processKeyAttempt
} from '../../src/lib/difficulty/adaptive';
import { getProfileForTier, levelToContentTier, DIFFICULTY_PROFILES } from '../../src/lib/difficulty/params';
import { difficultyBand, difficultyDisplay } from '../../src/lib/difficulty/display';

// ─── Initial State ─────────────────────────────────────────────

describe('adaptive difficulty — initial state', () => {
	it('creates initial state at level 1', () => {
		const state = createInitialAdaptiveState();

		expect(state.currentLevel).toBe(1);
		expect(state.pitchComplexity).toBe(1);
		expect(state.rhythmComplexity).toBe(1);
		expect(state.recentScores).toEqual([]);
		expect(state.recentPitchScores).toEqual([]);
		expect(state.recentRhythmScores).toEqual([]);
		expect(state.attemptsAtLevel).toBe(0);
		expect(state.attemptsSinceChange).toBe(0);
		expect(state.pitchAttemptsSinceChange).toBe(0);
		expect(state.rhythmAttemptsSinceChange).toBe(0);
	});

	it('creates initial scale proficiency at level 1', () => {
		const prof = createInitialScaleProficiency();

		expect(prof.level).toBe(1);
		expect(prof.recentScores).toEqual([]);
		expect(prof.totalAttempts).toBe(0);
	});

	it('creates initial key proficiency at level 1', () => {
		const prof = createInitialKeyProficiency();

		expect(prof.level).toBe(1);
		expect(prof.recentScores).toEqual([]);
		expect(prof.totalAttempts).toBe(0);
	});
});

// ─── Scale Proficiency ─────────────────────────────────────────

describe('scale proficiency tracking', () => {
	it('advances scale proficiency with consistently high scores', () => {
		let prof = createInitialScaleProficiency();

		for (let i = 0; i < 11; i++) {
			prof = processScaleAttempt(prof, 0.95);
		}

		expect(prof.level).toBe(2);
		expect(prof.totalAttempts).toBe(11);
	});

	it('retreats scale proficiency with consistently low scores', () => {
		let prof = createInitialScaleProficiency();
		prof = { ...prof, level: 5, attemptsSinceChange: 0 };

		for (let i = 0; i < 11; i++) {
			prof = processScaleAttempt(prof, 0.3);
		}

		expect(prof.level).toBeLessThan(5);
	});

	it('tracks totalAttempts across level changes', () => {
		let prof = createInitialScaleProficiency();

		for (let i = 0; i < 20; i++) {
			prof = processScaleAttempt(prof, 0.7);
		}

		expect(prof.totalAttempts).toBe(20);
	});
});

// ─── Key Proficiency ───────────────────────────────────────────

describe('key proficiency tracking', () => {
	it('advances key proficiency with consistently high scores', () => {
		let prof = createInitialKeyProficiency();

		for (let i = 0; i < 11; i++) {
			prof = processKeyAttempt(prof, 0.95);
		}

		expect(prof.level).toBe(2);
	});

	it('maintains separate tracking per key', () => {
		let cProf = createInitialKeyProficiency();
		let gProf = createInitialKeyProficiency();

		for (let i = 0; i < 11; i++) {
			cProf = processKeyAttempt(cProf, 0.95);
		}

		for (let i = 0; i < 11; i++) {
			gProf = processKeyAttempt(gProf, 0.4);
		}

		expect(cProf.level).toBeGreaterThan(gProf.level);
	});
});

// ─── Difficulty Profile Mapping ────────────────────────────────

describe('difficulty profile mapping', () => {
	it('maps player levels 1-100 to content tiers 1-10', () => {
		expect(levelToContentTier(1)).toBe(1);
		expect(levelToContentTier(5)).toBe(1);
		expect(levelToContentTier(6)).toBe(2);
		expect(levelToContentTier(50)).toBe(6);
		expect(levelToContentTier(91)).toBe(10);
		expect(levelToContentTier(100)).toBe(10);
	});

	it('getProfileForTier returns valid profiles for all tiers', () => {
		for (let tier = 1; tier <= 10; tier++) {
			const profile = getProfileForTier(tier);
			expect(profile.level).toBe(tier);
			expect(profile.scaleTypes.length).toBeGreaterThan(0);
			expect(profile.keys.length).toBeGreaterThan(0);
			expect(profile.rhythmTypes.length).toBeGreaterThan(0);
		}
	});

	it('higher tiers unlock more musical content', () => {
		const tier1 = getProfileForTier(1);
		const tier10 = getProfileForTier(10);

		expect(tier10.scaleTypes.length).toBeGreaterThan(tier1.scaleTypes.length);
		expect(tier10.keys.length).toBeGreaterThanOrEqual(tier1.keys.length);
		expect(tier10.maxInterval).toBeGreaterThan(tier1.maxInterval);
		expect(tier10.tempoRange[1]).toBeGreaterThan(tier1.tempoRange[1]);
	});

	it('all 10 difficulty profiles are defined', () => {
		expect(DIFFICULTY_PROFILES).toHaveLength(10);
	});
});

// ─── Difficulty Display ────────────────────────────────────────

describe('difficulty display', () => {
	it('maps levels to correct bands', () => {
		expect(difficultyBand(1)).toBe(1);
		expect(difficultyBand(10)).toBe(1);
		expect(difficultyBand(11)).toBe(2);
		expect(difficultyBand(50)).toBe(5);
		expect(difficultyBand(100)).toBe(10);
	});

	it('clamps out-of-range values', () => {
		expect(difficultyBand(0)).toBe(1);
		expect(difficultyBand(101)).toBe(10);
	});

	it('returns display info with all fields', () => {
		const display = difficultyDisplay(50);

		expect(display.band).toBe(5);
		expect(display.label).toBe('41-50');
		expect(display.color).toBeTruthy();
		expect(display.name).toBeTruthy();
	});
});
