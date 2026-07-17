/**
 * Progress state — persisted to localStorage.
 *
 * Tracks session history, adaptive difficulty, per-category and per-key stats.
 * Auto-saves on every mutation via $effect.
 */

import type { UserProgress, SessionResult, CategoryProgress, LickProgress, AdaptiveState, ScaleProficiency, KeyProficiency, UnlockContext, TonalMastery } from '$lib/types/progress';
import type { Score } from '$lib/types/scoring';
import type { PhraseCategory, PitchClass } from '$lib/types/music';
import type { ScaleType } from '$lib/tonality/tonality';
import { computeTonalMastery } from '$lib/tonality/mastery';
import { createInitialAdaptiveState, processAttempt, createInitialScaleProficiency, createInitialKeyProficiency, processScaleAttempt, processKeyAttempt } from '$lib/difficulty/adaptive';
import { save, load } from '$lib/persistence/storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { syncProgressToCloud, loadProgressFromCloud, deleteProgressDetailsFromCloud, deleteDailySummariesFromCloud } from '$lib/persistence/sync';
import { recomputeDailySummary, clearHistory, localDateStr } from '$lib/state/history.svelte';
import { getScopeGeneration } from '$lib/persistence/user-scope';
import { enqueue } from '$lib/persistence/outbox';

const STORAGE_KEY = 'progress';
const MAX_SESSIONS = 100; // keep last 100 sessions

/**
 * Collision-resistant session id. Replaces the old `${Date.now()}-${random4}`
 * scheme whose global-PK collisions with another user's row could fail the
 * whole session upsert batch (42501). Falls back to a timestamp+random string
 * where crypto.randomUUID is unavailable (very old / insecure contexts).
 */
function newSessionId(): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		/* fall through */
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createInitialProgress(): UserProgress {
	return {
		adaptive: createInitialAdaptiveState(),
		sessions: [],
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
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
		// Clamp rehydrated sessions to the current cap — legacy payloads
		// written under a larger cap should shrink on first load rather
		// than persist until the next attempt.
		sessions: (saved.sessions ?? []).slice(0, MAX_SESSIONS),
		adaptive: {
			...createInitialAdaptiveState(),
			...saved.adaptive
		}
	};

	// Migrate: normalize lastPracticeDate from UTC to local format
	if (merged.lastPracticeDate) {
		const parsed = new Date(merged.lastPracticeDate + 'T00:00:00Z');
		const normalized = localDateStr(parsed);
		if (normalized !== merged.lastPracticeDate) {
			merged.lastPracticeDate = normalized;
		}
	}

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
	// Walk oldest-first; skip non-ear-training sessions.
	// Sessions without a `source` field pre-date lick practice and are ear-training by definition.
	const ordered = [...sessions].reverse();
	for (const s of ordered) {
		if (s.source === 'lick-practice') continue;
		if (!s.scaleType) continue;
		const current = result[s.scaleType] ?? createInitialScaleProficiency();
		result[s.scaleType] = processScaleAttempt(current, s.overall);
	}
	return result;
}

