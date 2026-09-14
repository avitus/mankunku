import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	createInitialScaleProficiency,
	createInitialKeyProficiency,
	processScaleAttempt,
	processKeyAttempt
} from '$lib/difficulty/adaptive';

describe('createInitialAdaptiveState', () => {
	// The ratchet that mutated this state (processAttempt) was retired
	// 2026-08-31; the initial shape is still pinned because the frozen
	// `progress.adaptive` field round-trips hydrate, merge, and cloud sync.
	it('starts at level 1 with empty scores', () => {
		const state = createInitialAdaptiveState();
		expect(state.currentLevel).toBe(1);
		expect(state.pitchComplexity).toBe(1);
		expect(state.rhythmComplexity).toBe(1);
		expect(state.recentScores).toEqual([]);
		expect(state.recentPitchScores).toEqual([]);
		expect(state.recentRhythmScores).toEqual([]);
		expect(state.pitchAttemptsSinceChange).toBe(0);
		expect(state.rhythmAttemptsSinceChange).toBe(0);
	});
});

describe('processScaleAttempt', () => {
	it('increments totalAttempts', () => {
		let state = createInitialScaleProficiency();
		state = processScaleAttempt(state, 0.9);
		expect(state.totalAttempts).toBe(1);
	});

	it('advances on exactly the 10th qualifying attempt, not the 9th', () => {
		let state = createInitialScaleProficiency();
		for (let i = 0; i < 9; i++) {
			state = processScaleAttempt(state, 0.95);
		}
		expect(state.level).toBe(1);
		state = processScaleAttempt(state, 0.95);
		expect(state.level).toBe(2);
		// A level change restarts the cooldown counters.
		expect(state.attemptsSinceChange).toBe(0);
		expect(state.attemptsAtLevel).toBe(0);
	});

	it('never retreats below level 1, however bad the run', () => {
		let state = createInitialScaleProficiency();
		for (let i = 0; i < 40; i++) {
			state = processScaleAttempt(state, 0.1);
		}
		expect(state.level).toBe(1);
	});

	it('never advances past level 100', () => {
		let state = { ...createInitialScaleProficiency(), level: 100 };
		for (let i = 0; i < 20; i++) {
			state = processScaleAttempt(state, 1.0);
		}
		expect(state.level).toBe(100);
	});

	it('keeps a rolling window of the last 25 scores', () => {
		let state = createInitialScaleProficiency();
		for (let i = 0; i < 30; i++) {
			state = processScaleAttempt(state, i / 100);
		}
		expect(state.recentScores).toHaveLength(25);
		expect(state.recentScores[0]).toBeCloseTo(0.05, 9);
		expect(state.recentScores[24]).toBeCloseTo(0.29, 9);
	});

	it('retreats after sustained low scores', () => {
		let state = createInitialScaleProficiency();
		for (let i = 0; i < 11; i++) {
			state = processScaleAttempt(state, 0.95);
		}
		const levelBefore = state.level;
		for (let i = 0; i < 30; i++) {
			state = processScaleAttempt(state, 0.3);
		}
		expect(state.level).toBeLessThan(levelBefore);
	});
});

describe('processKeyAttempt', () => {
	it('uses same algorithm as scale proficiency', () => {
		let state = createInitialKeyProficiency();
		for (let i = 0; i < 11; i++) {
			state = processKeyAttempt(state, 0.95);
		}
		expect(state.level).toBeGreaterThan(1);
		expect(state.totalAttempts).toBe(11);
	});
});
