/**
 * Progress state — persisted to localStorage.
 *
 * Tracks session history, adaptive difficulty, per-category and per-key stats.
 * Auto-saves on every mutation via $effect.
 */

import type { UserProgress, SessionResult, CategoryProgress, AdaptiveState, ScaleProficiency, KeyProficiency, UnlockContext } from '$lib/types/progress';
import type { Score } from '$lib/types/scoring';
import type { PhraseCategory, PitchClass } from '$lib/types/music';
import type { ScaleType } from '$lib/tonality/tonality';
import { createInitialAdaptiveState, processAttempt, createInitialScaleProficiency, createInitialKeyProficiency, processScaleAttempt, processKeyAttempt } from '$lib/difficulty/adaptive';
import { save, load } from '$lib/persistence/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { syncProgressToCloud, loadProgressFromCloud, deleteProgressDetailsFromCloud } from '$lib/persistence/sync';
import { aggregateSession, clearHistory, localDateStr } from '$lib/state/history.svelte.ts';

const STORAGE_KEY = 'progress';
const MAX_SESSIONS = 200; // keep last 200 sessions

function createInitialProgress(): UserProgress {
	return {
		adaptive: createInitialAdaptiveState(),
		sessions: [],
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		totalPracticeTime: 0,
		streakDays: 0,
		lastPracticeDate: ''
	};
}

function loadProgress(): UserProgress {
	const saved = load<UserProgress>(STORAGE_KEY);
	if (!saved) return createInitialProgress();

	// Merge with defaults for forward compatibility
	const merged: UserProgress = {
		...createInitialProgress(),
		...saved,
		adaptive: {
			...createInitialAdaptiveState(),
			...saved.adaptive
		}
	};

	// Migrate: build scaleProficiency and keyProficiency from session history
	if (!saved.scaleProficiency || Object.keys(saved.scaleProficiency).length === 0) {
		merged.scaleProficiency = migrateScaleProficiency(merged.sessions);
	}
	if (!saved.keyProficiency || Object.keys(saved.keyProficiency).length === 0) {
		merged.keyProficiency = migrateKeyProficiency(merged.sessions);
	}

	return merged;
}

/** Replay session history to build per-scale proficiency */
function migrateScaleProficiency(sessions: SessionResult[]): Partial<Record<ScaleType, ScaleProficiency>> {
	const result: Partial<Record<ScaleType, ScaleProficiency>> = {};
	// Walk oldest-first
	const ordered = [...sessions].reverse();
	for (const s of ordered) {
		if (!s.scaleType) continue;
		const current = result[s.scaleType] ?? createInitialScaleProficiency();
		result[s.scaleType] = processScaleAttempt(current, s.overall);
	}
	return result;
}

/** Replay session history to build per-key proficiency */
function migrateKeyProficiency(sessions: SessionResult[]): Partial<Record<PitchClass, KeyProficiency>> {
	const result: Partial<Record<PitchClass, KeyProficiency>> = {};
	const ordered = [...sessions].reverse();
	for (const s of ordered) {
		const current = result[s.key] ?? createInitialKeyProficiency();
		result[s.key] = processKeyAttempt(current, s.overall);
	}
	return result;
}

export const progress = $state<UserProgress>(loadProgress());

/** Guard to prevent repeated cloud hydration within the same page lifecycle. */
let cloudHydrated = false;

/**
 * Save current progress to localStorage.
 * Call this after mutations — or use the auto-save effect in a component.
 */
export function saveProgress(): void {
	save(STORAGE_KEY, progress);
}

/**
 * Initialize progress from cloud data for authenticated users.
 * Merges cloud data with local state, preferring cloud when more recent.
 * Called from the layout/page level after authentication — never on module import.
 *
 * Merge strategy:
 *  - If cloud has >= sessions as local → cloud data takes full precedence (practiced on another device)
 *  - If local has more sessions → keep entire local state (offline practice not yet synced)
 *
 * Note on aggregate fields (totalPracticeTime, streakDays, categoryProgress, keyProgress,
 * scaleProficiency, keyProficiency): When local has more sessions than cloud, these aggregate
 * fields are NOT merged from the cloud. This is intentional — aggregate fields are derived from
 * session history, so the local values (computed from the longer session list) are already more
 * complete. Merging partial cloud aggregates could introduce inconsistencies. The next cloud sync
 * after connectivity is restored will push the full local state to the server, reconciling both.
 *
 * Errors are caught and logged as warnings — the app remains fully functional offline.
 */