/** Replay session history to build per-key proficiency */
function migrateKeyProficiency(sessions: SessionResult[]): Partial<Record<PitchClass, KeyProficiency>> {
	const result: Partial<Record<PitchClass, KeyProficiency>> = {};
	// Skip lick-practice sessions — only ear-training drives key proficiency.
	// Sessions without a `source` field pre-date lick practice and are ear-training by definition.
	const ordered = [...sessions].reverse();
	for (const s of ordered) {
		if (s.source === 'lick-practice') continue;
		const current = result[s.key] ?? createInitialKeyProficiency();
		result[s.key] = processKeyAttempt(current, s.overall);
	}
	return result;
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
 * Whether cloud progress has been hydrated this session. Gates the aggregate
 * cloud push: on a hydration error the flag stays false and the outbox defers
 * the push (retrying after a later successful hydration) rather than writing a
 * possibly-stale aggregate over the cloud row.
 */
let progressHydrationOk = false;

/**
 * Enqueue a progress sync. The outbox coalesces (one pending entry, drained
 * against the latest local state) and retries with backoff, so an earlier
 * provisional write can't land after a later authoritative one, and a failed
 * push is never silently dropped. `_supabase` param kept for call-site parity.
 */
function queueProgressSync(_supabase?: SupabaseClient<Database>): void {
	enqueue('progress');
}

/**
 * Outbox flush handler: push the current progress to the cloud. Gated on a
 * successful hydration so we never clobber the cloud aggregate from an
 * un-hydrated device. Throws on failure so the outbox retries.
 */
export async function flushProgressToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	if (!progressHydrationOk) throw new Error('progress not hydrated yet — deferring push');
	const ok = await syncProgressToCloud(supabase, progress);
	if (!ok) throw new Error('progress push failed');
}

/** Merge two per-key counter maps, keeping the entry with the larger counter. */
function mergeByCounter<T>(
	local: Record<string, T | undefined>,
	cloud: Record<string, T | undefined>,
	field: keyof T
): Record<string, T> {
	const out: Record<string, T> = {};
	const ids = new Set([...Object.keys(local ?? {}), ...Object.keys(cloud ?? {})]);
	for (const id of ids) {
		const l = local?.[id];
		const c = cloud?.[id];
		if (l && c) out[id] = Number(l[field]) >= Number(c[field]) ? l : c;
		else if (l) out[id] = l;
		else if (c) out[id] = c;
	}
	return out;
}

/** Merge proficiency maps, keeping the record with more lifetime attempts. */
function mergeProficiency<T extends { totalAttempts: number; level: number }>(
	local: Partial<Record<string, T>>,
	cloud: Partial<Record<string, T>>
): Partial<Record<string, T>> {
	const out: Partial<Record<string, T>> = {};
	const ids = new Set([...Object.keys(local ?? {}), ...Object.keys(cloud ?? {})]);
	for (const id of ids) {
		const l = local[id];
		const c = cloud[id];
		if (l && c) {
			if (c.totalAttempts > l.totalAttempts) out[id] = c;
			else if (l.totalAttempts > c.totalAttempts) out[id] = l;
			else out[id] = c.level >= l.level ? c : l;
		} else out[id] = (l ?? c)!;
	}
	return out;
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
	const gen = getScopeGeneration();
	try {
		const result = await loadProgressFromCloud(supabase);
		if (result.status === 'error') {
			// Cloud truth unknown — do NOT treat local as authoritative and do NOT
			// enable the cloud push. Local stays intact; a later successful
			// hydration flips the gate and drains any queued push.
			progressHydrationOk = false;
			return;
		}
		if (gen !== getScopeGeneration()) return; // User switched mid-flight
		progressHydrationOk = true;

		if (result.status === 'empty') {
			// Brand-new cloud account — local is authoritative; ensure it's cached
			// and let the outbox push it up.
			saveProgress();
			if (progress.sessions.length > 0 && gen === getScopeGeneration()) enqueue('progress');
			return;
		}

		const cloud = result.data;

		// Sessions: UNION by id (local wins same-id for in-flight rescore), newest
		// MAX_SESSIONS for local display. Never discard the other side's distinct
		// sessions the way the old count-based all-or-nothing merge did.
		const byId = new Map<string, SessionResult>();
		for (const s of cloud.sessions) byId.set(s.id, s);
		for (const s of progress.sessions) byId.set(s.id, s);
		const mergedSessions = [...byId.values()]
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, MAX_SESSIONS);

		// adaptive: the device that practiced most recently has the freshest
		// buffers (they can't be rebuilt from a 100-row window). Derive each side's
		// latest from the MAX timestamp rather than assuming sessions[0] is newest.
		const maxTs = (list: SessionResult[]) => list.reduce((m, s) => (s.timestamp > m ? s.timestamp : m), 0);
		const localLatest = maxTs(progress.sessions);
		const cloudLatest = maxTs(cloud.sessions);
		const adaptive = cloudLatest > localLatest ? cloud.adaptive : progress.adaptive;

		Object.assign(progress, {
			adaptive: { ...createInitialAdaptiveState(), ...adaptive },
			sessions: mergedSessions,
			// Lifetime counters: keep the side with more attempts per key/category.
			categoryProgress: mergeByCounter(progress.categoryProgress, cloud.categoryProgress, 'attemptsTotal'),
			keyProgress: mergeByCounter(progress.keyProgress, cloud.keyProgress, 'attempts'),
			scaleProficiency: mergeProficiency(progress.scaleProficiency, cloud.scaleProficiency),
			keyProficiency: mergeProficiency(progress.keyProficiency, cloud.keyProficiency),
			lickProgress: progress.lickProgress, // cloud doesn't store it
			totalPracticeTime: Math.max(progress.totalPracticeTime, cloud.totalPracticeTime),
			streakDays: Math.max(progress.streakDays, cloud.streakDays),
			lastPracticeDate:
				progress.lastPracticeDate >= cloud.lastPracticeDate
					? progress.lastPracticeDate
					: cloud.lastPracticeDate
		});

		// Rebuild proficiency from sessions if both sides were empty.
		if (Object.keys(progress.scaleProficiency).length === 0) {
			progress.scaleProficiency = migrateScaleProficiency(progress.sessions);
		}
		if (Object.keys(progress.keyProficiency).length === 0) {
			progress.keyProficiency = migrateKeyProficiency(progress.sessions);
		}

		saveProgress();
		// Push the merged superset back so the cloud converges.
		if (gen === getScopeGeneration()) enqueue('progress');
	} catch (err) {
		console.warn('Failed to initialize progress from cloud:', err);
	}
}

