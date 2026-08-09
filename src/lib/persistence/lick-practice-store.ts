import type { PitchClass, PhraseCategory } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type {
	LickPracticeProgress,
	LickPracticeKeyProgress,
	ChordProgressionType,
	LickProgressPoint,
	LickProgressHistory
} from '$lib/types/lick-practice';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { save, load } from './storage';
import { loadLickMetadataFromCloud, upsertLickMetadataRow, type LickMetadata } from './sync';
import { getScopeGeneration } from './user-scope';
import { enqueue } from './outbox';
import { mergeLickMetadata, type LickMergeMeta, type LickMetaBundle } from './lick-metadata-merge';
import { getLickTagOverrides } from './user-licks';
import { loadLickPracticeSessions } from './lick-practice-sessions';
import { MAX_HISTORY_POINTS } from './limits';
import { MAX_UNLOCKED_KEYS } from '$lib/music/key-ordering';

const STORAGE_KEY = 'lick-practice-progress';
const TAGS_KEY = 'user-lick-tags';
const UNLOCK_KEY = 'lick-unlock-count';
const CATEGORY_OVERRIDES_KEY = 'lick-category-overrides';
const TAG_OVERRIDES_KEY = 'lick-tag-overrides';
/** Per-entry merge metadata (mtimes + reset tombstones) for cross-device merge. */
const MERGE_META_KEY = 'lick-merge-meta';
/** Per-lick append-only BPM/keys-unlocked time series (powers the detail-page graph). */
const HISTORY_KEY = 'lick-progress-history';
const DEFAULT_TEMPO = 100;
/** Starting BPM for any lick with no prior practice history. */
export const NEW_LICK_DEFAULT_TEMPO = 60;
const MIN_TEMPO = 50;
const MAX_TEMPO = 300;
const PROG_TAG_PREFIX = 'prog:';
/**
 * Tombstone marker for a deliberate "remove from practice set" action.
 *
 * Distinguishes "user explicitly removed practice" (the entry contains
 * this sentinel) from "user touched the lick for some other reason but
 * never set a practice decision" (the entry exists with neither this
 * sentinel nor 'practice'). Without it, a curated lick with `lick.tags`
 * `['practice']` whose user toggles a `prog:*` tag first would have
 * `tags[id] = ['prog:X']`, which absent this distinction reads as
 * "explicit removal" and would silently drop the lick from `/lick-practice`.
 */
const PRACTICE_REMOVED_TAG = 'practice:removed';


/**
 * Score at or above which a key is considered "proficient" — drives the
 * green tier in the UI, increments `passCount`, and matches the avg gate
 * for tempo bumps and unlocks. Single source of truth for the proficiency
 * bar: `UNLOCK_AVG_THRESHOLD` and the `PASS_THRESHOLD` alias both derive
 * from this constant.
 */
export const KEY_PROFICIENT_THRESHOLD = 0.9;

/**
 * Worst-key floor. If any played key in a session scores below this,
 * `startInterLickTransition` blocks both tempo increases and the
 * next-key unlock — the user has to bring the weak key up before adding
 * speed or scope. Tempo decreases are still allowed.
 */
export const KEY_FLOOR_THRESHOLD = 0.75;

/**
 * Minimum average session score required to unlock the next key. Derived
 * from `KEY_PROFICIENT_THRESHOLD` so the avg gate stays locked to the
 * green-tier bar. Unlocks fire only when the session is proficient AND
 * the most-recently-unlocked key has consolidated (passCount) AND no
 * played key fell below `KEY_FLOOR_THRESHOLD` — the floor check lives in
 * `startInterLickTransition`, not here.
 */
export const UNLOCK_AVG_THRESHOLD = KEY_PROFICIENT_THRESHOLD;

/**
 * Number of qualifying per-key sessions (each scoring at or above
 * `PASS_THRESHOLD`) the most-recently-unlocked key must accumulate before
 * the next key joins the rotation. Pairs with `UNLOCK_AVG_THRESHOLD` to
 * gate unlocks on both session quality and per-key consolidation.
 */
export const UNLOCK_PASSES_REQUIRED = 3;

/**
 * EWMA weight of the NEWEST attempt in a key's `rollingScore`. At 0.4 a
 * single result moves the average noticeably (a struggling key surfaces
 * within a round or two) while one fluke can't erase a solid history.
 * Cross-device note: the per-(lick,key) cloud merge is LWW, so each
 * device's EWMA reflects only the attempts it saw since the last sync —
 * an accepted approximation, since the next few attempts re-converge it.
 */
