/**
 * Sync orchestrator module.
 *
 * Provides bidirectional synchronization functions between the local browser
 * persistence layer (localStorage / IndexedDB) and the Supabase cloud
 * database / storage.  This is the central coordination point for
 * cross-device data persistence, implementing a last-write-wins conflict
 * resolution strategy via Supabase `upsert` with `updated_at` timestamps.
 *
 * Design rules:
 *  • Every function is wrapped in try/catch and logs warnings on failure.
 *  • No function ever throws — offline resilience is preserved.
 *  • Every function validates the user is authenticated via `getUser()`
 *    before attempting any cloud operation.
 *  • This module contains ONLY pure async functions — no Svelte state
 *    store imports, no side effects.
 */

// ── External type imports ────────────────────────────────────────────
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Internal type imports ────────────────────────────────────────────
import type { Database, Json } from '$lib/supabase/types';
import type {
	UserProgress,
	SessionResult,
	ScaleProficiency,
	KeyProficiency,
	AdaptiveState,
	CategoryProgress,
	DailySummary,
	GradeDistribution
} from '$lib/types/progress';
import { PITCH_CLASSES, type Phrase, type PhraseCategory, type PitchClass } from '$lib/types/music';
import type { LickPracticeProgress, LickProgressHistory } from '$lib/types/lick-practice';
import type { LickMergeMeta } from './lick-metadata-merge';
import type { Grade, NoteResult, TimingDiagnostics } from '$lib/types/scoring';
import { SCALE_UNLOCK_ORDER, type ScaleType } from '$lib/tonality/tonality';

// ── Type alias for convenience ───────────────────────────────────────

/** Supabase client parameterized with the Mankunku database schema. */
type SupabaseDB = SupabaseClient<Database>;

/**
 * Tri-state result of a cloud load. The distinction is load-bearing: `error`
 * means the cloud truth is UNKNOWN (auth/network/query failure) and callers must
 * NOT treat local as authoritative or push/prune; `empty` means the read
 * succeeded and there is affirmatively no row (a new account); `ok` carries the
 * data. Conflating error with empty is what let a fresh / hydration-failed
 * device clobber real cloud data.
 */
export type CloudLoad<T> = { status: 'ok'; data: T } | { status: 'empty' } | { status: 'error' };

/** Minimal typed interface for settings passed to syncSettingsToCloud. */
interface SyncableSettings {
	instrumentId: string;
	defaultTempo: number;
	masterVolume: number;
	metronomeEnabled: boolean;
	metronomeVolume: number;
	backingTrackEnabled: boolean;
	backingInstrument: string;
	backingTrackVolume: number;
	swing: number;
	theme: string;
	onboardingComplete: boolean;
	tonalityOverride: unknown;
	highestNote: number | null;
	backingStyle: string;
	bleedFilterEnabled: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

/** Maximum session results to sync — matches MAX_SESSIONS in progress.svelte.ts. */
const MAX_SESSIONS = 100;

/** Pattern for allowed session ID characters (alphanumeric, hyphen, underscore). */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Runtime sets for validating tonality values from the database. */
const VALID_KEYS = new Set<string>(PITCH_CLASSES);
const VALID_SCALE_TYPES = new Set<string>(SCALE_UNLOCK_ORDER);

/** Validate that a value has the expected Tonality shape ({ key, scaleType }). */
function isValidTonality(value: unknown): boolean {
	if (value == null || typeof value !== 'object') return false;
	const obj = value as Record<string, unknown>;
	return typeof obj.key === 'string' && VALID_KEYS.has(obj.key)
		&& typeof obj.scaleType === 'string' && VALID_SCALE_TYPES.has(obj.scaleType);
}

// ── Helper ───────────────────────────────────────────────────────────

/**
 * Retrieve the authenticated user ID, or `null` if not signed in.
 * Uses `getUser()` (not `getSession()`) for server-side JWT validation
 * per the server-side JWT validation rule.
 */
async function getAuthUserId(supabase: SupabaseDB): Promise<string | null> {
	const {
		data: { user }
	} = await supabase.auth.getUser();
	return user?.id ?? null;
}

// ═════════════════════════════════════════════════════════════════════
//  Progress sync
// ═════════════════════════════════════════════════════════════════════

/**
 * Upsert the full `UserProgress` object to the cloud.
 *
 * Writes to four tables in order:
 *  1. `user_progress`   — aggregate progress row
 *  2. `session_results`  — individual session history (capped at MAX_SESSIONS)
 *  3. `scale_proficiency` — per-scale proficiency records
 *  4. `key_proficiency`   — per-key proficiency records
 *
 * If any step fails the function logs a warning and returns without
 * propagating the error.
 */
export async function syncProgressToCloud(
	supabase: SupabaseDB,
	progress: UserProgress
): Promise<boolean> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return false;

