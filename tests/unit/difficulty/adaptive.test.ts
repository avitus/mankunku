import { describe, it, expect } from 'vitest';
import {
	createInitialAdaptiveState,
	processAttempt,
	xpForLevel,
	xpToDisplayLevel,
	xpProgress,
	totalXpForLevel,
	getAdaptiveSummary,
	createInitialScaleProficiency,
	createInitialKeyProficiency,
	processScaleAttempt,
	processKeyAttempt,
	WINDOW_SIZE
} from '$lib/difficulty/adaptive.ts';
import type { AdaptiveState } from '$lib/types/progress.ts';

function feedAttempts(count: number, score: number, grade = 'good'): AdaptiveState {
	let state = createInitialAdaptiveState();
	for (let i = 0; i < count; i++) {
		state = processAttempt(state, score, score, score, grade);
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
		expect(state.xp).toBe(0);
	});
});

describe('processAttempt', () => {
	it('adds score to recentScores', () => {
		const state = createInitialAdaptiveState();
		const next = processAttempt(state, 0.8, 0.8, 0.8, 'good');
		expect(next.recentScores).toEqual([0.8]);
	});

	it('caps recentScores at WINDOW_SIZE', () => {
		const state = feedAttempts(WINDOW_SIZE + 5, 0.7);
		expect(state.recentScores).toHaveLength(WINDOW_SIZE);
	});

	it('awards XP based on grade', () => {
		let state = createInitialAdaptiveState();
		state = processAttempt(state, 1.0, 1.0, 1.0, 'perfect');
		expect(state.xp).toBe(100);
		state = processAttempt(state, 0.9, 0.9, 0.9, 'great');
		expect(state.xp).toBe(175);
		state = processAttempt(state, 0.7, 0.7, 0.7, 'good');
		expect(state.xp).toBe(225);
		state = processAttempt(state, 0.5, 0.5, 0.5, 'fair');
		expect(state.xp).toBe(250);
		state = processAttempt(state, 0.3, 0.3, 0.3, 'try-again');
		expect(state.xp).toBe(260);
	});

	it('advances when avg >= 85% after enough attempts', () => {
		// Feed 10 high-scoring attempts to trigger advancement
		const state = feedAttempts(11, 0.95, 'perfect');
		expect(state.currentLevel).toBeGreaterThan(1);
	});

	it('does not advance before MIN_ATTEMPTS_BETWEEN_CHANGES', () => {
		const state = feedAttempts(9, 0.95, 'perfect');
		expect(state.currentLevel).toBe(1);
	});

	it('retreats when avg < 50% after enough attempts', () => {
		// Start at a higher level, then feed bad scores
		let state = feedAttempts(11, 0.95, 'perfect'); // advance first
		const levelBefore = state.currentLevel;
		// Feed enough bad scores to flush the window (25) and pass min attempts (10)
		for (let i = 0; i < 30; i++) {
			state = processAttempt(state, 0.3, 0.3, 0.3, 'try-again');
		}
		expect(state.currentLevel).toBeLessThan(levelBefore);
	});

	it('increases weakest parameter on advance', () => {
		const state = createInitialAdaptiveState();
		// Both start at 1; pitch <= rhythm so pitch advances first
		const advanced = feedAttempts(11, 0.95, 'perfect');
		// One of the parameters should have increased
		expect(advanced.pitchComplexity + advanced.rhythmComplexity).toBeGreaterThan(2);
	});

	it('level equals max of pitch and rhythm complexity', () => {
		const state = feedAttempts(11, 0.95, 'perfect');
		expect(state.currentLevel).toBe(
			Math.max(state.pitchComplexity, state.rhythmComplexity)
		);
	});

	it('resets attemptsSinceChange after level change', () => {
		const state = feedAttempts(11, 0.95, 'perfect');
		// After advancing, attemptsSinceChange should be small
		// (only the attempts after the last change)
		expect(state.attemptsSinceChange).toBeLessThan(11);
	});
});

describe('xpForLevel', () => {
	it('level 1 requires ~51 XP', () => {
		expect(xpForLevel(1)).toBe(Math.round(50 + 0.5));
	});

	it('higher levels require more XP', () => {
		expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(1));
		expect(xpForLevel(50)).toBeGreaterThan(xpForLevel(10));
		expect(xpForLevel(100)).toBeGreaterThan(xpForLevel(50));
	});

	it('formula: 50 + 0.5 * level^2', () => {
		expect(xpForLevel(10)).toBe(Math.round(50 + 0.5 * 100));
		expect(xpForLevel(20)).toBe(Math.round(50 + 0.5 * 400));
	});
});

describe('xpToDisplayLevel', () => {
	it('0 XP → level 1', () => {
		expect(xpToDisplayLevel(0)).toBe(1);
	});

	it('enough XP advances past level 1', () => {
		const lvl1Cost = xpForLevel(1);
		expect(xpToDisplayLevel(lvl1Cost)).toBe(2);
	});

	it('very large XP caps at 100', () => {
		expect(xpToDisplayLevel(999999999)).toBe(100);
	});
});

describe('xpProgress', () => {
	it('0 XP → 0 progress', () => {
		expect(xpProgress(0)).toBe(0);
	});

	it('halfway through level 1 → ~0.5', () => {
		const half = Math.floor(xpForLevel(1) / 2);
		const progress = xpProgress(half);
		expect(progress).toBeGreaterThan(0.3);
		expect(progress).toBeLessThan(0.7);
	});

	it('max level → 1', () => {
		expect(xpProgress(999999999)).toBe(1);
	});
});

describe('totalXpForLevel', () => {
	it('level 1 requires 0 cumulative XP', () => {
		expect(totalXpForLevel(1)).toBe(0);
	});

	it('level 2 requires xpForLevel(1) cumulative XP', () => {
		expect(totalXpForLevel(2)).toBe(xpForLevel(1));
	});

	it('level 3 = xpForLevel(1) + xpForLevel(2)', () => {
		expect(totalXpForLevel(3)).toBe(xpForLevel(1) + xpForLevel(2));
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
		// Advance first
		for (let i = 0; i < 11; i++) {
			state = processScaleAttempt(state, 0.95);
		}
		const levelBefore = state.level;
		// Feed enough bad scores to flush the window and trigger retreat
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