export const ROLLING_SCORE_ALPHA = 0.4;

/**
 * Fold one attempt score (0-1) into a key's rolling EWMA. Seeds with the
 * first score when no prior value exists.
 */
export function updateRollingScore(
	prev: number | undefined,
	score: number,
	alpha: number = ROLLING_SCORE_ALPHA
): number {
	if (prev === undefined) return score;
	return alpha * score + (1 - alpha) * prev;
}

/**
 * Read a key's rolling score. Undefined when the key has never been
 * attempted on this device (or its entry predates the field) — callers
 * treat unknown as "needs work" so unfamiliar keys rank worst.
 */
export function getRollingScore(
	progress: LickPracticeProgress,
	phraseId: string,
	key: PitchClass
): number | undefined {
	return progress[phraseId]?.[key]?.rollingScore;
}

/**
 * Module-level Supabase reference, set during cloud hydration.
 * Used by write functions that don't receive a client parameter directly
 * (e.g. saveLickPracticeProgress called from session state).
 */
let _supabase: SupabaseClient<Database> | null = null;

/**
 * Hydrate all four lick metadata stores from the cloud.
 *
 * Called once during app startup (layout.ts). For each store, cloud data
 * populates localStorage only when the local store is empty (new device).
 * Sets the module-level `_supabase` reference for fire-and-forget sync
 * in subsequent write operations.
 *
 * Returns `true` when hydration completed (including the affirmative
 * "no cloud row yet" case for brand-new accounts) and `false` when it
 * could not verify cloud state (auth/network/query failure, or a user
 * switch mid-flight).
 */
export async function initLickMetadataFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	_supabase = supabase;
	const gen = getScopeGeneration();
	try {
		const result = await loadLickMetadataFromCloud(supabase);
		if (result.status === 'error') return false;
		if (gen !== getScopeGeneration()) return false; // User switched mid-flight

		// Per-entry merge (cross-device, non-destructive). Both sides converge:
		// the reserved `__migrations` marker is always unioned (never lost),
		// per-id tags/overrides/unlocks resolve by client mtime, and
		// practice_progress unions per (lick, key) by lastPracticedAt with reset
		// tombstones. Replaces the old "only overwrite empty local" hydration
		// that let a stale device's later write clobber the cloud column.
		//
		// An EMPTY cloud (brand-new account) is treated as an empty cloud bundle:
		// merging leaves local intact and the enqueue below pushes it up, so a
		// device with existing local metadata seeds the fresh cloud row without
		// waiting for the user's next tag edit.
		const cloudBundle: LickMetaBundle =
			result.status === 'ok'
				? { data: result.data as unknown as LickMetaBundle['data'], mergeMeta: result.mergeMeta }
				: { data: emptyMetaData(), mergeMeta: {} };
		const merged = mergeLickMetadata(currentLocalBundle(), cloudBundle);
		if (gen !== getScopeGeneration()) return false;
		saveLocalBundle(merged);
		// Push the merged superset back so the cloud converges (coalesced).
		enqueue('lickMeta');
		return true;
	} catch (error) {
		console.warn('Failed to hydrate lick metadata from cloud:', error);
		return false;
	}
}

// ── Per-entry merge metadata + cloud sync ───────────────────────────────────
//
// All lick-metadata cloud writes now go through the durable outbox (kind
// 'lickMeta') and the merge-aware `flushLickMetadataToCloud`, which reads the
// current cloud row, folds local into it per lick id (mergeLickMetadata), and
// writes the merged result back. This replaces the old per-column debounced
// whole-column pushes that could clobber another device's data. Writes stamp a
// per-id mtime in the local merge_meta so LWW-per-id is possible.

function loadMergeMeta(): LickMergeMeta {
	return load<LickMergeMeta>(MERGE_META_KEY) ?? {};
}

function saveMergeMeta(meta: LickMergeMeta): void {
	save(MERGE_META_KEY, meta);
}

type MergeMetaBucket = 'tags' | 'overrides' | 'catOverrides' | 'unlockMtime' | 'progressResets';

function stampMergeMeta(bucket: MergeMetaBucket, id: string): void {
	const meta = loadMergeMeta();
	const map = (meta[bucket] ??= {});
	map[id] = Date.now();
	saveMergeMeta(meta);
}