export async function initFromCloud(supabase: SupabaseClient<Database>): Promise<void> {
	if (cloudHydrated) return;
	cloudHydrated = true;

	try {
		const cloudProgress = await loadProgressFromCloud(supabase);
		if (!cloudProgress) return; // No cloud data or not authenticated

		// Merge cloud data with local state
		// Cloud data takes precedence for aggregate fields
		const localSessionCount = progress.sessions.length;
		const cloudSessionCount = cloudProgress.sessions.length;

		if (cloudSessionCount >= localSessionCount) {
			// Cloud has same or more sessions — use cloud data as base
			Object.assign(progress, {
				...cloudProgress,
				// Re-merge adaptive state with defaults for forward compatibility
				adaptive: {
					...createInitialAdaptiveState(),
					...cloudProgress.adaptive
				}
			});

			// Migrate: rebuild proficiency from sessions if cloud detail tables were empty
			if (!progress.scaleProficiency || Object.keys(progress.scaleProficiency).length === 0) {
				progress.scaleProficiency = migrateScaleProficiency(progress.sessions);
			}
			if (!progress.keyProficiency || Object.keys(progress.keyProficiency).length === 0) {
				progress.keyProficiency = migrateKeyProficiency(progress.sessions);
			}
		} else {
			// Local has more sessions — keep local state intact (offline practice not yet synced)
			// Only re-merge adaptive state with defaults for forward compatibility of new fields
			progress.adaptive = {
				...createInitialAdaptiveState(),
				...progress.adaptive
			};
		}

		// Persist merged state locally for offline cache
		saveProgress();
	} catch (err) {
		console.warn('Failed to initialize progress from cloud:', err);
	}
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
	scaleType?: ScaleType,
	supabase?: SupabaseClient<Database>
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

	// Update per-scale proficiency
	if (scaleType) {
		updateScaleProficiency(scaleType, score);
	}

	// Update per-key proficiency
	updateKeyProficiency(key, score);

	// Update category progress
	updateCategoryProgress(category, score);

	// Update key progress
	updateKeyProgress(key, score);

	// Update streak
	updateStreak();

	// Aggregate into daily summary for long-term tracking
	aggregateSession(session);

	// Persist
	saveProgress();

	// Fire-and-forget cloud sync (does not block UI)
	if (supabase) {
		syncProgressToCloud(supabase, progress).catch((err) => {
			console.warn('Failed to sync progress to cloud:', err);
		});
	}
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

function updateScaleProficiency(scaleType: ScaleType, score: Score): void {
	const current = progress.scaleProficiency[scaleType] ?? createInitialScaleProficiency();
	progress.scaleProficiency[scaleType] = processScaleAttempt(current, score.overall);
}

function updateKeyProficiency(key: PitchClass, score: Score): void {
	const current = progress.keyProficiency[key] ?? createInitialKeyProficiency();
	progress.keyProficiency[key] = processKeyAttempt(current, score.overall);
}

/**
 * Build an UnlockContext from current progress state.
 */
export function getUnlockContext(): UnlockContext {
	const scaleProficiency: Partial<Record<ScaleType, { level: number }>> = {};
	for (const [k, v] of Object.entries(progress.scaleProficiency) as [ScaleType, ScaleProficiency][]) {
		scaleProficiency[k] = { level: v.level };
	}
	const keyProficiency: Partial<Record<PitchClass, { level: number }>> = {};
	for (const [k, v] of Object.entries(progress.keyProficiency) as [PitchClass, KeyProficiency][]) {
		keyProficiency[k] = { level: v.level };
	}
	return { scaleProficiency, keyProficiency };
}

/**
 * Get the primary display level: average of all per-scale proficiency levels.
 */
export function getPrimaryLevel(): number {
	const levels = Object.values(progress.scaleProficiency)
		.map(sp => Number(sp.level))
		.filter(n => !Number.isNaN(n))
		.map(n => Math.max(1, Math.min(100, n)));
	if (levels.length === 0) return 1;
	return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

function updateStreak(): void {
	const today = localDateStr(new Date());

	if (progress.lastPracticeDate === today) return;

	const yesterday = localDateStr(new Date(Date.now() - 86400000));
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
 *
 * Clears local state and syncs the empty state to cloud. Also deletes
 * orphaned detail rows (session_results, scale_proficiency, key_proficiency)
 * that syncProgressToCloud would skip because the arrays are empty.
 */
export function resetProgress(supabase?: SupabaseClient<Database>): void {
	const fresh = createInitialProgress();
	Object.assign(progress, fresh);
	saveProgress();
	clearHistory();

	// Fire-and-forget cloud reset
	if (supabase) {
		syncProgressToCloud(supabase, progress).catch((err) => {
			console.warn('Failed to sync progress reset to cloud:', err);
		});
		// Delete orphaned detail rows that syncProgressToCloud skips when empty
		deleteProgressDetailsFromCloud(supabase).catch((err) => {
			console.warn('Failed to delete progress details from cloud:', err);
		});
	}
}