		// 1. Upsert aggregate progress
		const { error: progressError } = await supabase.from('user_progress').upsert(
			{
				user_id: userId,
				adaptive_state: progress.adaptive as unknown as Json,
				category_progress: progress.categoryProgress as unknown as Json,
				key_progress: progress.keyProgress as unknown as Json,
				total_practice_time: progress.totalPracticeTime,
				streak_days: progress.streakDays,
				last_practice_date: progress.lastPracticeDate,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (progressError) {
			console.warn('Failed to sync progress to cloud:', progressError);
			return false;
		}

		// 2. Upsert session results (cap at MAX_SESSIONS)
		const sessionRows = progress.sessions.slice(0, MAX_SESSIONS).map((s) => ({
			id: s.id,
			user_id: userId,
			phrase_id: s.phraseId,
			phrase_name: s.phraseName,
			category: s.category as string,
			key: s.key as string,
			scale_type: (s.scaleType as string) ?? null,
			tempo: s.tempo,
			difficulty_level: s.difficultyLevel,
			pitch_accuracy: s.pitchAccuracy,
			rhythm_accuracy: s.rhythmAccuracy,
			overall: s.overall,
			grade: s.grade as string,
			notes_hit: s.notesHit,
			notes_total: s.notesTotal,
			note_results: s.noteResults as unknown as Json,
			timing: (s.timing ?? null) as unknown as Json,
			timestamp: s.timestamp,
			source: (s.source as string) ?? null
		}));

		// Track whether every detail row synced. If any row is left unsynced we
		// return false so the outbox retries instead of dequeuing a partial push.
		let allDetailsOk = true;

		if (sessionRows.length > 0) {
			const { error: sessionsError } = await supabase
				.from('session_results')
				.upsert(sessionRows, { onConflict: 'id' });

			if (sessionsError) {
				// A single poisoned id (e.g. a legacy global-id collision with
				// another user's row) fails the whole batch with 42501. Fall back
				// to per-row upserts so one bad row can't freeze session sync.
				// NOTE: no prune — cloud sessions are unioned across devices and are
				// only ever deleted by an explicit reset (deleteProgressDetailsFromCloud).
				console.warn('Batch session upsert failed; retrying per-row:', sessionsError);
				for (const row of sessionRows) {
					const { error: rowError } = await supabase
						.from('session_results')
						.upsert(row, { onConflict: 'id' });
					if (rowError) {
						console.warn(`Failed to sync session ${row.id}:`, rowError);
						allDetailsOk = false;
					}
				}
			}
		}

		// 3. Upsert scale proficiency entries
		const scaleRows = Object.entries(progress.scaleProficiency)
			.filter((entry): entry is [string, ScaleProficiency] => entry[1] !== undefined)
			.map(([scaleId, prof]) => ({
				user_id: userId,
				scale_id: scaleId,
				level: prof.level,
				recent_scores: prof.recentScores.map((s) => Math.round(s * 100)),
				attempts_at_level: prof.attemptsAtLevel,
				attempts_since_change: prof.attemptsSinceChange,
				total_attempts: prof.totalAttempts
			}));

		if (scaleRows.length > 0) {
			const { error: scaleError } = await supabase
				.from('scale_proficiency')
				.upsert(scaleRows, { onConflict: 'user_id,scale_id' });

			if (scaleError) {
				console.warn('Failed to sync scale proficiency to cloud:', scaleError);
				allDetailsOk = false;
			}
		}

		// 4. Upsert key proficiency entries
		const keyRows = Object.entries(progress.keyProficiency)
			.filter((entry): entry is [string, KeyProficiency] => entry[1] !== undefined)
			.map(([key, prof]) => ({
				user_id: userId,
				key,
				level: prof.level,
				recent_scores: prof.recentScores.map((s) => Math.round(s * 100)),
				attempts_at_level: prof.attemptsAtLevel,
				attempts_since_change: prof.attemptsSinceChange,
				total_attempts: prof.totalAttempts
			}));

		if (keyRows.length > 0) {
			const { error: keyError } = await supabase
				.from('key_proficiency')
				.upsert(keyRows, { onConflict: 'user_id,key' });

			if (keyError) {
				console.warn('Failed to sync key proficiency to cloud:', keyError);
				allDetailsOk = false;
			}
		}
		return allDetailsOk;
	} catch (error) {
		console.warn('Failed to sync progress to cloud:', error);
		return false;
	}
}

/**
 * Delete all detail rows (session_results, scale_proficiency, key_proficiency)
 * for the authenticated user. Called during progress reset to remove orphaned
 * rows that `syncProgressToCloud` would skip when the arrays are empty.
 */
export async function deleteProgressDetailsFromCloud(
	supabase: SupabaseDB
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const tables = ['session_results', 'scale_proficiency', 'key_proficiency'] as const;
		for (const table of tables) {
			const { error } = await supabase.from(table).delete().eq('user_id', userId);
			if (error) {
				console.warn(`Failed to delete ${table} from cloud:`, error);
			}
		}
	} catch (error) {
		console.warn('Failed to delete progress details from cloud:', error);
	}
}

