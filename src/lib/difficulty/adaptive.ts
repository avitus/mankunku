/**
 * Adaptive difficulty algorithm.
 *
 * Rules:
 *   - Window of last 25 attempts
 *   - Average > 85% over window → advance (increase weakest parameter first)
 *   - Average < 50% over window → retreat (decrease parameter causing most errors)
 *   - Minimum 10 attempts between difficulty changes
 *   - Pitch and rhythm complexity adjusted independently
 *   - Levels span 1-100
 */

import type { AdaptiveState, ScaleProficiency, KeyProficiency } from '$lib/types/progress.ts';
import { difficultyDisplay } from '$lib/difficulty/display.ts';

const WINDOW_SIZE = 25;
const ADVANCE_THRESHOLD = 0.85;
const RETREAT_THRESHOLD = 0.50;
const MIN_ATTEMPTS_BETWEEN_CHANGES = 10;
const MAX_LEVEL = 100;

/** XP awarded per attempt based on grade */
const XP_TABLE: Record<string, number> = {
	'perfect': 100,
	'great': 75,
	'good': 50,
	'fair': 25,
	'try-again': 10
};

export function createInitialAdaptiveState(): AdaptiveState {
	return {
		currentLevel: 1,
		pitchComplexity: 1,
		rhythmComplexity: 1,
		recentScores: [],
		attemptsAtLevel: 0,
		attemptsSinceChange: 0,
		xp: 0
	};
}

/**
 * Process a new attempt and return updated adaptive state.
 *
 * @param state - Current adaptive state
 * @param overall - Overall score (0-1)
 * @param pitchAccuracy - Pitch accuracy (0-1)
 * @param rhythmAccuracy - Rhythm accuracy (0-1)
 * @param grade - Letter grade string
 * @returns Updated adaptive state
 */
export function processAttempt(
	state: AdaptiveState,
	overall: number,
	pitchAccuracy: number,
	rhythmAccuracy: number,
	grade: string
): AdaptiveState {
	// Add score to window (circular buffer of WINDOW_SIZE)
	const recentScores = [...state.recentScores, overall];
	if (recentScores.length > WINDOW_SIZE) {
		recentScores.shift();
	}

	// Award XP
	const xp = state.xp + (XP_TABLE[grade] ?? 10);

	let { currentLevel, pitchComplexity, rhythmComplexity } = state;
	let attemptsAtLevel = state.attemptsAtLevel + 1;
	let attemptsSinceChange = state.attemptsSinceChange + 1;

	// Only adjust if enough attempts since last change
	if (attemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

		if (avg >= ADVANCE_THRESHOLD && currentLevel < MAX_LEVEL) {
			// Advance: increase the weakest parameter first
			if (pitchComplexity <= rhythmComplexity) {
				pitchComplexity = Math.min(pitchComplexity + 1, MAX_LEVEL);
			} else {
				rhythmComplexity = Math.min(rhythmComplexity + 1, MAX_LEVEL);
			}

			currentLevel = Math.max(pitchComplexity, rhythmComplexity);
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		} else if (avg < RETREAT_THRESHOLD && currentLevel > 1) {
			// Retreat: decrease the parameter causing more errors
			// Lower pitch accuracy → decrease pitch complexity
			// Lower rhythm accuracy → decrease rhythm complexity
			const recentPitchAvg = pitchAccuracy; // use latest as proxy
			const recentRhythmAvg = rhythmAccuracy;

			if (recentPitchAvg <= recentRhythmAvg) {
				pitchComplexity = Math.max(pitchComplexity - 1, 1);
			} else {
				rhythmComplexity = Math.max(rhythmComplexity - 1, 1);
			}

			currentLevel = Math.max(pitchComplexity, rhythmComplexity);
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		}
	}

	return {
		currentLevel,
		pitchComplexity,
		rhythmComplexity,
		recentScores,
		attemptsAtLevel,
		attemptsSinceChange,
		xp
	};
}

