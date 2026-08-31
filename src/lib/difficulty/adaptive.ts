/**
 * Per-scale / per-key proficiency algorithm.
 *
 * Rules (single dimension, applied per scale type and per key):
 *   - Window of last 25 attempts
 *   - Average ≥ 85% over window → advance one level
 *   - Average < 50% over window → retreat one level
 *   - Minimum 10 attempts between changes
 *   - Levels span 1-100
 *
 * These proficiencies are the live difficulty system: they gate ear-training
 * content selection and drive key/scale unlocks. The old GLOBAL pitch/rhythm
 * complexity ratchet (`processAttempt` on `AdaptiveState`) was retired
 * 2026-08-31 — nothing consumed its output after the generator's removal, so
 * it only ratcheted to 100 and sat there. `createInitialAdaptiveState` remains
 * because the frozen `progress.adaptive` field still round-trips through
 * hydrate, cloud merge, and the `adaptive_state` sync column.
 */

import type { AdaptiveState, ScaleProficiency, KeyProficiency } from '$lib/types/progress';

const WINDOW_SIZE = 25;
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

/** Process a scale-specific attempt and return updated proficiency. */
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