/**
 * Fetch the user's progress from Supabase and reconstruct a full
 * `UserProgress` object.
 *
 * Returns a tri-state (see CloudLoad): `error` on any auth/query failure (the
 * caller must NOT treat local as authoritative), `empty` when there is
 * affirmatively no aggregate row (a new account), `ok` with the data. A partial
 * pull (one sub-query errors) reports `error` — never an object with fewer
 * sessions than really exist, which the caller could misread and clobber cloud.
 */
export async function loadProgressFromCloud(
	supabase: SupabaseDB
): Promise<CloudLoad<UserProgress>> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return { status: 'error' };

		// Fetch aggregate progress row
		const { data: progressRow, error: progressError } = await supabase
			.from('user_progress')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();

		if (progressError) {
			console.warn('Failed to load progress from cloud:', progressError);
			return { status: 'error' };
		}
		if (!progressRow) return { status: 'empty' };

		// Fetch session results (newest first, capped at MAX_SESSIONS)
		const { data: sessions, error: sessionsError } = await supabase
			.from('session_results')
			.select('*')
			.eq('user_id', userId)
			.order('timestamp', { ascending: false })
			.limit(MAX_SESSIONS);

		if (sessionsError) {
			console.warn('Failed to load session results from cloud:', sessionsError);
			return { status: 'error' };
		}

		// Fetch per-scale proficiency rows
		const { data: scales, error: scalesError } = await supabase
			.from('scale_proficiency')
			.select('*')
			.eq('user_id', userId);

		if (scalesError) {
			console.warn('Failed to load scale proficiency from cloud:', scalesError);
			return { status: 'error' };
		}

		// Fetch per-key proficiency rows
		const { data: keys, error: keysError } = await supabase
			.from('key_proficiency')
			.select('*')
			.eq('user_id', userId);

		if (keysError) {
			console.warn('Failed to load key proficiency from cloud:', keysError);
			return { status: 'error' };
		}

		// ── Map session_results rows → SessionResult[] ──
		const mappedSessions: SessionResult[] = (sessions ?? []).map((row) => ({
			id: row.id,
			timestamp: row.timestamp,
			phraseId: row.phrase_id,
			phraseName: row.phrase_name,
			category: row.category as PhraseCategory,
			key: row.key as PitchClass,
			scaleType: row.scale_type != null
				? (row.scale_type as ScaleType)
				: undefined,
			// NULL source (legacy / old-client rows) reads as ear-training.
			source: (row.source as 'ear-training' | 'lick-practice' | null) ?? 'ear-training',
			tempo: row.tempo,
			difficultyLevel: row.difficulty_level,
			pitchAccuracy: row.pitch_accuracy,
			rhythmAccuracy: row.rhythm_accuracy,
			overall: row.overall,
			grade: row.grade as Grade,
			notesHit: row.notes_hit,
			notesTotal: row.notes_total,
			noteResults: row.note_results as unknown as NoteResult[],
			timing: row.timing != null
				? (row.timing as unknown as TimingDiagnostics)
				: undefined
		}));

		// ── Map scale_proficiency rows → Record<ScaleType, ScaleProficiency> ──
		const scaleProficiency: Partial<Record<ScaleType, ScaleProficiency>> = {};
		for (const row of scales ?? []) {
			scaleProficiency[row.scale_id as ScaleType] = {
				level: row.level,
				recentScores: row.recent_scores.map((s: number) => s / 100),
				attemptsAtLevel: row.attempts_at_level,
				attemptsSinceChange: row.attempts_since_change,
				totalAttempts: row.total_attempts
			};
		}

		// ── Map key_proficiency rows → Record<PitchClass, KeyProficiency> ──
		const keyProficiency: Partial<Record<PitchClass, KeyProficiency>> = {};
		for (const row of keys ?? []) {
			keyProficiency[row.key as PitchClass] = {
				level: row.level,
				recentScores: row.recent_scores.map((s: number) => s / 100),
				attemptsAtLevel: row.attempts_at_level,
				attemptsSinceChange: row.attempts_since_change,
				totalAttempts: row.total_attempts
			};
		}

		// ── Assemble and return UserProgress ──
		return {
			status: 'ok',
			data: {
				adaptive: progressRow.adaptive_state as unknown as AdaptiveState,
				sessions: mappedSessions,
				categoryProgress: progressRow.category_progress as unknown as Record<string, CategoryProgress>,
				keyProgress: progressRow.key_progress as unknown as Partial<
					Record<PitchClass, { attempts: number; averageScore: number }>
				>,
				scaleProficiency,
				keyProficiency,
				lickProgress: {},
				totalPracticeTime: progressRow.total_practice_time,
				streakDays: progressRow.streak_days,
				lastPracticeDate: progressRow.last_practice_date
			}
		};
	} catch (error) {
		console.warn('Failed to load progress from cloud:', error);
		return { status: 'error' };
	}
}