/**
 * Record a completed attempt.
 *
 * Only ear-training sessions (source === 'ear-training', the default) update
 * the "By Key" aggregate (`keyProgress`) and the key-proficiency unlock model
 * (`keyProficiency`).  Lick-practice sessions are recorded to the session log
 * and per-lick progress, but must not pollute the ear-training key statistics.
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
	supabase?: SupabaseClient<Database>,
	source: 'ear-training' | 'lick-practice' = 'ear-training'
): void {
	const session: SessionResult = {
		id: newSessionId(),
		timestamp: Date.now(),
		phraseId,
		phraseName,
		category,
		key,
		scaleType,
		source,
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
		score.rhythmAccuracy
	);

	// Update per-scale proficiency (ear-training only, matching migration logic)
	if (scaleType && source === 'ear-training') {
		updateScaleProficiency(scaleType, score);
	}

	// Update category progress
	updateCategoryProgress(category, score);

	// Update per-lick progress
	updateLickProgress(phraseId, score, tempo);

	// Only ear-training sessions contribute to the "By Key" display and the
	// key-proficiency unlock model.  Lick-practice sessions track their own
	// per-key progress in the isolated lick-practice store.
	if (source === 'ear-training') {
		updateKeyProficiency(key, score);
		updateKeyProgress(key, score);
	}

	// Update streak
	updateStreak();

	// Persist progress before recomputing — the recompute reads from
	// localStorage so the new session must be on disk first.
	saveProgress();

	// Re-derive today's summary from the source tables (progress.sessions +
	// lick-practice-sessions). Captures the live adaptive snapshot for the
	// TrendChart level line; that snapshot isn't reachable from SessionResult
	// itself, so the caller passes it in here.
	const today = localDateStr(new Date(session.timestamp));
	const summary = recomputeDailySummary(today, {
		pitch: progress.adaptive.pitchComplexity,
		rhythm: progress.adaptive.rhythmComplexity,
		tonalMastery: getTonalMastery().overall
	});

	// Queue cloud sync via the durable outbox (does not block UI).
	if (supabase) {
		queueProgressSync(supabase);
		if (summary) enqueue('dailySummaries');
	}
}

/**
 * Update the score-derived fields of a previously-recorded session.
 *
 * The ear-training page calls `recordAttempt` with the provisional live score
 * and then runs a deterministic post-hoc rescore from the saved blob. When
 * the rescore finishes (~200–500 ms later) the on-screen score swaps to the
 * authoritative value, but without this helper the persisted session entry
 * keeps the stale provisional score — producing a visible mismatch between
 * the score the user just saw and what the progress page later shows.
 *
 * Adaptive state, per-key/scale proficiency, category averages, and the
 * daily summary intentionally retain their original (provisional) inputs:
 * the per-attempt drift is small, and partially undoing those aggregates
 * here would risk amplifying transient races between successive rescores.
 */
