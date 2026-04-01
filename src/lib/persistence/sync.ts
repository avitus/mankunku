/**
 * Sync orchestrator module.
 *
 * Provides bidirectional synchronization functions between the local browser
 * persistence layer (localStorage / IndexedDB) and the Supabase cloud
 * database / storage.  This is the central coordination point for
 * cross-device data persistence, implementing a last-write-wins conflict
 * resolution strategy via Supabase `upsert` with `updated_at` timestamps.
 *
 * Design rules (from AAP §0.7.1):
 *  • Every function is wrapped in try/catch and logs warnings on failure.
 *  • No function ever throws — offline resilience is preserved.
 *  • Every function validates the user is authenticated via `getUser()`
 *    before attempting any cloud operation (AAP §0.7.2).
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
	CategoryProgress
} from '$lib/types/progress';
import { PITCH_CLASSES, type Phrase, type PhraseCategory, type PitchClass } from '$lib/types/music';
import type { Grade, NoteResult, TimingDiagnostics } from '$lib/types/scoring';
import { SCALE_UNLOCK_ORDER, type ScaleType } from '$lib/tonality/tonality';

// ── Type alias for convenience ───────────────────────────────────────

/** Supabase client parameterized with the Mankunku database schema. */
type SupabaseDB = SupabaseClient<Database>;

/** Minimal typed interface for settings passed to syncSettingsToCloud. */
interface SyncableSettings {
	instrumentId: string;
	defaultTempo: number;
	masterVolume: number;
	metronomeEnabled: boolean;
	metronomeVolume: number;
	swing: number;
	theme: string;
	onboardingComplete: boolean;
	tonalityOverride: unknown;
	highestNote: number | null;
}

// ── Constants ────────────────────────────────────────────────────────

/** Maximum session results to sync — matches MAX_SESSIONS in progress.svelte.ts. */
const MAX_SESSIONS = 200;

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
 * per AAP §0.7.2.
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
 *  2. `session_results`  — individual session history (capped at 200)
 *  3. `scale_proficiency` — per-scale proficiency records
 *  4. `key_proficiency`   — per-key proficiency records
 *
 * If any step fails the function logs a warning and returns without
 * propagating the error.
 */
