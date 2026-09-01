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
	it('starts at level 1', () => {
		const state = createInitialScaleProficiency();
		expect(state.level).toBe(1);
		expect(state.totalAttempts).toBe(0);
	});

	it('increments totalAttempts', () => {
		let state = createInitialScaleProficiency();
		state = processScaleAttempt(state, 0.9);
		expect(state.totalAttempts).toBe(1);
	});

	it('advances after sustained high scores', () => {
		let state = createInitialScaleProficiency();
		for (let i = 0; i < 11; i++) {
			state = processScaleAttempt(state, 0.95);
		}
		expect(state.level).toBeGreaterThan(1);
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
