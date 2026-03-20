/**
 * Progress state — persisted to localStorage.
 *
 * Tracks session history, adaptive difficulty, per-category and per-key stats.
 * Auto-saves on every mutation via $effect.
 */

import type { UserProgress, SessionResult, CategoryProgress, AdaptiveState } from '$lib/types/progress.ts';
import type { Score } from '$lib/types/scoring.ts';
import type { PhraseCategory, PitchClass } from '$lib/types/music.ts';
import type { ScaleType } from '$lib/tonality/tonality.ts';
import { createInitialAdaptiveState, processAttempt } from '$lib/difficulty/adaptive.ts';
import { save, load } from '$lib/persistence/storage.ts';

const STORAGE_KEY = 'progress';
const MAX_SESSIONS = 200; // keep last 200 sessions

function createInitialProgress(): UserProgress {
	return {
		adaptive: createInitialAdaptiveState(),
		sessions: [],
		categoryProgress: {},
		keyProgress: {},
		totalPracticeTime: 0,
		streakDays: 0,
		lastPracticeDate: ''
	};
}

function loadProgress(): UserProgress {
	const saved = load<UserProgress>(STORAGE_KEY);
	if (!saved) return createInitialProgress();

	// Merge with defaults for forward compatibility
	return {
		...createInitialProgress(),
		...saved,
		adaptive: {
			...createInitialAdaptiveState(),
			...saved.adaptive
		}
	};
}

export const progress = $state<UserProgress>(loadProgress());

/**
 * Save current progress to localStorage.
 * Call this after mutations — or use the auto-save effect in a component.
 */
export function saveProgress(): void {
	save(STORAGE_KEY, progress);
}

/**
 * Record a completed attempt.
 */
export function recordAttempt(
	phraseId: string,
	phraseName: string,
	category: PhraseCategory,
	key: PitchClass,
	tempo: number,
	difficultyLevel: number,
	score: Score,
	scaleType?: ScaleType
): void {
	const session: SessionResult = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		timestamp: Date.now(),
		phraseId,
		phraseName,
		category,
		key,
		scaleType,
		tempo,
		difficultyLevel,
		pitchAccuracy: score.pitchAccuracy,
		rhythmAccuracy: score.rhythmAccuracy,
		overall: score.overall,
		grade: score.grade,
		notesHit: score.notesHit,
		notesTotal: score.notesTotal,
		noteResults: score.noteResults,
		timing: score.timing
	};

	// Add session (keep bounded)
	progress.sessions = [session, ...progress.sessions].slice(0, MAX_SESSIONS);

	// Update adaptive state
	progress.adaptive = processAttempt(
		progress.adaptive,
		score.overall,
		score.pitchAccuracy,
		score.rhythmAccuracy,
		score.grade
	);

	// Update category progress
	updateCategoryProgress(category, score);

	// Update key progress
	updateKeyProgress(key, score);

	// Update streak
	updateStreak();

	// Persist
	saveProgress();
}

function updateCategoryProgress(category: PhraseCategory, score: Score): void {
	const existing = progress.categoryProgress[category] as CategoryProgress | undefined;

	if (existing) {
		const newTotal = existing.attemptsTotal + 1;
		progress.categoryProgress[category] = {
			category,
			attemptsTotal: newTotal,
			averageScore: (existing.averageScore * existing.attemptsTotal + score.overall) / newTotal,
			bestScore: Math.max(existing.bestScore, score.overall),
			lastAttempt: Date.now()
		};
	} else {
		progress.categoryProgress[category] = {
			category,
			attemptsTotal: 1,
			averageScore: score.overall,
			bestScore: score.overall,
			lastAttempt: Date.now()
		};
	}
}

function updateKeyProgress(key: PitchClass, score: Score): void {
	const existing = progress.keyProgress[key];

	if (existing) {
		const newTotal = existing.attempts + 1;
		progress.keyProgress[key] = {
			attempts: newTotal,
			averageScore: (existing.averageScore * existing.attempts + score.overall) / newTotal
		};
	} else {
		progress.keyProgress[key] = {
			attempts: 1,
			averageScore: score.overall
		};
	}
}

function updateStreak(): void {
	const today = new Date().toISOString().slice(0, 10);

	if (progress.lastPracticeDate === today) return;

	const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
	if (progress.lastPracticeDate === yesterday) {
		progress.streakDays++;
	} else if (progress.lastPracticeDate !== today) {
		progress.streakDays = 1;
	}

	progress.lastPracticeDate = today;
}

/**
 * Get recent sessions (newest first).
 */
export function getRecentSessions(count = 10): SessionResult[] {
	return progress.sessions.slice(0, count);
}

/**
 * Get category stats sorted by attempt count.
 */
export function getCategoryStats(): CategoryProgress[] {
	return Object.values(progress.categoryProgress)
		.sort((a, b) => b.attemptsTotal - a.attemptsTotal);
}

/**
 * Reset all progress (destructive).
 */
export function resetProgress(): void {
	const fresh = createInitialProgress();
	Object.assign(progress, fresh);
	saveProgress();
}