/** Snapshot the current local metadata blobs as a merge bundle. */
function currentLocalBundle(): LickMetaBundle {
	return {
		data: {
			lickTags: loadUserLickTags(),
			practiceProgress: loadLickPracticeProgress() as LickMetaBundle['data']['practiceProgress'],
			tagOverrides: load<Record<string, string[]>>(TAG_OVERRIDES_KEY) ?? {},
			categoryOverrides: (load<Record<string, string>>(CATEGORY_OVERRIDES_KEY) ?? {}),
			unlockCounts: loadUnlockCounts(),
			progressHistory: loadLickProgressHistory()
		},
		mergeMeta: loadMergeMeta()
	};
}

/** Persist a merged bundle back into the local blobs + merge_meta. */
function saveLocalBundle(bundle: LickMetaBundle): void {
	save(TAGS_KEY, bundle.data.lickTags);
	save(STORAGE_KEY, bundle.data.practiceProgress);
	save(TAG_OVERRIDES_KEY, bundle.data.tagOverrides);
	save(CATEGORY_OVERRIDES_KEY, bundle.data.categoryOverrides);
	save(UNLOCK_KEY, bundle.data.unlockCounts);
	save(HISTORY_KEY, bundle.data.progressHistory);
	saveMergeMeta(bundle.mergeMeta);
}

/** Queue a durable cloud sync of the lick metadata (coalesced by the outbox). */
function syncLickTagsToCloud(): void {
	enqueue('lickMeta');
}
function syncPracticeProgressToCloud(): void {
	enqueue('lickMeta');
}
function syncUnlockCountsToCloud(): void {
	enqueue('lickMeta');
}

/**
 * Outbox flush handler: read the cloud row, merge local into it per lick id,
 * write the merged result back AND save it locally (both sides converge).
 * Throws on failure so the outbox retries.
 */
export async function flushLickMetadataToCloud(supabase: SupabaseClient<Database>): Promise<void> {
	// Bind the whole flush to one account scope. A user switch triggers a full
	// page reload (reconcileActiveUser), but that isn't instantaneous — so guard
	// defensively: capture the scope generation up front and abort after each
	// await if it changed, or the read-merge-write could straddle two accounts
	// (read cloud for the new user, merge with the old user's local, and upsert
	// the mix under the new auth context).
	const gen = getScopeGeneration();
	const cloud = await loadLickMetadataFromCloud(supabase);
	if (gen !== getScopeGeneration()) return; // user switched mid-flight
	if (cloud.status === 'error') throw new Error('lick metadata hydration failed — deferring push');
	const cloudBundle: LickMetaBundle =
		cloud.status === 'ok'
			? { data: cloud.data as unknown as LickMetaBundle['data'], mergeMeta: cloud.mergeMeta }
			: { data: emptyMetaData(), mergeMeta: {} };
	const merged = mergeLickMetadata(currentLocalBundle(), cloudBundle);
	if (gen !== getScopeGeneration()) return; // switched during merge — do not persist/push
	saveLocalBundle(merged);
	await upsertLickMetadataRow(
		supabase,
		merged.data as unknown as LickMetadata,
		merged.mergeMeta
	);
}

function emptyMetaData(): LickMetaBundle['data'] {
	return { lickTags: {}, practiceProgress: {}, tagOverrides: {}, categoryOverrides: {}, unlockCounts: {}, progressHistory: {} };
}

export function loadLickPracticeProgress(): LickPracticeProgress {
	return load<LickPracticeProgress>(STORAGE_KEY) ?? {};
}

export function saveLickPracticeProgress(progress: LickPracticeProgress): void {
	save(STORAGE_KEY, progress);
	syncPracticeProgressToCloud();
}

export function getKeyProgress(
	progress: LickPracticeProgress,
	phraseId: string,
	key: PitchClass
): LickPracticeKeyProgress {
	return progress[phraseId]?.[key] ?? {
		currentTempo: DEFAULT_TEMPO,
		lastPracticedAt: 0,
		passCount: 0
	};
}

export function updateKeyProgress(
	progress: LickPracticeProgress,
	phraseId: string,
	key: PitchClass,
	update: Partial<LickPracticeKeyProgress>
): LickPracticeProgress {
	const existing = getKeyProgress(progress, phraseId, key);
	return {
		...progress,
		[phraseId]: {
			...progress[phraseId],
			[key]: { ...existing, ...update }
		}
	};
}

/** Remove a lick's entire per-key progress (immutable). */
export function clearLickProgress(
	progress: LickPracticeProgress,
	phraseId: string
): LickPracticeProgress {
	if (!(phraseId in progress)) return progress;
	const { [phraseId]: _removed, ...rest } = progress;
	return rest;
}

