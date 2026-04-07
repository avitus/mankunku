/**
 * Integration tests for the adaptive difficulty system.
 *
 * Tests the full loop: score → processAttempt → state update → level
 * advancement/retreat, scale/key proficiency tracking,
 * and the interaction between scoring results and difficulty adjustment.
 */

import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	processAttempt,
	createInitialScaleProficiency,
	createInitialKeyProficiency,
	processScaleAttempt,
	processKeyAttempt,
	getAdaptiveSummary
} from '../../src/lib/difficulty/adaptive';
import { getProfile, levelToContentTier, DIFFICULTY_PROFILES } from '../../src/lib/difficulty/params';
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

// ─── Score Window ──────────────────────────────────────────────

describe('adaptive difficulty — score window', () => {
	it('accumulates scores in all three windows', () => {
		let state = createInitialAdaptiveState();

		state = processAttempt(state, 0.72, 0.8, 0.6);
		expect(state.recentScores).toHaveLength(1);
		expect(state.recentPitchScores).toHaveLength(1);
		expect(state.recentRhythmScores).toHaveLength(1);

		state = processAttempt(state, 0.82, 0.9, 0.7);
		expect(state.recentScores).toHaveLength(2);
		expect(state.recentPitchScores).toHaveLength(2);
		expect(state.recentRhythmScores).toHaveLength(2);
	});

	it('caps window at 25 scores', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 30; i++) {
			state = processAttempt(state, 0.72, 0.8, 0.6);
		}

		expect(state.recentScores).toHaveLength(25);
		expect(state.recentPitchScores).toHaveLength(25);
		expect(state.recentRhythmScores).toHaveLength(25);
	});

	it('oldest score is removed when window is full', () => {
		let state = createInitialAdaptiveState();

		// Fill with 0.5 scores
		for (let i = 0; i < 25; i++) {
			state = processAttempt(state, 0.5, 0.5, 0.5);
		}

		// Add a 0.9 score
		state = processAttempt(state, 0.9, 0.9, 0.9);

		// Window should contain twenty-four 0.5s and one 0.9
		expect(state.recentScores).toHaveLength(25);
		expect(state.recentScores[24]).toBe(0.9);
		expect(state.recentScores[0]).toBe(0.5);

		expect(state.recentPitchScores).toHaveLength(25);
		expect(state.recentPitchScores[24]).toBe(0.9);
		expect(state.recentPitchScores[0]).toBe(0.5);

		expect(state.recentRhythmScores).toHaveLength(25);
		expect(state.recentRhythmScores[24]).toBe(0.9);
		expect(state.recentRhythmScores[0]).toBe(0.5);
	});
});

// ─── Level Advancement ─────────────────────────────────────────

