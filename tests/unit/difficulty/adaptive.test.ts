import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	processAttempt,
	getAdaptiveSummary,
	createInitialScaleProficiency,
	createInitialKeyProficiency,
	processScaleAttempt,
	processKeyAttempt,
	WINDOW_SIZE
} from '$lib/difficulty/adaptive.ts';
import type { AdaptiveState } from '$lib/types/progress.ts';

/** Feed N attempts with the same score for all dimensions. */
function feedAttempts(count: number, score: number): AdaptiveState {
	let state = createInitialAdaptiveState();
	for (let i = 0; i < count; i++) {
		state = processAttempt(state, score, score, score);
	}
	return state;
}

/** Feed N attempts with different pitch and rhythm scores. */
function feedSplitAttempts(
	count: number,
	pitchScore: number,
	rhythmScore: number,
	initial?: AdaptiveState
): AdaptiveState {
	const overall = pitchScore * 0.6 + rhythmScore * 0.4;
	let state = initial ?? createInitialAdaptiveState();
	for (let i = 0; i < count; i++) {
		state = processAttempt(state, overall, pitchScore, rhythmScore);
	}
	return state;
}

describe('createInitialAdaptiveState', () => {
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

describe('processAttempt', () => {
	it('adds scores to all three windows', () => {
		const state = createInitialAdaptiveState();
		const next = processAttempt(state, 0.8, 0.85, 0.75);
		expect(next.recentScores).toEqual([0.8]);
		expect(next.recentPitchScores).toEqual([0.85]);
		expect(next.recentRhythmScores).toEqual([0.75]);
	});

	it('caps all windows at WINDOW_SIZE', () => {
		const state = feedAttempts(WINDOW_SIZE + 5, 0.7);
		expect(state.recentScores).toHaveLength(WINDOW_SIZE);
		expect(state.recentPitchScores).toHaveLength(WINDOW_SIZE);
		expect(state.recentRhythmScores).toHaveLength(WINDOW_SIZE);
	});

	it('advances when avg >= 85% after enough attempts', () => {
		const state = feedAttempts(11, 0.95);
		expect(state.currentLevel).toBeGreaterThan(1);
	});

	it('does not advance before MIN_ATTEMPTS_BETWEEN_CHANGES', () => {
		const state = feedAttempts(9, 0.95);
		expect(state.currentLevel).toBe(1);
	});

	it('retreats when avg < 50% after enough attempts', () => {
		let state = feedAttempts(11, 0.95);
		const levelBefore = state.currentLevel;
		for (let i = 0; i < 30; i++) {
			state = processAttempt(state, 0.3, 0.3, 0.3);
		}
		expect(state.currentLevel).toBeLessThan(levelBefore);
	});

	it('pitch advances independently when pitch scores are high', () => {
		const state = feedSplitAttempts(11, 0.95, 0.60);
		expect(state.pitchComplexity).toBeGreaterThan(1);
		expect(state.rhythmComplexity).toBe(1);
	});

	it('rhythm advances independently when rhythm scores are high', () => {
		const state = feedSplitAttempts(11, 0.60, 0.95);
		expect(state.rhythmComplexity).toBeGreaterThan(1);
		expect(state.pitchComplexity).toBe(1);
	});

	it('both advance when both dimensions score high', () => {
		const state = feedAttempts(11, 0.95);
		expect(state.pitchComplexity).toBeGreaterThan(1);
		expect(state.rhythmComplexity).toBeGreaterThan(1);
	});

	it('pitch retreats while rhythm stays when only pitch is weak', () => {
		let state: AdaptiveState = {
			...createInitialAdaptiveState(),
			pitchComplexity: 5,
			rhythmComplexity: 5,
			currentLevel: 5
		};
		state = feedSplitAttempts(11, 0.30, 0.70, state);
		expect(state.pitchComplexity).toBeLessThan(5);
		expect(state.rhythmComplexity).toBe(5);
	});

	it('dimensions can diverge significantly', () => {
		const state = feedSplitAttempts(30, 0.95, 0.60);
		expect(state.pitchComplexity).toBeGreaterThan(2);
		expect(state.rhythmComplexity).toBe(1);
	});

	it('currentLevel equals round of average of pitch and rhythm', () => {
		const state = feedSplitAttempts(30, 0.95, 0.60);
		expect(state.currentLevel).toBe(
			Math.round((state.pitchComplexity + state.rhythmComplexity) / 2)
		);
	});

	it('each dimension has independent cooldown', () => {
		const state = feedSplitAttempts(11, 0.95, 0.60);
		expect(state.pitchAttemptsSinceChange).toBeLessThan(11);
		expect(state.rhythmAttemptsSinceChange).toBe(11);
	});

	it('resets attemptsSinceChange to min of dimension cooldowns', () => {
		const state = feedAttempts(11, 0.95);
		expect(state.attemptsSinceChange).toBe(
			Math.min(state.pitchAttemptsSinceChange, state.rhythmAttemptsSinceChange)
		);
	});
});

describe('getAdaptiveSummary', () => {
	it('returns a string with level info', () => {
		const state = createInitialAdaptiveState();
		const summary = getAdaptiveSummary(state);
		expect(typeof summary).toBe('string');
		expect(summary).toContain('1');
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
