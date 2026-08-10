/**
 * Trick (melodic-device) practice persistence.
 *
 * Mirrors the lick-practice-store idioms — immutable update helpers over a
 * plain progress record, per-variant unlock counts, an append-only capped
 * history — but stays deliberately SIMPLE (single-user app): all cloud state
 * lives in ONE JSONB column (`user_settings.trick_state`) synced through the
 * durable outbox (kind 'trickState'), merged per-field by `mergeTrickState`
 * in sync.ts. No per-record mtimes, no tombstones.
 *
 * Progress is keyed by the composite variant key
 * `${trickId}:${normalizeParameterSignature(params)}` (types/tricks.ts),
 * never by a generated preview phrase id.
 */

import type { PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type {
	TrickPracticeKeyProgress,
	TrickPracticeProgress,
	TrickProgressHistory,
	TrickProgressPoint
} from '$lib/types/tricks';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { save, load } from './storage';
import {
	loadTrickStateFromCloud,
	syncTrickStateToCloud,
	mergeTrickState,
	type SyncableTrickState
} from './sync';
import { getScopeGeneration } from './user-scope';
import { enqueue } from './outbox';
import { MAX_HISTORY_POINTS } from './limits';
import { MAX_UNLOCKED_KEYS } from '$lib/music/key-ordering';

const PROGRESS_KEY = 'trick-practice-progress';
const HISTORY_KEY = 'trick-progress-history';
const UNLOCK_KEY = 'trick-unlock-count';
const SELECTED_KEY = 'trick-selected-variants';
/** Wall-clock ms of the last local selection edit — the LWW clock for
 *  `selectedVariants` in the cloud merge (union would resurrect deselections). */
const SELECTED_MTIME_KEY = 'trick-selected-variants-mtime';
/** One-time migration markers (string[]) — kept OUTSIDE the other blobs and
 *  always unioned by the cloud merge, so a completed migration never replays. */
const MIGRATIONS_KEY = 'trick-migrations';

/** Starting BPM for any trick variant with no prior practice history. */
export const TRICK_DEFAULT_TEMPO = 60;

// ── Practice progress ────────────────────────────────────────────────────────

export function loadTrickPracticeProgress(): TrickPracticeProgress {
	return load<TrickPracticeProgress>(PROGRESS_KEY) ?? {};
}

export function saveTrickPracticeProgress(p: TrickPracticeProgress): void {
	save(PROGRESS_KEY, p);
	enqueue('trickState');
}

export function getTrickKeyProgress(
	p: TrickPracticeProgress,
	variantKey: string,
	key: PitchClass
): TrickPracticeKeyProgress {
	return (
		p[variantKey]?.[key] ?? {
			currentTempo: TRICK_DEFAULT_TEMPO,
			lastPracticedAt: 0,
			passCount: 0
		}
	);
}

/** Immutable per-(variant, key) update — returns a new progress object. */
export function updateTrickKeyProgress(
	p: TrickPracticeProgress,
	variantKey: string,
	key: PitchClass,
	update: Partial<TrickPracticeKeyProgress>
): TrickPracticeProgress {
	const existing = getTrickKeyProgress(p, variantKey, key);
	return {
		...p,
		[variantKey]: {
			...p[variantKey],
			[key]: { ...existing, ...update }
		}
	};
}

/**
 * Minimum tempo across a variant's canonical keys (used for session tempo).
 * Restricted to the 12 canonical `PITCH_CLASSES` spellings so a legacy or
 * corrupt non-canonical entry can never pin the tempo (same rationale as
 * `getLickTempo` — the Honeysuckle-Rose 100 BPM plateau class of bug).
 */
export function getTrickTempo(p: TrickPracticeProgress, variantKey: string): number {
	const keyProgress = p[variantKey];
	if (!keyProgress) return TRICK_DEFAULT_TEMPO;
	const tempos = PITCH_CLASSES.map((k) => keyProgress[k]?.currentTempo).filter(
		(t): t is number => typeof t === 'number'
	);
	return tempos.length > 0 ? Math.min(...tempos) : TRICK_DEFAULT_TEMPO;
}

/** Most recent lastPracticedAt across all keys for a variant (for sorting). */
export function getTrickLastPracticed(p: TrickPracticeProgress, variantKey: string): number {
	const keyProgress = p[variantKey];
	if (!keyProgress) return 0;
	const times = Object.values(keyProgress).map((kp) => kp?.lastPracticedAt ?? 0);
	return times.length > 0 ? Math.max(...times) : 0;
}

/** Whether a variant has any stored per-key progress. */
export function hasTrickProgress(p: TrickPracticeProgress, variantKey: string): boolean {
	return !!p[variantKey] && Object.keys(p[variantKey]!).length > 0;
}

/** Sum of passCount across all of a variant's keys (drives mastery unlocks). */
export function totalTrickPasses(p: TrickPracticeProgress, variantKey: string): number {
	const keyProgress = p[variantKey];
	if (!keyProgress) return 0;
	return Object.values(keyProgress).reduce((sum, kp) => sum + (kp?.passCount ?? 0), 0);
}

// ── Unlocked-key count ───────────────────────────────────────────────────────

/**
 * Type guard for the unlock-counts shape — `load<T>()` is only a cast, so a
 * corrupt primitive would otherwise be mutated like an object and throw.
 */
function isUnlockCountMap(value: unknown): value is Record<string, number> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadTrickUnlockCounts(): Record<string, number> {
	const raw = load<unknown>(UNLOCK_KEY);
	return isUnlockCountMap(raw) ? raw : {};
}

/**
 * Clamp a stored unlock count to [1, MAX_UNLOCKED_KEYS]. Truncate before
 * clamping so a corrupt fractional value can't drift with each bump, and gate
 * on Number.isFinite because Math.max(1, NaN) is NaN.
 */
function resolveTrickUnlockCount(counts: Record<string, number>, variantKey: string): number {
	const stored = counts[variantKey];
	if (typeof stored === 'number' && Number.isFinite(stored)) {
		return Math.min(MAX_UNLOCKED_KEYS, Math.max(1, Math.trunc(stored)));
	}
	return 1;
}

/** Unlocked-key count for a variant — clamped to [1, 12], default 1. */
export function getTrickUnlockedKeyCount(variantKey: string): number {
	return resolveTrickUnlockCount(loadTrickUnlockCounts(), variantKey);
}

/** Bump the unlock count by 1, capped at 12. Persists + enqueues. Returns the new count. */
export function bumpTrickUnlockedKeyCount(variantKey: string): number {
	const counts = loadTrickUnlockCounts();
	const next = Math.min(MAX_UNLOCKED_KEYS, resolveTrickUnlockCount(counts, variantKey) + 1);
	counts[variantKey] = next;
	save(UNLOCK_KEY, counts);
	enqueue('trickState');
	return next;
}

// ── Progress history (per-variant BPM / keys-unlocked time series) ───────────

export function loadTrickProgressHistory(): TrickProgressHistory {
	return load<TrickProgressHistory>(HISTORY_KEY) ?? {};
}

/** All progress-history points for a variant, sorted oldest→newest. */
export function getTrickProgressHistory(variantKey: string): TrickProgressPoint[] {
	const points = loadTrickProgressHistory()[variantKey] ?? [];
	return [...points].sort((a, b) => a.t - b.t);
}

/**
 * Append one progress-history sample for a variant. Idempotent on the
 * timestamp `t` (a replayed write is a no-op), sorted, capped at
 * MAX_HISTORY_POINTS (oldest dropped). Persists + enqueues.
 */
export function appendTrickProgressPoint(variantKey: string, point: TrickProgressPoint): void {
	const history = loadTrickProgressHistory();
	const existing = history[variantKey] ?? [];
	if (existing.some((p) => p.t === point.t)) return;
	const next = [...existing, point].sort((a, b) => a.t - b.t);
	history[variantKey] =
		next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
	save(HISTORY_KEY, history);
	enqueue('trickState');
}

// ── Selected variants ────────────────────────────────────────────────────────

export function loadSelectedTrickVariants(): string[] {
	const raw = load<unknown>(SELECTED_KEY);
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function saveSelectedTrickVariants(ids: string[]): void {
	save(SELECTED_KEY, [...new Set(ids)]);
	save(SELECTED_MTIME_KEY, Date.now());
	enqueue('trickState');
}

/** Timestamp of the last local selection edit — 0 when never stamped. */
function loadSelectedTrickVariantsMtime(): number {
	const raw = load<unknown>(SELECTED_MTIME_KEY);
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

// ── Migration markers ────────────────────────────────────────────────────────

function loadTrickMigrationMarkers(): string[] {
	const raw = load<unknown>(MIGRATIONS_KEY);
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export function hasTrickMigrationMarker(name: string): boolean {
	return loadTrickMigrationMarkers().includes(name);
}

export function addTrickMigrationMarker(name: string): void {
	const markers = loadTrickMigrationMarkers();
	if (markers.includes(name)) return;
	save(MIGRATIONS_KEY, [...markers, name]);
	enqueue('trickState');
}

// ── Cloud sync (one JSONB blob, merged per-field) ────────────────────────────

/** Snapshot the current local trick state as one syncable blob. */
function snapshotLocalTrickState(): SyncableTrickState {
	return {
		selectedVariants: loadSelectedTrickVariants(),
		selectedUpdatedAt: loadSelectedTrickVariantsMtime(),
		migrations: loadTrickMigrationMarkers(),
		progress: loadTrickPracticeProgress(),
		unlockCounts: loadTrickUnlockCounts(),
		history: loadTrickProgressHistory()
	};
}

/** Persist a merged blob back into the local keys (no enqueue — callers push). */
function saveLocalTrickState(state: SyncableTrickState): void {
	save(SELECTED_KEY, state.selectedVariants);
	save(SELECTED_MTIME_KEY, state.selectedUpdatedAt);
	save(MIGRATIONS_KEY, state.migrations);
	save(PROGRESS_KEY, state.progress);
	save(UNLOCK_KEY, state.unlockCounts);
	save(HISTORY_KEY, state.history);
}

function emptyTrickState(): SyncableTrickState {
	return {
		selectedVariants: [],
		selectedUpdatedAt: 0,
		migrations: [],
		progress: {},
		unlockCounts: {},
		history: {}
	};
}

/**
 * Hydrate trick state from the cloud: load remote → merge (non-destructive,
 * per-field rules in mergeTrickState) → save merged locally → push the merged
 * superset back so both sides converge.
 *
 * Returns `true` when the local merge completed (a failed push is queued to
 * the outbox and does not fail hydration) and `false` when the read/merge
 * could not complete (a `'error'` read, or a user switch mid-flight) — an
 * errored read must NOT push, or a merge-against-empty could clobber the
 * cloud column.
 */
export async function initTrickStateFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	const gen = getScopeGeneration();
	try {
		const remote = await loadTrickStateFromCloud(supabase);
		if (remote.status === 'error') return false; // cloud truth unknown — do not merge or push
		if (gen !== getScopeGeneration()) return false; // user switched mid-flight
		const merged = mergeTrickState(
			snapshotLocalTrickState(),
			remote.status === 'ok' ? remote.data : emptyTrickState()
		);
		if (gen !== getScopeGeneration()) return false;
		saveLocalTrickState(merged);
		try {
			await syncTrickStateToCloud(supabase, merged);
		} catch {
			// Push failed (offline / unauthenticated) — hydration itself succeeded;
			// queue a durable retry instead of failing the init.
			enqueue('trickState');
		}
		return true;
	} catch (error) {
		console.warn('Failed to hydrate trick state from cloud:', error);
		return false;
	}
}

/**
 * Outbox flush handler (kind 'trickState'): read the cloud row, merge local
 * into it, save the merged result locally AND upsert it back — both sides
 * converge. MUST throw on push failure OR on a failed read so the outbox
 * backs off and retries (`syncTrickStateToCloud` throws; do not swallow
 * here). A `'error'` read never merges against empty — that is the
 * read-failure clobber window the tri-state exists to close.
 */
export async function flushTrickStateToCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	// Bind the whole flush to one account scope (same defensive guard as
	// flushLickMetadataToCloud): abort after each await if the user switched,
	// so the read-merge-write can't straddle two accounts.
	const gen = getScopeGeneration();
	const remote = await loadTrickStateFromCloud(supabase);
	if (gen !== getScopeGeneration()) return; // user switched mid-flight
	if (remote.status === 'error') throw new Error('trick state read failed — deferring push');
	const merged = mergeTrickState(
		snapshotLocalTrickState(),
		remote.status === 'ok' ? remote.data : emptyTrickState()
	);
	if (gen !== getScopeGeneration()) return; // switched during merge — do not persist/push
	saveLocalTrickState(merged);
	await syncTrickStateToCloud(supabase, merged);
}
