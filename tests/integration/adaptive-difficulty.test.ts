/**
 * Integration tests for the adaptive difficulty system.
 *
 * Tests the full loop: score → processAttempt → state update → level
 * advancement/retreat, XP progression, scale/key proficiency tracking,
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
	xpForLevel,
	xpToDisplayLevel,
	xpProgress,
	totalXpForLevel,
	getAdaptiveSummary
} from '../../src/lib/difficulty/adaptive';
import { getProfile, levelToContentTier, DIFFICULTY_PROFILES } from '../../src/lib/difficulty/params';
import { scoreToGrade } from '../../src/lib/scoring/grades';
import { difficultyBand, difficultyDisplay } from '../../src/lib/difficulty/display';

// ─── Initial State ─────────────────────────────────────────────

describe('adaptive difficulty — initial state', () => {
	it('creates initial state at level 1 with zero XP', () => {
		const state = createInitialAdaptiveState();

		expect(state.currentLevel).toBe(1);
		expect(state.pitchComplexity).toBe(1);
		expect(state.rhythmComplexity).toBe(1);
		expect(state.recentScores).toEqual([]);
		expect(state.attemptsAtLevel).toBe(0);
		expect(state.attemptsSinceChange).toBe(0);
		expect(state.xp).toBe(0);
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
	it('accumulates scores in the recent scores window', () => {
		let state = createInitialAdaptiveState();

		state = processAttempt(state, 0.7, 0.8, 0.6, 'good');
		expect(state.recentScores).toHaveLength(1);

		state = processAttempt(state, 0.8, 0.9, 0.7, 'good');
		expect(state.recentScores).toHaveLength(2);
	});

	it('caps window at 25 scores', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 30; i++) {
			state = processAttempt(state, 0.7, 0.8, 0.6, 'good');
		}

		expect(state.recentScores).toHaveLength(25);
	});

	it('oldest score is removed when window is full', () => {
		let state = createInitialAdaptiveState();

		// Fill with 0.5 scores
		for (let i = 0; i < 25; i++) {
			state = processAttempt(state, 0.5, 0.5, 0.5, 'fair');
		}

		// Add a 0.9 score
		state = processAttempt(state, 0.9, 0.9, 0.9, 'great');

		// Window should contain twenty-four 0.5s and one 0.9
		expect(state.recentScores).toHaveLength(25);
		expect(state.recentScores[24]).toBe(0.9);
		expect(state.recentScores[0]).toBe(0.5);
	});
});

// ─── Level Advancement ─────────────────────────────────────────

describe('adaptive difficulty — level advancement', () => {
	it('advances when average > 85% with enough attempts', () => {
		let state = createInitialAdaptiveState();

		// Submit 10+ high scores (minimum before change)
		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95, 'perfect');
		}

		expect(state.currentLevel).toBeGreaterThan(1);
	});

	it('does NOT advance before minimum 10 attempts', () => {
		let state = createInitialAdaptiveState();

		// Only 9 attempts — one short of minimum 10
		for (let i = 0; i < 9; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95, 'perfect');
		}

		expect(state.currentLevel).toBe(1);
	});

	it('advances weakest parameter first (pitch vs rhythm)', () => {
		let state = createInitialAdaptiveState();
		// Manually set pitch lower than rhythm
		state = { ...state, pitchComplexity: 2, rhythmComplexity: 5, currentLevel: 5 };

		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95, 'perfect');
		}

		// Pitch was weaker, so it should have been incremented
		expect(state.pitchComplexity).toBeGreaterThan(2);
	});

	it('retreats when average < 50% with enough attempts', () => {
		let state = createInitialAdaptiveState();
		// Set pitch as the sole max contributor (rhythm is lower)
		// so retreating pitch will actually lower currentLevel.
		// pitchAccuracy (0.2) < rhythmAccuracy (0.4) → pitch gets retreated.
		state = {
			...state,
			currentLevel: 5,
			pitchComplexity: 5,
			rhythmComplexity: 3,
			attemptsSinceChange: 9,
			recentScores: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]
		};

		state = processAttempt(state, 0.3, 0.2, 0.4, 'try-again');

		// pitchComplexity 5→4, currentLevel = max(4, 3) = 4
		expect(state.currentLevel).toBe(4);
		expect(state.pitchComplexity).toBe(4);
	});

	it('stays stable in the 50-85% range', () => {
		let state = createInitialAdaptiveState();

		for (let i = 0; i < 10; i++) {
			state = processAttempt(state, 0.7, 0.7, 0.7, 'good');
		}

		// Should still be at level 1 — not enough to advance
		expect(state.currentLevel).toBe(1);
	});

	it('retreats the parameter causing more errors', () => {
		let state = createInitialAdaptiveState();
		state = { ...state, currentLevel: 5, pitchComplexity: 5, rhythmComplexity: 5, attemptsSinceChange: 9 };

		// Low pitch accuracy, decent rhythm → should retreat pitch
		for (let i = 0; i < 11; i++) {
			state = processAttempt(state, 0.3, 0.2, 0.5, 'try-again');
		}

		expect(state.pitchComplexity).toBeLessThan(5);
	});

	it('resets attemptsSinceChange after a level change', () => {
		let state = createInitialAdaptiveState();

		// Submit exactly 10 high scores — should trigger advance on 10th
		for (let i = 0; i < 10; i++) {
			state = processAttempt(state, 0.95, 0.95, 0.95, 'perfect');
		}

		// Must have advanced and reset the counter
		expect(state.currentLevel).toBeGreaterThan(1);
		expect(state.attemptsSinceChange).toBe(0);

		// One more attempt — now attemptsSinceChange is 1
		state = processAttempt(state, 0.95, 0.95, 0.95, 'perfect');
		expect(state.attemptsSinceChange).toBe(1);
	});
});

// ─── XP System ─────────────────────────────────────────────────

describe('adaptive difficulty — XP system', () => {
	it('awards XP based on grade', () => {
		let state = createInitialAdaptiveState();

		state = processAttempt(state, 0.96, 0.96, 0.96, 'perfect');
		expect(state.xp).toBe(100);

		state = processAttempt(state, 0.86, 0.86, 0.86, 'great');
		expect(state.xp).toBe(175); // 100 + 75

		state = processAttempt(state, 0.72, 0.72, 0.72, 'good');
		expect(state.xp).toBe(225); // 175 + 50

		state = processAttempt(state, 0.56, 0.56, 0.56, 'fair');
		expect(state.xp).toBe(250); // 225 + 25

		state = processAttempt(state, 0.3, 0.3, 0.3, 'try-again');
		expect(state.xp).toBe(260); // 250 + 10
	});

	it('xpForLevel returns increasing values', () => {
		let prev = 0;
		for (let level = 1; level <= 100; level++) {
			const xp = xpForLevel(level);
			expect(xp).toBeGreaterThan(prev);
			prev = xp;
		}
	});

	it('xpToDisplayLevel starts at 1 with 0 XP', () => {
		expect(xpToDisplayLevel(0)).toBe(1);
	});

	it('xpToDisplayLevel increases with accumulated XP', () => {
		const level1Xp = xpForLevel(1);
		expect(xpToDisplayLevel(level1Xp)).toBe(2);

		const level2Xp = level1Xp + xpForLevel(2);
		expect(xpToDisplayLevel(level2Xp)).toBe(3);
	});

	it('xpProgress returns 0-1 within current level', () => {
		expect(xpProgress(0)).toBeCloseTo(0);

		const halfLevel1 = xpForLevel(1) / 2;
		const progress = xpProgress(halfLevel1);
		expect(progress).toBeGreaterThan(0);
		expect(progress).toBeLessThan(1);
	});

	it('totalXpForLevel is sum of all prior level requirements', () => {
		let sum = 0;
		for (let i = 1; i < 5; i++) {
			sum += xpForLevel(i);
		}
		expect(totalXpForLevel(5)).toBe(sum);
	});

	it('xpToDisplayLevel caps at 100', () => {
		expect(xpToDisplayLevel(999999999)).toBe(100);
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
		const grades: string[] = [];

		// Simulate 50 practice sessions with improving scores
		for (let i = 0; i < 50; i++) {
			// Score improves over time: 0.7 → 0.95
			const progress = i / 50;
			const overall = 0.7 + progress * 0.25;
			const grade = scoreToGrade(overall);
			grades.push(grade);

			state = processAttempt(state, overall, overall, overall, grade);
		}

		// After consistently high scores, level should have advanced
		expect(state.currentLevel).toBeGreaterThan(1);
		expect(state.xp).toBeGreaterThan(0);
		expect(state.recentScores).toHaveLength(25);
	});

	it('getAdaptiveSummary returns human-readable text', () => {
		let state = createInitialAdaptiveState();
		state = processAttempt(state, 0.85, 0.9, 0.8, 'great');

		const summary = getAdaptiveSummary(state);
		expect(typeof summary).toBe('string');
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain('Pitch');
		expect(summary).toContain('Rhythm');
	});
});
