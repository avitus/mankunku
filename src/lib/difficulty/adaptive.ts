/**
 * Adaptive difficulty algorithm.
 *
 * Rules:
 *   - Window of last 25 attempts per dimension
 *   - Pitch and rhythm advance/retreat independently based on their own accuracy
 *   - Average ≥ 85% over window → advance that dimension
 *   - Average < 50% over window → retreat that dimension
 *   - Minimum 10 attempts between changes (per dimension)
 *   - Levels span 1-100
 */

import type { AdaptiveState, ScaleProficiency, KeyProficiency } from '$lib/types/progress';
import { difficultyDisplay } from '$lib/difficulty/display';

export const WINDOW_SIZE = 25;
const ADVANCE_THRESHOLD = 0.85;
const RETREAT_THRESHOLD = 0.50;
const MIN_ATTEMPTS_BETWEEN_CHANGES = 10;
const MAX_LEVEL = 100;

export function createInitialAdaptiveState(): AdaptiveState {
	return {
		currentLevel: 1,
		pitchComplexity: 1,
		rhythmComplexity: 1,
		recentScores: [],
		recentPitchScores: [],
		recentRhythmScores: [],
		attemptsAtLevel: 0,
		attemptsSinceChange: 0,
		pitchAttemptsSinceChange: 0,
		rhythmAttemptsSinceChange: 0
	};
}

/** Average of a number array, or 0 if empty. */
function avg(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Push a value into a circular buffer, returning the new array. */
function pushWindow(window: number[], value: number): number[] {
	const next = [...window, value];
	if (next.length > WINDOW_SIZE) next.shift();
	return next;
}

/**
 * Process a new attempt and return updated adaptive state.
 *
 * Pitch and rhythm are adjusted independently: each dimension has its own
 * score window and cooldown counter, and advances/retreats based solely
 * on its own accuracy average.
 */
export function processAttempt(
	state: AdaptiveState,
	overall: number,
	pitchAccuracy: number,
	rhythmAccuracy: number
): AdaptiveState {
	const recentScores = pushWindow(state.recentScores, overall);
	const recentPitchScores = pushWindow(state.recentPitchScores ?? [], pitchAccuracy);
	const recentRhythmScores = pushWindow(state.recentRhythmScores ?? [], rhythmAccuracy);

	let { pitchComplexity, rhythmComplexity } = state;
	let attemptsAtLevel = state.attemptsAtLevel + 1;
	let pitchAttemptsSinceChange = (state.pitchAttemptsSinceChange ?? 0) + 1;
	let rhythmAttemptsSinceChange = (state.rhythmAttemptsSinceChange ?? 0) + 1;
	let changed = false;

	// Pitch decision (independent)
	if (pitchAttemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentPitchScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const pitchAvg = avg(recentPitchScores);
		if (pitchAvg >= ADVANCE_THRESHOLD && pitchComplexity < MAX_LEVEL) {
			pitchComplexity++;
			pitchAttemptsSinceChange = 0;
			changed = true;
		} else if (pitchAvg < RETREAT_THRESHOLD && pitchComplexity > 1) {
			pitchComplexity--;
			pitchAttemptsSinceChange = 0;
			changed = true;
		}
	}

	// Rhythm decision (independent)
	if (rhythmAttemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentRhythmScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const rhythmAvg = avg(recentRhythmScores);
		if (rhythmAvg >= ADVANCE_THRESHOLD && rhythmComplexity < MAX_LEVEL) {
			rhythmComplexity++;
			rhythmAttemptsSinceChange = 0;
			changed = true;
		} else if (rhythmAvg < RETREAT_THRESHOLD && rhythmComplexity > 1) {
			rhythmComplexity--;
			rhythmAttemptsSinceChange = 0;
			changed = true;
		}
	}

	if (changed) attemptsAtLevel = 0;

	const currentLevel = Math.round((pitchComplexity + rhythmComplexity) / 2);

	return {
		currentLevel,
		pitchComplexity,
		rhythmComplexity,
		recentScores,
		recentPitchScores,
		recentRhythmScores,
		attemptsAtLevel,
		attemptsSinceChange: Math.min(pitchAttemptsSinceChange, rhythmAttemptsSinceChange),
		pitchAttemptsSinceChange,
		rhythmAttemptsSinceChange
	};
}

/**
 * Get a human-readable summary of the adaptive state.
 */
export function getAdaptiveSummary(state: AdaptiveState): string {
	const avgScore = avg(state.recentScores);

	const display = difficultyDisplay(state.currentLevel);
	return `${display.name} ${state.currentLevel} (Pitch: ${state.pitchComplexity}, Rhythm: ${state.rhythmComplexity}) — Avg: ${Math.round(avgScore * 100)}%`;
}

// ── Per-scale / per-key proficiency ──────────────────────────────

export function createInitialScaleProficiency(): ScaleProficiency {
	return {
		level: 1,
		recentScores: [],
		attemptsAtLevel: 0,
		attemptsSinceChange: 0,
		totalAttempts: 0
	};
}

export function createInitialKeyProficiency(): KeyProficiency {
	return {
		level: 1,
		recentScores: [],
		attemptsAtLevel: 0,
		attemptsSinceChange: 0,
		totalAttempts: 0
	};
}

/**
 * Process a scale-specific attempt and return updated proficiency.
 * Uses the same advancement algorithm as the global adaptive state.
 */
/** Shared single-dimension advancement logic for scale and key proficiency. */
function advanceSingleDimension(
	state: { level: number; recentScores: number[]; attemptsAtLevel: number; attemptsSinceChange: number; totalAttempts: number },
	overall: number
): { level: number; recentScores: number[]; attemptsAtLevel: number; attemptsSinceChange: number; totalAttempts: number } {
	const recentScores = pushWindow(state.recentScores, overall);
	let { level } = state;
	let attemptsAtLevel = state.attemptsAtLevel + 1;
	let attemptsSinceChange = state.attemptsSinceChange + 1;
	const totalAttempts = state.totalAttempts + 1;

	if (attemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const a = avg(recentScores);
		if (a >= ADVANCE_THRESHOLD && level < MAX_LEVEL) {
			level++;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		} else if (a < RETREAT_THRESHOLD && level > 1) {
			level--;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		}
	}

	return { level, recentScores, attemptsAtLevel, attemptsSinceChange, totalAttempts };
}

export function processScaleAttempt(state: ScaleProficiency, overall: number): ScaleProficiency {
	return advanceSingleDimension(state, overall);
}

/**
 * Process a key-specific attempt and return updated proficiency.
 * Same algorithm as scale proficiency.
 */
export function processKeyAttempt(state: KeyProficiency, overall: number): KeyProficiency {
	return advanceSingleDimension(state, overall);
}