// ═════════════════════════════════════════════════════════════════════
//  Daily summary sync
// ═════════════════════════════════════════════════════════════════════

function dailySummaryToRow(
	userId: string,
	s: DailySummary
): Database['public']['Tables']['daily_summaries']['Insert'] {
	return {
		user_id: userId,
		date: s.date,
		session_count: s.sessionCount,
		ear_training_sessions: s.earTrainingSessions ?? s.sessionCount,
		lick_practice_sessions: s.lickPracticeSessions ?? 0,
		practice_minutes: s.practiceMinutes,
		avg_overall: s.avgOverall,
		avg_pitch: s.avgPitch,
		avg_rhythm: s.avgRhythm,
		best_score: s.bestScore,
		notes_total: s.notesTotal,
		notes_hit: s.notesHit,
		grades: s.grades as unknown as Json,
		categories: s.categories as unknown as Json,
		pitch_complexity: s.pitchComplexity ?? null,
		rhythm_complexity: s.rhythmComplexity ?? null,
		tonal_mastery: s.tonalMastery ?? null,
		updated_at: new Date().toISOString()
	};
}

function rowToDailySummary(row: {
	date: string;
	session_count: number;
	ear_training_sessions: number;
	lick_practice_sessions: number;
	practice_minutes: number;
	avg_overall: number;
	avg_pitch: number;
	avg_rhythm: number;
	best_score: number;
	notes_total: number;
	notes_hit: number;
	grades: Json;
	categories: Json;
	pitch_complexity: number | null;
	rhythm_complexity: number | null;
	tonal_mastery: number | null;
}): DailySummary {
	return {
		date: row.date,
		sessionCount: row.session_count,
		earTrainingSessions: row.ear_training_sessions,
		lickPracticeSessions: row.lick_practice_sessions,
		practiceMinutes: row.practice_minutes,
		avgOverall: row.avg_overall,
		avgPitch: row.avg_pitch,
		avgRhythm: row.avg_rhythm,
		bestScore: row.best_score,
		notesTotal: row.notes_total,
		notesHit: row.notes_hit,
		grades: (row.grades ?? {}) as unknown as GradeDistribution,
		categories: (row.categories ?? {}) as unknown as Record<string, number>,
		pitchComplexity: row.pitch_complexity ?? undefined,
		rhythmComplexity: row.rhythm_complexity ?? undefined,
		tonalMastery: row.tonal_mastery ?? undefined
	};
}

/**
 * Upsert a single day's summary to the cloud.
 * Called after every aggregateSession() so each device's edits propagate.
 */
export async function syncDailySummaryToCloud(
	supabase: SupabaseDB,
	summary: DailySummary
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const { error } = await supabase
			.from('daily_summaries')
			.upsert(dailySummaryToRow(userId, summary), { onConflict: 'user_id,date' });

		if (error) {
			console.warn('Failed to sync daily summary to cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to sync daily summary to cloud:', error);
	}
}

/**
 * Bulk-upsert all local daily summaries. Used after a fresh login flushes
 * any offline-only days that the cloud doesn't yet know about.
 */