/**
 * Get the XP required to complete a given level (i.e., XP needed to go from
 * level N to level N+1).
 *
 * The curve uses a quadratic formula so early levels are quick and later
 * levels take progressively more effort:
 *   Level  1:  50 XP
 *   Level  5: 150 XP
 *   Level 10: 300 XP
 *   Level 25: 750 XP
 *   Level 50: 1550 XP
 *   Level 75: 2800 XP
 *   Level 99: 4900 XP
 *
 * Formula: 50 + (level - 1) * 2 * 25  →  simplified: 50 * level
 * Using a slightly steeper curve: base + level^1.5 * factor
 */
export function xpForLevel(level: number): number {
	// Quadratic-ish curve: 50 base + 0.5 * level^2
	// Level 1: 50, Level 10: 100, Level 50: 1300, Level 100: 5050
	return Math.round(50 + 0.5 * level * level);
}

/**
 * Get the display level based on total XP (1-100).
 */
export function xpToDisplayLevel(xp: number): number {
	let level = 1;
	let required = xpForLevel(level);
	while (xp >= required && level < MAX_LEVEL) {
		xp -= required;
		level++;
		required = xpForLevel(level);
	}
	return level;
}

/**
 * Get XP progress within current display level (0-1).
 */
export function xpProgress(xp: number): number {
	let level = 1;
	let remaining = xp;
	let required = xpForLevel(level);
	while (remaining >= required && level < MAX_LEVEL) {
		remaining -= required;
		level++;
		required = xpForLevel(level);
	}
	return level >= MAX_LEVEL ? 1 : remaining / required;
}

/**
 * Get total XP required to reach a given level from level 1.
 */
export function totalXpForLevel(level: number): number {
	let total = 0;
	for (let i = 1; i < level; i++) {
		total += xpForLevel(i);
	}
	return total;
}

/**
 * Get a human-readable summary of the adaptive state.
 */
export function getAdaptiveSummary(state: AdaptiveState): string {
	const avg = state.recentScores.length > 0
		? state.recentScores.reduce((a, b) => a + b, 0) / state.recentScores.length
		: 0;

	const display = difficultyDisplay(state.currentLevel);
	return `${display.name} ${state.currentLevel} (Pitch: ${state.pitchComplexity}, Rhythm: ${state.rhythmComplexity}) — Avg: ${Math.round(avg * 100)}%`;
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
export function processScaleAttempt(state: ScaleProficiency, overall: number): ScaleProficiency {
	const recentScores = [...state.recentScores, overall];
	if (recentScores.length > WINDOW_SIZE) {
		recentScores.shift();
	}

	let { level } = state;
	let attemptsAtLevel = state.attemptsAtLevel + 1;
	let attemptsSinceChange = state.attemptsSinceChange + 1;
	const totalAttempts = state.totalAttempts + 1;

	if (attemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

		if (avg >= ADVANCE_THRESHOLD && level < MAX_LEVEL) {
			level++;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		} else if (avg < RETREAT_THRESHOLD && level > 1) {
			level--;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		}
	}

	return { level, recentScores, attemptsAtLevel, attemptsSinceChange, totalAttempts };
}

/**
 * Process a key-specific attempt and return updated proficiency.
 * Same algorithm as scale proficiency.
 */
export function processKeyAttempt(state: KeyProficiency, overall: number): KeyProficiency {
	const recentScores = [...state.recentScores, overall];
	if (recentScores.length > WINDOW_SIZE) {
		recentScores.shift();
	}

	let { level } = state;
	let attemptsAtLevel = state.attemptsAtLevel + 1;
	let attemptsSinceChange = state.attemptsSinceChange + 1;
	const totalAttempts = state.totalAttempts + 1;

	if (attemptsSinceChange >= MIN_ATTEMPTS_BETWEEN_CHANGES && recentScores.length >= MIN_ATTEMPTS_BETWEEN_CHANGES) {
		const avg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

		if (avg >= ADVANCE_THRESHOLD && level < MAX_LEVEL) {
			level++;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		} else if (avg < RETREAT_THRESHOLD && level > 1) {
			level--;
			attemptsAtLevel = 0;
			attemptsSinceChange = 0;
		}
	}

	return { level, recentScores, attemptsAtLevel, attemptsSinceChange, totalAttempts };
}