/**
 * Get the minimum tempo across a lick's 12 canonical keys (used for session tempo).
 *
 * Only the 12 canonical `PitchClass` spellings are ever written by the app
 * (every writer draws its key set from `PITCH_CLASSES` / the circle helpers,
 * whose sole sharp is `F#`). A legacy or imported non-canonical entry — e.g.
 * an all-flats `Gb` left in the store by an older build, stranded at the old
 * `DEFAULT_TEMPO` of 100 — can never be reached by `recordKeyAttempt` or the
 * end-of-lick tempo bump. Left in an unfiltered `Math.min`, such a phantom key
 * pins the whole lick's session tempo at its stale value forever, silently
 * cancelling every tempo advance (see the Honeysuckle-Rose 100 BPM plateau).
 * Restricting the min to canonical keys makes any phantom inert.
 */
export function getLickTempo(progress: LickPracticeProgress, phraseId: string): number {
	const keyProgress = progress[phraseId];
	if (!keyProgress) return DEFAULT_TEMPO;
	const tempos = PITCH_CLASSES
		.map(k => keyProgress[k]?.currentTempo)
		.filter((t): t is number => typeof t === 'number');
	return tempos.length > 0 ? Math.min(...tempos) : DEFAULT_TEMPO;
}

/** Get the most recent lastPracticedAt across all keys for a lick (for sorting) */
export function getLickLastPracticed(progress: LickPracticeProgress, phraseId: string): number {
	const keyProgress = progress[phraseId];
	if (!keyProgress) return 0;
	const times = Object.values(keyProgress).map(kp => kp.lastPracticedAt);
	return times.length > 0 ? Math.max(...times) : 0;
}

/** Check if a lick has any stored per-key progress */
export function hasLickProgress(progress: LickPracticeProgress, phraseId: string): boolean {
	return !!progress[phraseId] && Object.keys(progress[phraseId]!).length > 0;
}

/**
 * BPM to display for a lick on a card: the slowest unlocked-key tempo once the
 * lick has been practiced (what the next session would resume at), else the
 * new-lick starting tempo. Avoids `getLickTempo`'s DEFAULT_TEMPO (100) fallback,
 * which would misreport a never-practiced lick as faster than it starts.
 */
export function getLickDisplayTempo(progress: LickPracticeProgress, phraseId: string): number {
	return hasLickProgress(progress, phraseId)
		? getLickTempo(progress, phraseId)
		: NEW_LICK_DEFAULT_TEMPO;
}

// ── Progress history (per-lick BPM / keys-unlocked time series) ──────────────
//
// Append-only samples, one per session that changes tempo or unlocks a key.
// Synced via the same user_lick_metadata merge as the other blobs, but merged
// by a pure per-timestamp union (see lick-metadata-merge.ts) — no mtime, no
// reset tombstone. Powers the library detail-page progress graph.

export function loadLickProgressHistory(): LickProgressHistory {
	return load<LickProgressHistory>(HISTORY_KEY) ?? {};
}

function saveLickProgressHistory(history: LickProgressHistory): void {
	save(HISTORY_KEY, history);
	enqueue('lickMeta');
}

/** All progress-history points for a lick, sorted oldest→newest. */
export function getLickProgressHistory(phraseId: string): LickProgressPoint[] {
	const points = loadLickProgressHistory()[phraseId] ?? [];
	return [...points].sort((a, b) => a.t - b.t);
}

/**
 * Append one progress-history sample for a lick. Idempotent on the timestamp
 * `t` (a replayed write is a no-op), sorted, and capped at MAX_HISTORY_POINTS.
 */
export function appendLickProgressPoint(phraseId: string, point: LickProgressPoint): void {
	const history = loadLickProgressHistory();
	const existing = history[phraseId] ?? [];
	if (existing.some((p) => p.t === point.t)) return;
	const next = [...existing, point].sort((a, b) => a.t - b.t);
	history[phraseId] =
		next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
	saveLickProgressHistory(history);
}

/**
 * Reserved key inside the lick-tags blob holding one-time migration markers.
 * Always unioned by the merge (never LWW), so a marker survives cross-device
 * sync — see lick-metadata-merge.ts.
 */
const MIGRATIONS_KEY = '__migrations';
const PROGRESS_HISTORY_SEED_MARKER = 'progress-history-seed-v1';