export async function syncAllDailySummariesToCloud(
	supabase: SupabaseDB,
	summaries: DailySummary[]
): Promise<void> {
	try {
		if (summaries.length === 0) return;
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const rows = summaries.map((s) => dailySummaryToRow(userId, s));
		const { error } = await supabase
			.from('daily_summaries')
			.upsert(rows, { onConflict: 'user_id,date' });

		if (error) {
			console.warn('Failed to bulk-sync daily summaries to cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to bulk-sync daily summaries to cloud:', error);
	}
}

/**
 * Fetch every daily summary the cloud has for the current user.
 * Returns an empty array if the user is unauthenticated or no rows exist;
 * returns null only on hard errors so the caller can distinguish.
 */
export async function loadDailySummariesFromCloud(
	supabase: SupabaseDB
): Promise<DailySummary[] | null> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return null;

		const { data, error } = await supabase
			.from('daily_summaries')
			.select('*')
			.eq('user_id', userId)
			.order('date', { ascending: true });

		if (error) {
			console.warn('Failed to load daily summaries from cloud:', error);
			return null;
		}

		return (data ?? []).map(rowToDailySummary);
	} catch (error) {
		console.warn('Failed to load daily summaries from cloud:', error);
		return null;
	}
}

/**
 * Delete every daily summary for the current user — called from
 * resetProgress alongside session_results / proficiency cleanup.
 */
export async function deleteDailySummariesFromCloud(
	supabase: SupabaseDB
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const { error } = await supabase
			.from('daily_summaries')
			.delete()
			.eq('user_id', userId);

		if (error) {
			console.warn('Failed to delete daily summaries from cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to delete daily summaries from cloud:', error);
	}
}

// ═════════════════════════════════════════════════════════════════════
//  Settings sync
// ═════════════════════════════════════════════════════════════════════

/**
 * Upsert user settings to the `user_settings` table.
 *
 * The `settings` parameter is typed via the `SyncableSettings` interface
 * which mirrors the fields from `settings.svelte.ts` defaults.
 */
export async function syncSettingsToCloud(
	supabase: SupabaseDB,
	settings: SyncableSettings
): Promise<boolean> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return false;

		const { error } = await supabase.from('user_settings').upsert(
			{
				user_id: userId,
				instrument_id: settings.instrumentId,
				default_tempo: settings.defaultTempo,
				master_volume: settings.masterVolume,
				metronome_enabled: settings.metronomeEnabled,
				metronome_volume: settings.metronomeVolume,
				backing_track_enabled: settings.backingTrackEnabled,
				backing_instrument: settings.backingInstrument,
				backing_track_volume: settings.backingTrackVolume,
				swing: settings.swing,
				theme: settings.theme,
				onboarding_complete: settings.onboardingComplete,
				tonality_override: (settings.tonalityOverride ?? null) as Json,
				highest_note: settings.highestNote ?? null,
				backing_style: settings.backingStyle,
				bleed_filter_enabled: settings.bleedFilterEnabled,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			console.warn('Failed to sync settings to cloud:', error);
			return false;
		}
		return true;
	} catch (error) {
		console.warn('Failed to sync settings to cloud:', error);
		return false;
	}
}

/**
 * Fetch user settings from the `user_settings` table.
 *
 * Tri-state (see CloudLoad): `error` on auth/query failure (caller keeps local,
 * does NOT clobber), `empty` when no row (new account), `ok` with camelCase
 * values matching the Settings interface.
 */
export async function loadSettingsFromCloud(
	supabase: SupabaseDB
): Promise<CloudLoad<Record<string, unknown>>> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return { status: 'error' };

		const { data, error } = await supabase
			.from('user_settings')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();

		if (error) {
			console.warn('Failed to load settings from cloud:', error);
			return { status: 'error' };
		}
		if (!data) return { status: 'empty' };

		return {
			status: 'ok',
			data: {
				instrumentId: data.instrument_id,
				defaultTempo: data.default_tempo,
				masterVolume: data.master_volume,
				metronomeEnabled: data.metronome_enabled,
				metronomeVolume: data.metronome_volume,
				backingTrackEnabled: data.backing_track_enabled ?? true,
				backingInstrument: data.backing_instrument ?? 'piano',
				backingTrackVolume: data.backing_track_volume ?? 0.6,
				swing: data.swing,
				theme: data.theme,
				onboardingComplete: data.onboarding_complete,
				tonalityOverride: isValidTonality(data.tonality_override) ? data.tonality_override : null,
				highestNote: data.highest_note ?? null,
				backingStyle: data.backing_style ?? 'swing',
				bleedFilterEnabled: data.bleed_filter_enabled ?? false
			}
		};
	} catch (error) {
		console.warn('Failed to load settings from cloud:', error);
		return { status: 'error' };
	}
}

// ═════════════════════════════════════════════════════════════════════
//  Tour state sync
// ═════════════════════════════════════════════════════════════════════