describe('adaptive difficulty — level advancement', () => {
	it('advances when both dimensions average > 85% with enough attempts', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95);
		}

		expect(state.currentLevel).toBeGreaterThan(1);
		expect(state.pitchComplexity).toBeGreaterThan(1);
		expect(state.rhythmComplexity).toBeGreaterThan(1);
	});

	it('does NOT advance before minimum 10 attempts', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 9; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95);
		}

		expect(state.currentLevel).toBe(1);
	});

	it('advances pitch independently when only pitch scores are high', () => {
		let state = createInitialAdaptiveState();

		// High pitch, mediocre rhythm
		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.81, 0.95, 0.60);
		}

		expect(state.pitchComplexity).toBeGreaterThan(1);
		expect(state.rhythmComplexity).toBe(1);
	});

	it('advances rhythm independently when only rhythm scores are high', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.74, 0.60, 0.95);
		}

		expect(state.rhythmComplexity).toBeGreaterThan(1);
		expect(state.pitchComplexity).toBe(1);
	});

	it('retreats only the weak dimension', () => {
		let state = createInitialAdaptiveState();
		state = {
			...state,
			currentLevel: 5,
			pitchComplexity: 5,
			rhythmComplexity: 5,
		};

		// Low pitch accuracy, decent rhythm (overall = 0.2*0.6 + 0.7*0.4 = 0.40)
		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.40, 0.2, 0.7);
		}

		expect(state.pitchComplexity).toBeLessThan(5);
		expect(state.rhythmComplexity).toBe(5);
	});

	it('stays stable in the 50-85% range', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 10; i++) {
			state = processAttempt(state, 0.7, 0.7, 0.7);
		}

		expect(state.currentLevel).toBe(1);
	});

	it('dimensions can diverge significantly over many attempts', () => {
		let state = createInitialAdaptiveState();

		// 50 attempts with great pitch, mediocre rhythm
		for (let i = 0; i < 50; i++) {
			state = processAttempt(state, 0.81, 0.95, 0.60);
		}

		expect(state.pitchComplexity).toBeGreaterThan(3);
		expect(state.rhythmComplexity).toBe(1);
		expect(state.currentLevel).toBe(
			Math.round((state.pitchComplexity + state.rhythmComplexity) / 2)
		);
	});

	it('resets only the advancing dimension cooldown', () => {
		let state = createInitialAdaptiveState();

		// High pitch, mediocre rhythm (overall = 0.95*0.6 + 0.60*0.4 = 0.81)
		// Advance fires on attempt 10 (cooldown hits 10), resetting pitch cooldown to 0
		for (let i = 0; i < 10; i++) {
			state = processAttempt(state, 0.81, 0.95, 0.60);
		}

		expect(state.pitchComplexity).toBeGreaterThan(1);
		expect(state.pitchAttemptsSinceChange).toBe(0);
		// Rhythm never changed, cooldown keeps counting
		expect(state.rhythmComplexity).toBe(1);
		expect(state.rhythmAttemptsSinceChange).toBe(10);
	});

	it('resets per-dimension cooldown after a level change', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 10; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95);
		}

		// Both advanced and reset their cooldowns
		expect(state.currentLevel).toBeGreaterThan(1);
		expect(state.pitchAttemptsSinceChange).toBe(0);
		expect(state.rhythmAttemptsSinceChange).toBe(0);

		// One more attempt — cooldowns are 1
		state = processAttempt(state, 0.95, 0.95, 0.95);
		expect(state.pitchAttemptsSinceChange).toBe(1);
		expect(state.rhythmAttemptsSinceChange).toBe(1);
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

		// Simulate C key: high scores → advance
		for (let i = 0; i < 11; i++) {
			cProf = processKeyAttempt(cProf, 0.95);
		}

		// G key stays low
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

	it('getProfile returns valid profiles for all tiers', () => {
		for (let tier = 1; tier <= 10; tier++) {
			const profile = getProfile(tier);
			expect(profile.level).toBe(tier);
			expect(profile.scaleTypes.length).toBeGreaterThan(0);
			expect(profile.keys.length).toBeGreaterThan(0);
			expect(profile.rhythmTypes.length).toBeGreaterThan(0);
		}
	});

	it('higher tiers unlock more musical content', () => {
		const tier1 = getProfile(1);
		const tier10 = getProfile(10);

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

// ─── Full Session Loop ─────────────────────────────────────────

describe('full session → adaptive state loop', () => {
	it('simulates multiple sessions progressing through levels', () => {
		let state = createInitialAdaptiveState();
		// Simulate 50 practice sessions with improving scores
		for (let i = 0; i < 50; i++) {
			// Score improves over time: 0.7 → 0.95
			const progress = i / 50;
			const overall = 0.7 + progress * 0.25;

			state = processAttempt(state, overall, overall, overall);
		}

		// After consistently high scores, level should have advanced
		expect(state.currentLevel).toBeGreaterThan(1);
		expect(state.recentScores).toHaveLength(25);
		expect(state.recentPitchScores).toHaveLength(25);
		expect(state.recentRhythmScores).toHaveLength(25);
	});

	it('getAdaptiveSummary returns human-readable text', () => {
		let state = createInitialAdaptiveState();
		state = processAttempt(state, 0.85, 0.9, 0.8);

		const summary = getAdaptiveSummary(state);
		expect(typeof summary).toBe('string');
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain('Pitch');
		expect(summary).toContain('Rhythm');
	});
});