function hasMigrationMarker(name: string): boolean {
	return loadUserLickTags()[MIGRATIONS_KEY]?.includes(name) ?? false;
}

function addMigrationMarker(name: string): void {
	const tags = loadUserLickTags();
	const current = tags[MIGRATIONS_KEY] ?? [];
	if (current.includes(name)) return;
	tags[MIGRATIONS_KEY] = [...current, name];
	saveUserLickTags(tags);
	syncLickTagsToCloud();
}

/**
 * One-time seed: synthesise progress-history points from the local session log
 * (`lick-practice-sessions`) so the detail-page BPM chart isn't empty on first
 * release. `keys.length` approximates the unlocked-key count for standard-mode
 * sessions (exact for going-forward points). Idempotent via the
 * `progress-history-seed-v1` marker; the caller gates this on cloud hydration
 * success so it never writes over a store that failed to hydrate.
 */
export function seedProgressHistoryFromSessions(): void {
	if (hasMigrationMarker(PROGRESS_HISTORY_SEED_MARKER)) return;

	const history = loadLickProgressHistory();
	for (const entry of loadLickPracticeSessions()) {
		for (const lick of entry.report.licks) {
			// Trick drills log sessions too; their composite ':' variant keys must not seed the LICK progress-history blob.
			if (lick.lickId.includes(':')) continue;
			const points = (history[lick.lickId] ??= []);
			if (points.some((p) => p.t === entry.timestamp)) continue;
			points.push({
				t: entry.timestamp,
				bpm: lick.newTempo ?? lick.tempo,
				keys: lick.keys.length
			});
		}
	}
	for (const id of Object.keys(history)) {
		const sorted = history[id].sort((a, b) => a.t - b.t);
		history[id] =
			sorted.length > MAX_HISTORY_POINTS ? sorted.slice(sorted.length - MAX_HISTORY_POINTS) : sorted;
	}
	saveLickProgressHistory(history);
	addMigrationMarker(PROGRESS_HISTORY_SEED_MARKER);
}

/**
 * Compute the tempo adjustment based on average score across 12 keys.
 * Returns the signed BPM delta.
 */
export function computeAutoTempoAdjustment(averageScore: number): number {
	if (averageScore >= 0.95) return 2;
	if (averageScore >= KEY_PROFICIENT_THRESHOLD) return 1;
	if (averageScore >= KEY_FLOOR_THRESHOLD) return -1;
	return -3;
}

/** Clamp a tempo to the allowed range (50–300 BPM). */
export function clampTempo(tempo: number): number {
	return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, tempo));
}

// ── Unlocked-key count ──────────────────────────────────────
//
// Cloud-synced via the unlock_counts column on user_lick_metadata
// (migration 00015). Hydrated alongside the other lick metadata blobs in
// initLickMetadataFromCloud; saved with a debounced upsert by saveUnlockCounts.

/**
 * Type guard for the unlock-counts shape. The persistence layer's `load<T>()`
 * is only a type cast — if localStorage holds a corrupt primitive (string,
 * number, array, null) we'd otherwise mutate it like an object, which throws
 * in strict-mode module code (`counts[phraseId] = next` on a string).
 */
function isUnlockCountMap(value: unknown): value is Record<string, number> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadUnlockCounts(): Record<string, number> {
	const raw = load<unknown>(UNLOCK_KEY);
	return isUnlockCountMap(raw) ? raw : {};
}

function saveUnlockCounts(counts: Record<string, number>): void {
	save(UNLOCK_KEY, counts);
	syncUnlockCountsToCloud();
}

/** Drop a lick's stored unlock count, relocking it to 1 key. */
function clearUnlockCount(phraseId: string): void {
	const counts = loadUnlockCounts();
	if (!(phraseId in counts)) return;
	delete counts[phraseId];
	// Stamp so the removal (a reset) wins the per-id LWW over a stale higher
	// count still held on another device.
	stampMergeMeta('unlockMtime', phraseId);
	saveUnlockCounts(counts);
}

/**
 * Full reset: wipe a lick's per-key progress and unlock count, returning it to
 * the never-practiced state (tempo → NEW_LICK_DEFAULT_TEMPO, passCount → 0, one
 * unlocked key). Practice/progression tags are left untouched, so the lick
 * stays in the rotation — it just starts over. Returns the updated progress map.
 */