/**
 * Shape of the `tour_state` JSONB column on user_settings.
 * Both arrays are deduplicated lists of tour identifiers.
 */
export interface SyncableTourState {
	completed: string[];
	dismissed: string[];
}

/**
 * Upsert tour completion state into the user_settings.tour_state column.
 *
 * Uses a partial upsert keyed on user_id so we don't clobber the rest of the
 * settings row. If the user has no settings row yet (rare — onboarding writes
 * one), the upsert creates a default-row with only tour_state populated.
 */
export async function syncTourStateToCloud(
	supabase: SupabaseDB,
	state: SyncableTourState
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		// Tour completion is a set, not a snapshot: completing tour A on one
		// device while another device completes tour B should produce the
		// union, not whichever wrote last. Read remote first and merge before
		// upserting.
		const remote = await loadTourStateFromCloud(supabase);
		const merged: SyncableTourState = {
			completed: [...new Set([...(remote?.completed ?? []), ...state.completed])],
			dismissed: [...new Set([...(remote?.dismissed ?? []), ...state.dismissed])]
		};

		const { error } = await supabase.from('user_settings').upsert(
			{
				user_id: userId,
				tour_state: merged as unknown as Json,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			console.warn('Failed to sync tour state to cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to sync tour state to cloud:', error);
	}
}

/**
 * Fetch tour completion state for the current user.
 * Returns null when unauthenticated, or an empty object when the column has
 * never been written.
 */
export async function loadTourStateFromCloud(
	supabase: SupabaseDB
): Promise<SyncableTourState | null> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return null;

		const { data, error } = await supabase
			.from('user_settings')
			.select('tour_state')
			.eq('user_id', userId)
			.maybeSingle();

		if (error) {
			console.warn('Failed to load tour state from cloud:', error);
			return null;
		}
		if (!data) return null;

		const raw = data.tour_state as unknown;
		if (!raw || typeof raw !== 'object') return { completed: [], dismissed: [] };
		const obj = raw as Record<string, unknown>;
		const completed = Array.isArray(obj.completed)
			? (obj.completed.filter((v) => typeof v === 'string') as string[])
			: [];
		const dismissed = Array.isArray(obj.dismissed)
			? (obj.dismissed.filter((v) => typeof v === 'string') as string[])
			: [];
		return { completed, dismissed };
	} catch (error) {
		console.warn('Failed to load tour state from cloud:', error);
		return null;
	}
}

/**
 * REPLACE the cloud tour_state with an empty set — the deliberate destructive
 * path for `resetTours`. `syncTourStateToCloud` unions with the remote row, so
 * pushing a cleared set through it would be a no-op; this overwrites instead.
 */
export async function clearTourStateInCloud(supabase: SupabaseDB): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const empty: SyncableTourState = { completed: [], dismissed: [] };
		const { error } = await supabase.from('user_settings').upsert(
			{
				user_id: userId,
				tour_state: empty as unknown as Json,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			console.warn('Failed to clear tour state in cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to clear tour state in cloud:', error);
	}
}

// ═════════════════════════════════════════════════════════════════════
//  User licks sync
// ═════════════════════════════════════════════════════════════════════

/**
 * Sync the full set of user-recorded licks to the `user_licks` table.
 *
 * Each `Phrase` object is mapped from camelCase TypeScript fields to
 * the snake_case database columns.  Complex nested objects (notes,
 * harmony, difficulty) are stored as JSONB.
 */