export function updateSessionScore(
	sessionId: string,
	score: Score,
	supabase?: SupabaseClient<Database>
): void {
	const idx = progress.sessions.findIndex((s) => s.id === sessionId);
	if (idx === -1) return;
	progress.sessions[idx] = {
		...progress.sessions[idx],
		pitchAccuracy: score.pitchAccuracy,
		rhythmAccuracy: score.rhythmAccuracy,
		overall: score.overall,
		grade: score.grade,
		notesHit: score.notesHit,
		notesTotal: score.notesTotal,
		noteResults: score.noteResults,
		timing: score.timing
	};
	saveProgress();
	if (supabase) {
		queueProgressSync(supabase);
	}
}

/**
 * Bump the streak counter for today. Lick-practice's session-log write
 * path calls this directly (no longer routed through a
 * recordLickPracticeAttempt wrapper) and ear-training's recordAttempt
 * also calls it; the lastPracticeDate guard keeps it idempotent within
 * a day.
 */
export function bumpStreakForToday(supabase?: SupabaseClient<Database>): void {
	const before = progress.lastPracticeDate;
	updateStreak();
	if (progress.lastPracticeDate === before) return;
	saveProgress();
	if (supabase) {
		queueProgressSync(supabase);
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

function updateLickProgress(phraseId: string, score: Score, tempo?: number): void {
	const existing = progress.lickProgress[phraseId];

	if (existing) {
		const newTotal = existing.attempts + 1;
		progress.lickProgress[phraseId] = {
			attempts: newTotal,
			averageScore: (existing.averageScore * existing.attempts + score.overall) / newTotal,
			bestScore: Math.max(existing.bestScore, score.overall),
			lastAttempt: Date.now(),
			lastTempo: tempo ?? existing.lastTempo
		};
	} else {
		progress.lickProgress[phraseId] = {
			attempts: 1,
			averageScore: score.overall,
			bestScore: score.overall,
			lastAttempt: Date.now(),
			lastTempo: tempo
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
 * Get the primary display level from the adaptive difficulty state.
 * This is the average of pitchComplexity and rhythmComplexity.
 */
export function getPrimaryLevel(): number {
	return progress.adaptive.currentLevel;
}

/**
 * Aggregate ear-training progress: average proficiency across all 12 scales
 * and all 12 keys (never-attempted slots count as 0). This is the headline
 * "Tonal Mastery" metric shown on the home and progress pages.
 */
export function getTonalMastery(): TonalMastery {
	return computeTonalMastery(progress.scaleProficiency, progress.keyProficiency);
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
		queueProgressSync(supabase);
		// Delete orphaned detail rows that syncProgressToCloud skips when empty
		deleteProgressDetailsFromCloud(supabase).catch((err) => {
			console.warn('Failed to delete progress details from cloud:', err);
		});
		deleteDailySummariesFromCloud(supabase).catch((err) => {
			console.warn('Failed to delete daily summaries from cloud:', err);
		});
	}
}