export function resetLickPersistence(
	progress: LickPracticeProgress,
	phraseId: string
): LickPracticeProgress {
	clearUnlockCount(phraseId);
	// Reset tombstone: per-key entries older than this are dropped by the merge,
	// so a stale device's older practice can't resurrect the cleared progress.
	stampMergeMeta('progressResets', phraseId);
	const next = clearLickProgress(progress, phraseId);
	saveLickPracticeProgress(next);
	return next;
}

/**
 * Resolve the unlocked key count from an already-loaded counts map. Shared
 * by getUnlockedKeyCount (which loads on each call) and bumpUnlockedKeyCount
 * (which has a counts map in hand and would otherwise read storage twice).
 *
 * Resolution order:
 *   - explicit stored value (must be a finite number, clamped to [1, 12]), else
 *   - 12 if the lick has progress in all 12 keys (grandfathers pre-feature
 *     users — the old code wrote all 12 per session, so full coverage is
 *     unique to pre-feature data), else
 *   - 1 (brand-new lick or post-feature lick whose first session failed).
 *
 * The "all 12 keys" check matters: a fresh lick whose entry-key session
 * failed has progress in 1 key but no stored count, and we must not
 * grandfather it back up to 12 — otherwise a single bad session demotes
 * the user to the daunting full-12-key cycle.
 *
 * The Number.isFinite gate exists because Math.max(1, NaN) returns NaN,
 * which would propagate into key-plan slicing and silently break sessions
 * if a manually-edited or legacy-corrupt store ever held NaN/Infinity.
 */
function resolveUnlockCount(
	counts: Record<string, number>,
	progress: LickPracticeProgress,
	phraseId: string
): number {
	const stored = counts[phraseId];
	if (typeof stored === 'number' && Number.isFinite(stored)) {
		// Truncate before clamping so a corrupt fractional value (e.g. 1.5)
		// can't desync the persisted counter from the actual unlocked set:
		// slice(0, 1.5) unlocks 1 key, but bumping 1.5 → 2.5 would
		// persist a non-integer that drifts further with each session.
		return Math.min(MAX_UNLOCKED_KEYS, Math.max(1, Math.trunc(stored)));
	}
	const keysWithProgress = progress[phraseId]
		? Object.keys(progress[phraseId]).length
		: 0;
	return keysWithProgress >= MAX_UNLOCKED_KEYS ? MAX_UNLOCKED_KEYS : 1;
}

export function getUnlockedKeyCount(
	progress: LickPracticeProgress,
	phraseId: string
): number {
	return resolveUnlockCount(loadUnlockCounts(), progress, phraseId);
}

export interface ShouldUnlockNextKeyArgs {
	/** Average score across the keys the user attempted this session. */
	avgScore: number;
	/** `passCount` of the most-recently-unlocked key (after this session's writes). */
	newestKeyPassCount: number;
	/** Currently unlocked-key count BEFORE any potential bump. */
	unlockedCount: number;
}

/**
 * Decide whether to unlock the next key after a finished lick session.
 * Requires both a strong session (`avgScore >= UNLOCK_AVG_THRESHOLD`) and
 * sufficient consolidation on the most-recently-unlocked key
 * (`newestKeyPassCount >= UNLOCK_PASSES_REQUIRED`). Caps at
 * `MAX_UNLOCKED_KEYS`.
 */
export function shouldUnlockNextKey(args: ShouldUnlockNextKeyArgs): boolean {
	const { avgScore, newestKeyPassCount, unlockedCount } = args;
	if (unlockedCount >= MAX_UNLOCKED_KEYS) return false;
	return (
		avgScore >= UNLOCK_AVG_THRESHOLD &&
		newestKeyPassCount >= UNLOCK_PASSES_REQUIRED
	);
}

/** Bump the unlock count by 1, capped at 12. Returns the new count. */
export function bumpUnlockedKeyCount(
	progress: LickPracticeProgress,
	phraseId: string
): number {
	const counts = loadUnlockCounts();
	const current = resolveUnlockCount(counts, progress, phraseId);
	const next = Math.min(MAX_UNLOCKED_KEYS, current + 1);
	counts[phraseId] = next;
	stampMergeMeta('unlockMtime', phraseId);
	saveUnlockCounts(counts);
	return next;
}

/** User-managed practice tags — stored separately from curated lick tags */
export function loadUserLickTags(): Record<string, string[]> {
	return load<Record<string, string[]>>(TAGS_KEY) ?? {};
}

export function saveUserLickTags(tags: Record<string, string[]>): void {
	save(TAGS_KEY, tags);
}