export async function syncProgressToCloud(
	supabase: SupabaseDB,
	progress: UserProgress
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

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
			return;
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
			timestamp: s.timestamp
		}));

		if (sessionRows.length > 0) {
			const { error: sessionsError } = await supabase
				.from('session_results')
				.upsert(sessionRows, { onConflict: 'id' });

			if (sessionsError) {
				console.warn('Failed to sync session results to cloud:', sessionsError);
			} else {
				// Prune orphaned rows beyond the retained set
				const retainedIds = sessionRows.map((r) => r.id);
				const { error: pruneError } = await supabase
					.from('session_results')
					.delete()
					.eq('user_id', userId)
					.not('id', 'in', `(${retainedIds.join(',')})`);

				if (pruneError) {
					console.warn('Failed to prune old session results:', pruneError);
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
				recent_scores: prof.recentScores,
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
			}
		}

		// 4. Upsert key proficiency entries
		const keyRows = Object.entries(progress.keyProficiency)
			.filter((entry): entry is [string, KeyProficiency] => entry[1] !== undefined)
			.map(([key, prof]) => ({
				user_id: userId,
				key,
				level: prof.level,
				recent_scores: prof.recentScores,
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
			}
		}
	} catch (error) {
		console.warn('Failed to sync progress to cloud:', error);
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
 * Returns `null` when the user is unauthenticated or no cloud data exists.
 */
export async function loadProgressFromCloud(
	supabase: SupabaseDB
): Promise<UserProgress | null> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return null;

		// Fetch aggregate progress row
		const { data: progressRow, error: progressError } = await supabase
			.from('user_progress')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();

		if (progressError) {
			console.warn('Failed to load progress from cloud:', progressError);
			return null;
		}
		if (!progressRow) return null;

		// Fetch session results (newest first, capped at MAX_SESSIONS)
		const { data: sessions, error: sessionsError } = await supabase
			.from('session_results')
			.select('*')
			.eq('user_id', userId)
			.order('timestamp', { ascending: false })
			.limit(MAX_SESSIONS);

		if (sessionsError) {
			console.warn('Failed to load session results from cloud:', sessionsError);
			return null;
		}

		// Fetch per-scale proficiency rows
		const { data: scales, error: scalesError } = await supabase
			.from('scale_proficiency')
			.select('*')
			.eq('user_id', userId);

		if (scalesError) {
			console.warn('Failed to load scale proficiency from cloud:', scalesError);
			return null;
		}

		// Fetch per-key proficiency rows
		const { data: keys, error: keysError } = await supabase
			.from('key_proficiency')
			.select('*')
			.eq('user_id', userId);

		if (keysError) {
			console.warn('Failed to load key proficiency from cloud:', keysError);
			return null;
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
				recentScores: row.recent_scores,
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
				recentScores: row.recent_scores,
				attemptsAtLevel: row.attempts_at_level,
				attemptsSinceChange: row.attempts_since_change,
				totalAttempts: row.total_attempts
			};
		}

		// ── Assemble and return UserProgress ──
		return {
			adaptive: progressRow.adaptive_state as unknown as AdaptiveState,
			sessions: mappedSessions,
			categoryProgress: progressRow.category_progress as unknown as Record<string, CategoryProgress>,
			keyProgress: progressRow.key_progress as unknown as Partial<
				Record<PitchClass, { attempts: number; averageScore: number }>
			>,
			scaleProficiency,
			keyProficiency,
			totalPracticeTime: progressRow.total_practice_time,
			streakDays: progressRow.streak_days,
			lastPracticeDate: progressRow.last_practice_date
		};
	} catch (error) {
		console.warn('Failed to load progress from cloud:', error);
		return null;
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
): Promise<void> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return;

		const { error } = await supabase.from('user_settings').upsert(
			{
				user_id: userId,
				instrument_id: settings.instrumentId,
				default_tempo: settings.defaultTempo,
				master_volume: settings.masterVolume,
				metronome_enabled: settings.metronomeEnabled,
				metronome_volume: settings.metronomeVolume,
				swing: settings.swing,
				theme: settings.theme,
				onboarding_complete: settings.onboardingComplete,
				tonality_override: (settings.tonalityOverride ?? null) as Json,
				highest_note: settings.highestNote ?? null,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			console.warn('Failed to sync settings to cloud:', error);
		}
	} catch (error) {
		console.warn('Failed to sync settings to cloud:', error);
	}
}

/**
 * Fetch user settings from the `user_settings` table.
 *
 * Returns a plain object with camelCase keys matching the Settings
 * interface, or `null` if the user is unauthenticated or has no saved
 * settings.
 */
export async function loadSettingsFromCloud(
	supabase: SupabaseDB
): Promise<Record<string, unknown> | null> {
	try {
		const userId = await getAuthUserId(supabase);
		if (!userId) return null;

		const { data, error } = await supabase
			.from('user_settings')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();

		if (error) {
			console.warn('Failed to load settings from cloud:', error);
			return null;
		}
		if (!data) return null;

		return {
			instrumentId: data.instrument_id,
			defaultTempo: data.default_tempo,
			masterVolume: data.master_volume,
			metronomeEnabled: data.metronome_enabled,
			metronomeVolume: data.metronome_volume,
			swing: data.swing,
			theme: data.theme,
			onboardingComplete: data.onboarding_complete,
			tonalityOverride: isValidTonality(data.tonality_override) ? data.tonality_override : null,
			highestNote: data.highest_note ?? null
		};
	} catch (error) {
		console.warn('Failed to load settings from cloud:', error);
		return null;
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

		const rows = licks.map((lick) => ({
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
		}));

		if (rows.length > 0) {
			const { error } = await supabase
				.from('user_licks')
				.upsert(rows, { onConflict: 'id' });

			if (error) {
				console.warn('Failed to sync user licks to cloud:', error);
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