export async function syncUserLicksToCloud(
	supabase: SupabaseDB,
	licks: Phrase[]
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;
		if (licks.length === 0) return;

		const toRow = (lick: Phrase) => ({
			id: lick.id,
			user_id: userId,
			name: lick.name,
			key: lick.key as string,
			time_signature: lick.timeSignature as number[],
			notes: lick.notes as unknown as Json,
			harmony: lick.harmony as unknown as Json,
			difficulty: lick.difficulty as unknown as Json,
			category: lick.category as string,
			tags: lick.tags,
			source: lick.source as string,
			audio_url: null as string | null,
			updated_at: new Date().toISOString()
		});

		// Discover which local IDs already exist in the cloud and belong to us.
		// The SELECT policy on user_licks is open to any authenticated user
		// (migration 00013, for community browse), so we must filter by user_id
		// ourselves — otherwise a collision with another user's lick id would be
		// misclassified as owned, and the ON CONFLICT DO UPDATE path would fail
		// the RLS USING policy with error 42501.
		const ids = licks.map((l) => l.id);
		const { data: existing, error: selectError } = await supabase
			.from('user_licks')
			.select('id')
			.eq('user_id', userId)
			.in('id', ids);
		if (selectError) {
			console.warn('Failed to check existing licks for sync:', selectError);
			return;
		}
		const ownedIds = new Set((existing ?? []).map((r) => r.id));

		const ownedRows: ReturnType<typeof toRow>[] = [];
		const unknownRows: ReturnType<typeof toRow>[] = [];
		for (const lick of licks) {
			(ownedIds.has(lick.id) ? ownedRows : unknownRows).push(toRow(lick));
		}

		// Owned rows: normal upsert — UPDATE is safe because we own them, and
		// this is how offline edits get flushed to the cloud at startup.
		if (ownedRows.length > 0) {
			const { error } = await supabase
				.from('user_licks')
				.upsert(ownedRows, { onConflict: 'id' });
			if (error) {
				console.warn('Failed to sync owned user licks to cloud:', error);
			}
		}

		// Unknown rows: either truly new (INSERT) or IDs already taken by
		// another user. Use ignoreDuplicates so conflicts become DO NOTHING —
		// this avoids engaging the RLS USING policy on rows we don't own.
		if (unknownRows.length > 0) {
			const { error } = await supabase
				.from('user_licks')
				.upsert(unknownRows, { onConflict: 'id', ignoreDuplicates: true });
			if (error) {
				console.warn('Failed to insert new user licks to cloud:', error);
			}
		}
	} catch (error) {
		console.warn('Failed to sync user licks to cloud:', error);
	}
}

// ═════════════════════════════════════════════════════════════════════
//  Audio recording sync (Supabase Storage)
// ═════════════════════════════════════════════════════════════════════

/**
 * Upload an audio recording blob to the Supabase Storage `recordings`
 * bucket.
 *
 * Files are stored under the path `{userId}/{sessionId}.webm` so each
 * user's recordings are namespaced and individually addressable.
 */
export async function uploadRecording(
	supabase: SupabaseDB,
	sessionId: string,
	blob: Blob
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		if (!SAFE_ID_RE.test(sessionId)) {
			console.warn('Invalid sessionId for upload — rejected:', sessionId);
			return;
		}

		const path = `${userId}/${sessionId}.webm`;
		const { error } = await supabase.storage
			.from('recordings')
			.upload(path, blob, { contentType: 'audio/webm', upsert: true });

		if (error) {
			console.warn('Failed to upload recording to cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to upload recording to cloud:', error);
	}
}

/**
 * Download an audio recording blob from the Supabase Storage `recordings`
 * bucket.
 *
 * Returns `null` when the user is unauthenticated, the file does not
 * exist, or a network error occurs.
 */
export async function downloadRecording(
	supabase: SupabaseDB,
	sessionId: string
): Promise<Blob | null> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return null;

		if (!SAFE_ID_RE.test(sessionId)) {
			console.warn('Invalid sessionId for download — rejected:', sessionId);
			return null;
		}

		const path = `${userId}/${sessionId}.webm`;
		const { data, error } = await supabase.storage
			.from('recordings')
			.download(path);

		if (error) {
			console.warn('Failed to download recording from cloud:', error);
			return null;
		}

		return data;
	} catch (error) {
		console.warn('Failed to download recording from cloud:', error);
		return null;
	}
}

/**
 * Delete every recording blob under `recordings/{userId}/` — called from the
 * "reset everything" path so cloud audio isn't orphaned. Paginated by ALWAYS
 * listing offset 0 (each pass deletes what it listed, so the folder shrinks to
 * empty), with a pass cap + break-on-error to avoid an infinite re-list.
 */
export async function deleteAllRecordingsFromCloud(supabase: SupabaseDB): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const PAGE_SIZE = 100;
		const MAX_PASSES = 1000;
		for (let pass = 0; pass < MAX_PASSES; pass++) {
			const { data: files, error: listError } = await supabase.storage
				.from('recordings')
				.list(userId, { limit: PAGE_SIZE, offset: 0 });
			if (listError) {
				console.warn('Failed to list recordings for deletion:', listError);
				return;
			}
			if (!files || files.length === 0) return;
			const paths = files.map((f) => `${userId}/${f.name}`);
			const { error: removeError } = await supabase.storage.from('recordings').remove(paths);
			if (removeError) {
				console.warn('Failed to remove recordings from cloud:', removeError);
				return;
			}
		}
	} catch (error) {
		console.warn('Failed to delete recordings from cloud:', error);
	}
}