export function togglePracticeTag(phraseId: string): boolean {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const hasPractice = current.includes('practice');

	// Always write either 'practice' (in set) or PRACTICE_REMOVED_TAG
	// (explicit out) so backfillPracticeTags can distinguish a deliberate
	// removal from "no practice decision yet" (entry created by toggling
	// a prog:* tag, etc.) and won't undo the user's choice on next mount.
	const cleaned = current.filter(t => t !== 'practice' && t !== PRACTICE_REMOVED_TAG);
	tags[phraseId] = hasPractice
		? [...cleaned, PRACTICE_REMOVED_TAG]
		: [...cleaned, 'practice'];

	saveUserLickTags(tags);
	stampMergeMeta('tags', phraseId);
	syncLickTagsToCloud();
	return !hasPractice;
}

export function hasPracticeTag(phraseId: string): boolean {
	const tags = loadUserLickTags();
	return tags[phraseId]?.includes('practice') ?? false;
}

/**
 * Check whether a lick is in the user's practice set. Three-state resolution:
 *
 *   1. Entry contains PRACTICE_REMOVED_TAG → explicit user removal, false.
 *   2. Entry contains 'practice' → explicit user inclusion, true.
 *   3. Otherwise (no entry, or entry holds only unrelated tags like `prog:*`)
 *      → no decision yet, fall back to the curated `lick.tags` array.
 *
 * The PRACTICE_REMOVED_TAG sentinel is what lets us distinguish "user
 * removed practice" from "user touched the lick to add a progression tag
 * but never expressed a practice intent" — without it, both produce an
 * entry without 'practice' and we'd silently drop the lick from
 * `/lick-practice` in the second case.
 */
export function isInPracticeSet(phraseId: string, lickTags: readonly string[]): boolean {
	const tags = loadUserLickTags();
	const entry = tags[phraseId];
	if (entry?.includes(PRACTICE_REMOVED_TAG)) return false;
	if (entry?.includes('practice')) return true;
	return lickTags.includes('practice');
}

/**
 * Resolve the effective fallback tags for a lick, honouring legacy
 * tag-override entries before the curated `lick.tags` array. Display sites
 * (library list/detail, LickCard) and the practice-flow selectors all use
 * this so a curated lick whose practice flag still only lives in the
 * override blob renders consistently across surfaces.
 */
export function resolvePracticeFallbackTags(
	phraseId: string,
	lickTags: readonly string[]
): readonly string[] {
	return getLickTagOverrides()[phraseId] ?? lickTags;
}

/**
 * Bulk equivalent of `isInPracticeSet` — given the full lick library,
 * returns the set of IDs in the user's practice set. The /lick-practice
 * flow used to read this from `getPracticeTaggedIds()` (store-only), which
 * silently dropped any lick whose practice flag still only lived in
 * `lick.tags` (or the legacy override blob) on a fresh device. Now both
 * the library display and the practice flow follow the same store-or-
 * fallback rule, so they cannot disagree about membership.
 */
export function getEffectivePracticeLickIds(
	licks: readonly { id: string; tags: readonly string[] }[]
): Set<string> {
	const userTags = loadUserLickTags();
	const overrides = getLickTagOverrides();
	const ids = new Set<string>();
	for (const lick of licks) {
		const entry = userTags[lick.id];
		let inSet: boolean;
		if (entry?.includes(PRACTICE_REMOVED_TAG)) inSet = false;
		else if (entry?.includes('practice')) inSet = true;
		else inSet = (overrides[lick.id] ?? lick.tags).includes('practice');
		if (inSet) ids.add(lick.id);
	}
	return ids;
}

export function setPracticeTag(phraseId: string, tagged: boolean): void {
	// Write unconditionally — gating on the store's current state silently
	// no-ops when the UI shows the lick as tagged via the curated `lick.tags`
	// fallback but the store has no entry. Removal writes PRACTICE_REMOVED_TAG
	// rather than just dropping 'practice', so backfillPracticeTags can tell
	// a deliberate removal apart from an entry that exists for unrelated
	// reasons (e.g. a `prog:*` tag added before any practice decision).
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const cleaned = current.filter(t => t !== 'practice' && t !== PRACTICE_REMOVED_TAG);
	tags[phraseId] = tagged
		? [...cleaned, 'practice']
		: [...cleaned, PRACTICE_REMOVED_TAG];
	saveUserLickTags(tags);
	stampMergeMeta('tags', phraseId);
	syncLickTagsToCloud();
}