// ═════════════════════════════════════════════════════════════════════
//  Lick practice metadata sync
// ═════════════════════════════════════════════════════════════════════

/** Shape of the JSONB columns in user_lick_metadata. */
export interface LickMetadata {
	lickTags: Record<string, string[]>;
	practiceProgress: LickPracticeProgress;
	tagOverrides: Record<string, string[]>;
	categoryOverrides: Record<string, PhraseCategory>;
	unlockCounts: Record<string, number>;
	progressHistory: LickProgressHistory;
}

/**
 * Upsert the FULL lick-metadata row (all blobs + the per-entry merge_meta).
 *
 * This is the merge-aware write path: callers first read the current cloud row,
 * run `mergeLickMetadata(local, cloud)` (per-entry, non-destructive), and write
 * the merged result here — so a device can no longer replace another device's
 * entire column. Writing the whole row is safe because the merge already folded
 * in the cloud's contents.
 */
export async function upsertLickMetadataRow(
	supabase: SupabaseDB,
	data: LickMetadata,
	mergeMeta: LickMergeMeta
): Promise<void> {
	const userId = await getAuthUserId(supabase);
	if (!userId) throw new Error('not authenticated');

	const row: Database['public']['Tables']['user_lick_metadata']['Insert'] = {
		user_id: userId,
		lick_tags: data.lickTags as unknown as Json,
		practice_progress: data.practiceProgress as unknown as Json,
		tag_overrides: data.tagOverrides as unknown as Json,
		category_overrides: data.categoryOverrides as unknown as Json,
		unlock_counts: data.unlockCounts as unknown as Json,
		progress_history: data.progressHistory as unknown as Json,
		merge_meta: mergeMeta as unknown as Json,
		updated_at: new Date().toISOString()
	};

	const { error } = await supabase
		.from('user_lick_metadata')
		.upsert(row, { onConflict: 'user_id' });

	if (error) {
		// Surface to the outbox so it retries; do not silently swallow.
		throw new Error(`Failed to upsert lick metadata: ${error.message}`);
	}
}

/**
 * Result of a cloud lick-metadata load. The three states matter because
 * consumers gate destructive maintenance (orphan reconciliation, the
 * one-time progression-tag backfill) on hydration health:
 *
 *  - `ok`    — a cloud row exists and was read successfully.
 *  - `empty` — the read succeeded and there is affirmatively no row
 *              (a brand-new account). Safe to treat as hydrated.
 *  - `error` — auth could not be verified or the query failed. The local
 *              store may NOT reflect cloud truth; treating this like
 *              `empty` is what lets whole-column syncs clobber cloud data.
 */
export type LickMetadataLoadResult =
	| { status: 'ok'; data: LickMetadata; mergeMeta: LickMergeMeta }
	| { status: 'empty' }
	| { status: 'error' };

/**
 * Fetch lick practice metadata from the `user_lick_metadata` table.
 *
 * Unauthenticated / unverifiable sessions report `error` rather than
 * `empty`: callers only reach this with a session in hand, so a missing
 * user here means verification failed, not that the account has no data.
 */
export async function loadLickMetadataFromCloud(
	supabase: SupabaseDB
): Promise<LickMetadataLoadResult> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return { status: 'error' };

		const { data, error } = await supabase
			.from('user_lick_metadata')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();

		if (error) {
			console.warn('Failed to load lick metadata from cloud:', error);
			return { status: 'error' };
		}
		if (!data) return { status: 'empty' };

		const metadata: LickMetadata = {
			lickTags: (data.lick_tags ?? {}) as unknown as Record<string, string[]>,
			practiceProgress: (data.practice_progress ?? {}) as unknown as LickPracticeProgress,
			tagOverrides: (data.tag_overrides ?? {}) as unknown as Record<string, string[]>,
			categoryOverrides: (data.category_overrides ?? {}) as unknown as Record<string, PhraseCategory>,
			// `unlock_counts` is a column added in migration 00015; older cloud
			// rows (pre-migration deploy) won't have it, so coalesce missing /
			// null values to {} to keep loads resilient against schema drift.
			unlockCounts: (data.unlock_counts ?? {}) as unknown as Record<string, number>,
			// `progress_history` is a later column; coalesce for older rows too.
			progressHistory: (data.progress_history ?? {}) as unknown as LickProgressHistory
		};
		const mergeMeta = (data.merge_meta ?? {}) as unknown as LickMergeMeta;
		return { status: 'ok', data: metadata, mergeMeta };
	} catch (error) {
		console.warn('Failed to load lick metadata from cloud:', error);
		return { status: 'error' };
	}
}