export function getPracticeTaggedIds(): Set<string> {
	const tags = loadUserLickTags();
	const ids = new Set<string>();
	for (const [id, tagList] of Object.entries(tags)) {
		if (tagList.includes('practice')) ids.add(id);
	}
	return ids;
}

/**
 * One-time migration: scan known licks and tag overrides for legacy
 * 'practice' markers, adding any that are missing to the new store.
 *
 * Licks entered via step-entry before `setPracticeTag` was wired into
 * the save flow (and curated licks modified via the old tag-override
 * system) have `'practice'` in their own `tags` array but no entry in
 * this store. This reconciles both sources.
 */
export function backfillPracticeTags(
	licks: { id: string; tags: string[] }[],
	tagOverrides: Record<string, string[]>
): number {
	const tags = loadUserLickTags();
	let added = 0;

	const ensure = (id: string) => {
		// Three states the existing entry could be in:
		//   - has 'practice' → user already in set; nothing to do.
		//   - has PRACTICE_REMOVED_TAG → user explicitly removed; respect it.
		//   - has neither (e.g. only `prog:*` tags) → user hasn't expressed a
		//     practice decision; safe to seed 'practice' from the curated
		//     default without overriding any user intent.
		const entry = tags[id];
		if (entry === undefined) {
			tags[id] = ['practice'];
			stampMergeMeta('tags', id);
			added++;
			return;
		}
		if (entry.includes('practice') || entry.includes(PRACTICE_REMOVED_TAG)) return;
		tags[id] = [...entry, 'practice'];
		stampMergeMeta('tags', id);
		added++;
	};

	for (const lick of licks) {
		if (lick.tags.includes('practice')) ensure(lick.id);
	}
	for (const [id, overrideTags] of Object.entries(tagOverrides)) {
		if (overrideTags.includes('practice')) ensure(id);
	}

	if (added > 0) {
		saveUserLickTags(tags);
		syncLickTagsToCloud();
	}
	return added;
}

// ── Progression tags ─────────────────────────────────────────

function progTag(type: ChordProgressionType): string {
	return PROG_TAG_PREFIX + type;
}

/** Toggle a progression tag on a lick. Returns true if now tagged. */
export function toggleProgressionTag(phraseId: string, type: ChordProgressionType): boolean {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const tag = progTag(type);
	const has = current.includes(tag);

	if (has) {
		// Keep an empty array (with a fresh mtime) rather than deleting the key,
		// so a cleared-to-empty state has a timestamp and wins the per-id LWW over
		// a stale non-empty copy on another device (the merge treats a missing key
		// as "no edit", which could otherwise resurrect the removed tag).
		tags[phraseId] = current.filter(t => t !== tag);
	} else {
		tags[phraseId] = [...current, tag];
	}

	saveUserLickTags(tags);
	stampMergeMeta('tags', phraseId);
	syncLickTagsToCloud();
	return !has;
}

/** Check if a lick has a specific progression tag. */
export function hasProgressionTag(phraseId: string, type: ChordProgressionType): boolean {
	const tags = loadUserLickTags();
	return tags[phraseId]?.includes(progTag(type)) ?? false;
}

/** Get all progression types tagged for a lick. */
export function getProgressionTags(phraseId: string): ChordProgressionType[] {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	return current
		.filter(t => t.startsWith(PROG_TAG_PREFIX))
		.map(t => t.slice(PROG_TAG_PREFIX.length) as ChordProgressionType);
}

/** Check if a lick is tagged for a specific progression. */
export function isTaggedForProgression(phraseId: string, type: ChordProgressionType): boolean {
	return hasProgressionTag(phraseId, type);
}

/**
 * Idempotent prog-tag insertion — adds `prog:<type>` if not already present.
 * Returns true when a write actually happened. Exported for `updateLickCategory`
 * (auto-tag on category-set).
 */
export function ensureProgressionTag(phraseId: string, type: ChordProgressionType): boolean {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const tag = progTag(type);
	if (current.includes(tag)) return false;
	tags[phraseId] = [...current, tag];
	saveUserLickTags(tags);
	stampMergeMeta('tags', phraseId);
	syncLickTagsToCloud();
	return true;
}

/** Stamp a curated tag-override edit so it wins the per-id merge (for user-licks.ts). */
export function stampTagOverrideMtime(id: string): void {
	stampMergeMeta('overrides', id);
}

/** Stamp a curated category-override edit so it wins the per-id merge. */
export function stampCategoryOverrideMtime(id: string): void {
	stampMergeMeta('catOverrides', id);
}

