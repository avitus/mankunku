import type { PitchClass, PhraseCategory } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import type { LickPracticeProgress, LickPracticeKeyProgress, ChordProgressionType } from '$lib/types/lick-practice';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { save, load } from './storage';
import { syncLickMetadataToCloud, loadLickMetadataFromCloud, type LickMetadata } from './sync';
import { getScopeGeneration } from './user-scope';
import { getAllLicks, isCuratedLickId } from '$lib/phrases/library-loader';
import {
	getUserLicksLocal,
	getLickCategoryOverrides,
	updateLickCategory,
	getLickTagOverrides
} from './user-licks';
import { getProgressionsForCategory } from '$lib/data/progressions';

const STORAGE_KEY = 'lick-practice-progress';
const TAGS_KEY = 'user-lick-tags';
const UNLOCK_KEY = 'lick-unlock-count';
const CATEGORY_OVERRIDES_KEY = 'lick-category-overrides';
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
/** Maximum unlocked keys per lick (full 12-key circle). */
const MAX_UNLOCKED_KEYS = 12;

/**
 * Reserved key in the user-lick-tags blob holding one-time migration
 * markers instead of a lick's tags. Living inside the cloud-synced blob is
 * what makes a marker durable: it survives the user-scope wipe, travels to
 * new devices, and comes back on every hydration. Consumers that enumerate
 * tag keys as lick ids must skip reserved keys (see `isReservedTagKey` —
 * `reconcileOrphanedLickMetadata` is the one enumerator that would
 * otherwise prune it as an orphan).
 */
const MIGRATIONS_KEY = '__migrations';

/** Marker recorded under MIGRATIONS_KEY once the progression-tag backfill has run. */
const PROG_BACKFILL_MARKER = 'prog-backfill-v1';

/** Reserved (non-lick-id) keys in the user-lick-tags blob start with `__`. */
function isReservedTagKey(key: string): boolean {
	return key.startsWith('__');
}

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
export const UNLOCK_PASSES_REQUIRED = 2;

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
 * switch mid-flight). `runLickMetadataMaintenance` gates destructive
 * maintenance on this report — see that function for why.
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
		if (result.status === 'empty') return true; // New account — nothing to hydrate
		const cloud = result.data;

		const localTags = load<Record<string, string[]>>(TAGS_KEY);
		if (!localTags || Object.keys(localTags).length === 0) {
			if (Object.keys(cloud.lickTags).length > 0) {
				save(TAGS_KEY, cloud.lickTags);
			}
		} else {
			// A populated local blob is never overwritten with cloud data — but
			// the reserved `__migrations` entry must still merge DOWN, or a
			// device whose local blob predates the marker would re-run one-time
			// migrations another device already completed (and resurrect
			// deliberately-removed tags). The union is additive and touches no
			// lick entries, so local-first semantics are preserved.
			const cloudMigrations = cloud.lickTags[MIGRATIONS_KEY] ?? [];
			const localMigrations = localTags[MIGRATIONS_KEY] ?? [];
			const missing = cloudMigrations.filter((m) => !localMigrations.includes(m));
			if (missing.length > 0) {
				localTags[MIGRATIONS_KEY] = [...localMigrations, ...missing];
				save(TAGS_KEY, localTags);
			}
		}

		const localProgress = load<LickPracticeProgress>(STORAGE_KEY);
		if (!localProgress || Object.keys(localProgress).length === 0) {
			if (Object.keys(cloud.practiceProgress).length > 0) {
				save(STORAGE_KEY, cloud.practiceProgress);
			}
		}

		const TAG_OVERRIDES_KEY = 'lick-tag-overrides';
		const localTagOverrides = load<Record<string, string[]>>(TAG_OVERRIDES_KEY);
		if (!localTagOverrides || Object.keys(localTagOverrides).length === 0) {
			if (Object.keys(cloud.tagOverrides).length > 0) {
				save(TAG_OVERRIDES_KEY, cloud.tagOverrides);
			}
		}

		const localCatOverrides = load<Record<string, PhraseCategory>>(CATEGORY_OVERRIDES_KEY);
		if (!localCatOverrides || Object.keys(localCatOverrides).length === 0) {
			if (Object.keys(cloud.categoryOverrides).length > 0) {
				save(CATEGORY_OVERRIDES_KEY, cloud.categoryOverrides);
			}
		}

		// Normalize both ends through the same type guard the rest of the
		// module uses — load<T>() is just a cast, and cloud.unlockCounts is a
		// JSONB blob that could in principle be any JSON value. Without this,
		// a corrupt non-object payload on either side would either misfire the
		// "already populated" check or write a non-object back to localStorage.
		const localUnlocks = loadUnlockCounts();
		if (Object.keys(localUnlocks).length === 0) {
			const cloudUnlocks = isUnlockCountMap(cloud.unlockCounts) ? cloud.unlockCounts : {};
			if (Object.keys(cloudUnlocks).length > 0) {
				save(UNLOCK_KEY, cloudUnlocks);
			}
		}
		return true;
	} catch (error) {
		console.warn('Failed to hydrate lick metadata from cloud:', error);
		return false;
	}
}

/**
 * Drop entries from the keyed-by-lick-id metadata stores (practice tags,
 * practice progress, unlock counts) whose lick IDs are no longer present in
 * the current user's known set (curated + owned + stolen). Re-syncs the
 * cleaned blobs to the cloud `user_lick_metadata` row so the next hydration
 * doesn't repopulate the orphans.
 *
 * Why this exists: prior to commit 57b13ca, `getUserLicks` and
 * `initUserLicksFromCloud` did unfiltered selects on `user_licks`. After
 * migration 00013 widened that table's SELECT policy, those reads pulled
 * every author's licks into the current user's localStorage. Any practice
 * tag or progress entry written against those foreign IDs got persisted up
 * to the user's metadata row, where it survives the user-scope wipe and
 * re-poisons localStorage on every fresh login. The visible symptom in the
 * library hides once user-licks itself is clean (the orphan keys point at
 * IDs that aren't in `getAllLicks()`), but the dirt is still there and
 * resurfaces if the user later steals the same lick from /community.
 *
 * Must run AFTER `initUserLicksFromCloud` and `initCommunityFromCloud` so
 * `getAllLicks()` reflects the post-hydration authoritative set.
 */
export async function reconcileOrphanedLickMetadata(
	supabase: SupabaseClient<Database>
): Promise<number> {
	const gen = getScopeGeneration();
	try {
		const knownIds = new Set(getAllLicks().map((l) => l.id));

		const tags = loadUserLickTags();
		const cleanedTags: Record<string, string[]> = {};
		let removedTags = 0;
		for (const [id, tagList] of Object.entries(tags)) {
			// Reserved keys (e.g. `__migrations`) are not lick ids — they must
			// survive reconciliation or one-time migrations would re-run.
			if (isReservedTagKey(id) || knownIds.has(id)) cleanedTags[id] = tagList;
			else removedTags++;
		}

		const progress = loadLickPracticeProgress();
		const cleanedProgress: LickPracticeProgress = {};
		let removedProgress = 0;
		for (const [id, keyData] of Object.entries(progress)) {
			if (knownIds.has(id)) cleanedProgress[id] = keyData;
			else removedProgress++;
		}

		const unlocks = loadUnlockCounts();
		const cleanedUnlocks: Record<string, number> = {};
		let removedUnlocks = 0;
		for (const [id, count] of Object.entries(unlocks)) {
			if (knownIds.has(id)) cleanedUnlocks[id] = count;
			else removedUnlocks++;
		}

		const totalRemoved = removedTags + removedProgress + removedUnlocks;
		if (totalRemoved === 0) return 0;

		// User switched mid-flight — abandon writeback so we don't clobber
		// the new user's freshly hydrated state with the previous user's
		// reconciled blobs.
		if (gen !== getScopeGeneration()) return 0;

		const cloudPayload: Partial<LickMetadata> = {};
		if (removedTags > 0) {
			save(TAGS_KEY, cleanedTags);
			cloudPayload.lickTags = cleanedTags;
		}
		if (removedProgress > 0) {
			save(STORAGE_KEY, cleanedProgress);
			cloudPayload.practiceProgress = cleanedProgress;
		}
		if (removedUnlocks > 0) {
			save(UNLOCK_KEY, cleanedUnlocks);
			cloudPayload.unlockCounts = cleanedUnlocks;
		}

		await syncLickMetadataToCloud(supabase, cloudPayload);
		return totalRemoved;
	} catch (error) {
		console.warn('Failed to reconcile orphaned lick metadata:', error);
		return 0;
	}
}

/** Per-store cloud hydration outcomes reported by the three lick inits. */
export interface LickHydrationStatus {
	/** initLickMetadataFromCloud (tags / progress / overrides / unlocks). */
	metadataOk: boolean;
	/** initUserLicksFromCloud (the user's own licks). */
	userLicksOk: boolean;
	/** initCommunityFromCloud (favorites, steals, stolen payloads). */
	communityOk: boolean;
}

/**
 * Post-hydration metadata maintenance: orphan reconciliation followed by the
 * one-time progression-tag backfill — gated on every lick hydration having
 * verifiably succeeded.
 *
 * The gate is the point. Both maintenance steps trust local state as a
 * faithful mirror of the cloud: the reconciler prunes metadata entries whose
 * ids aren't in `getAllLicks()` and pushes the cleaned blobs cloudward, and
 * the backfill judges "has this account migrated?" from the local tags blob.
 * If any hydration failed silently (auth hiccup, network, mid-reboot
 * backend), local state is partial — the reconciler would prune every
 * user-lick entry as an "orphan" and sync the emptied blobs over the cloud
 * row, and the backfill would misread an already-migrated account as
 * unmigrated. Skipping maintenance for one session is free; recovering a
 * clobbered cloud row is not.
 */
export async function runLickMetadataMaintenance(
	supabase: SupabaseClient<Database>,
	status: LickHydrationStatus
): Promise<{ ran: boolean; reconciled: number; backfilled: number }> {
	if (!status.metadataOk || !status.userLicksOk || !status.communityOk) {
		console.warn(
			'[lick-metadata] hydration incomplete — skipping orphan reconcile + progression-tag backfill',
			status
		);
		return { ran: false, reconciled: 0, backfilled: 0 };
	}

	const gen = getScopeGeneration();
	const reconciled = await reconcileOrphanedLickMetadata(supabase);
	// A user switch during the (async) reconcile means the freshly-wiped
	// store no longer belongs to the account the hydration reports vouched
	// for — do not judge migration state from it.
	if (gen !== getScopeGeneration()) {
		return { ran: true, reconciled, backfilled: 0 };
	}
	const backfilled = backfillInferredProgressionTags();
	if (backfilled > 0) {
		console.info(
			`[migration] Seeded ${backfilled} progression tag(s) from lick categories (one-time backfill).`
		);
	}
	return { ran: true, reconciled, backfilled };
}

/** Debounce timers — prevents rapid writes from racing in the cloud. */
let syncTagsTimer: ReturnType<typeof setTimeout> | null = null;
let syncProgressTimer: ReturnType<typeof setTimeout> | null = null;
let syncUnlocksTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 500;

/**
 * Debounced sync of the lick_tags column to cloud.
 *
 * Reads the current state at sync time (not call time) so rapid calls
 * coalesce into a single request carrying the latest data.
 */
function syncLickTagsToCloud(): void {
	if (!_supabase) return;
	if (syncTagsTimer) clearTimeout(syncTagsTimer);
	syncTagsTimer = setTimeout(() => {
		syncTagsTimer = null;
		const tags = loadUserLickTags();
		syncLickMetadataToCloud(_supabase!, { lickTags: tags }).catch(() => {});
	}, SYNC_DEBOUNCE_MS);
}

/**
 * Debounced sync of the practice_progress column to cloud.
 *
 * Same coalescing strategy as syncLickTagsToCloud.
 */
function syncPracticeProgressToCloud(): void {
	if (!_supabase) return;
	if (syncProgressTimer) clearTimeout(syncProgressTimer);
	syncProgressTimer = setTimeout(() => {
		syncProgressTimer = null;
		const progress = loadLickPracticeProgress();
		syncLickMetadataToCloud(_supabase!, { practiceProgress: progress }).catch(() => {});
	}, SYNC_DEBOUNCE_MS);
}

/**
 * Debounced sync of the unlock_counts column to cloud.
 *
 * Same coalescing strategy as the other sync helpers.
 */
function syncUnlockCountsToCloud(): void {
	if (!_supabase) return;
	if (syncUnlocksTimer) clearTimeout(syncUnlocksTimer);
	syncUnlocksTimer = setTimeout(() => {
		syncUnlocksTimer = null;
		const counts = loadUnlockCounts();
		syncLickMetadataToCloud(_supabase!, { unlockCounts: counts }).catch(() => {});
	}, SYNC_DEBOUNCE_MS);
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
 * Compute the tempo adjustment based on average score across 12 keys.
 * Returns the signed BPM delta.
 */
export function computeAutoTempoAdjustment(averageScore: number): number {
	if (averageScore >= 0.95) return 5;
	if (averageScore >= KEY_PROFICIENT_THRESHOLD) return 2;
	if (averageScore >= KEY_FLOOR_THRESHOLD) return -1;
	return -3;
}

/** Clamp a tempo to the allowed range (40–300 BPM). */
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
			added++;
			return;
		}
		if (entry.includes('practice') || entry.includes(PRACTICE_REMOVED_TAG)) return;
		tags[id] = [...entry, 'practice'];
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
		tags[phraseId] = current.filter(t => t !== tag);
		if (tags[phraseId].length === 0) delete tags[phraseId];
	} else {
		tags[phraseId] = [...current, tag];
	}

	saveUserLickTags(tags);
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

// ── Orphan-category migration ────────────────────────────────
//
// Categories removed from `PhraseCategory` after some user data already
// carried them. Each entry maps the orphan to a still-valid category plus
// the `prog:*` tag that captures the progression intent the orphan name made
// explicit (e.g. `long-ii-V-I-major` is unambiguously a long ii-V-I major lick).
// Rerunning is a no-op on already-migrated data — the scan only acts on licks
// still carrying an orphan category, and prog-tag insertion is idempotent.

interface OrphanCategoryRemap {
	newCategory: PhraseCategory;
	progressionTag: ChordProgressionType;
}

const ORPHAN_CATEGORY_MIGRATIONS: Record<string, OrphanCategoryRemap> = {
	'long-ii-V-I-major': { newCategory: 'ii-V-I-major', progressionTag: 'ii-V-I-major-long' },
	'long-ii-V-I-minor': { newCategory: 'ii-V-I-minor', progressionTag: 'ii-V-I-minor-long' }
};

/**
 * Idempotent prog-tag insertion — adds `prog:<type>` if not already present.
 * Returns true when a write actually happened. Exported for `updateLickCategory`
 * (auto-tag on category-set) and the retroactive backfill below.
 */
export function ensureProgressionTag(phraseId: string, type: ChordProgressionType): boolean {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const tag = progTag(type);
	if (current.includes(tag)) return false;
	tags[phraseId] = [...current, tag];
	saveUserLickTags(tags);
	syncLickTagsToCloud();
	return true;
}

/**
 * GUARDED ONE-TIME migration: seed a `prog:*` tag for every progression
 * compatible with each non-curated lick's category
 * (`getProgressionsForCategory`), for accounts whose own/adopted licks
 * predate the explicit-tag requirement introduced by commit 00df9ab.
 *
 * Background (2026-07-13 incident): progression eligibility was originally
 * derived from `lick.category` at runtime. 00df9ab made explicit `prog:*`
 * tags mandatory; the one-time category→tag migration that accompanied it
 * only ran in prod May 3–20 and missed user-entered licks, which therefore
 * had no persisted `prog:*` tags anywhere — invisible while stale cached
 * clients still matched by category, and surfacing as "no assigned
 * progressions" the moment a fresh client loaded.
 *
 * Guards — ALL must hold, so the backfill can never resurrect
 * deliberately-removed tags (the exact reason 00df9ab dropped the
 * unconditional hydrate-time backfill):
 *
 *  1. The durable `prog-backfill-v1` marker is absent. The marker is
 *     written into the cloud-synced tags blob itself, so "has run" survives
 *     user-scope wipes and follows the account across devices.
 *  2. At least one non-curated (own or adopted) lick exists — a brand-new
 *     account has nothing to migrate and is NOT stamped, keeping its blob
 *     untouched. (Once they categorize their first lick, guard 3 stamps on
 *     the next maintenance run, so every active account converges to
 *     stamped.)
 *  3. No non-curated lick carries any `prog:*` tag. One explicit tag means
 *     the account already lives under opt-in semantics (seeded by
 *     `updateLickCategory` or toggled by hand) — mass-seeding would trample
 *     deliberate curation. This skip STAMPS the marker: the state is
 *     affirmative proof of a current account, and stamping closes the hole
 *     where removing the last prog tag later makes it look unmigrated.
 *  4. No `practice:removed` sentinel exists anywhere in the blob. Sentinels
 *     only exist post-00df9ab-era interaction, so their presence also marks
 *     an already-current account. Stamps on skip, like guard 3.
 *
 * Curated catalog licks are excluded: their tags were migrated server-side
 * in May (they hydrate down with the metadata blob), and seeding them here
 * would silently opt the entire catalog into every progression for new
 * accounts.
 *
 * MUST only run after cloud hydration has verifiably succeeded — the
 * guards read the local tags blob, and a silently failed hydration makes
 * an already-migrated account look unmigrated (then the follow-up
 * whole-column sync clobbers the cloud row). `runLickMetadataMaintenance`
 * enforces that gate; do not call this from an ungated path.
 *
 * Returns the number of tags added.
 */
export function backfillInferredProgressionTags(): number {
	const tags = loadUserLickTags();

	// Guard 1 — durable marker: already ran for this account.
	if (tags[MIGRATIONS_KEY]?.includes(PROG_BACKFILL_MARKER)) return 0;

	// Guard 2 — nothing in scope (curated licks are excluded by design).
	const candidates = getAllLicks().filter((lick) => !isCuratedLickId(lick.id));
	if (candidates.length === 0) return 0;

	// Guard 3 — the account already uses explicit opt-in tags. STAMP before
	// skipping: this state is affirmative proof the account lives under the
	// new semantics, and without the marker a user who later removes their
	// last prog tag would make the account look unmigrated again — the
	// resurrection hole all over.
	const hasExplicitProgTag = candidates.some((lick) =>
		(tags[lick.id] ?? []).some((t) => t.startsWith(PROG_TAG_PREFIX))
	);
	if (hasExplicitProgTag) {
		stampProgBackfillMarker();
		return 0;
	}

	// Guard 4 — post-00df9ab practice-removal sentinels also mark a current
	// account; stamp for the same reason as guard 3 (sentinels can vanish if
	// the user re-adds those licks to the practice set).
	const hasRemovalSentinel = Object.values(tags).some((list) =>
		list.includes(PRACTICE_REMOVED_TAG)
	);
	if (hasRemovalSentinel) {
		stampProgBackfillMarker();
		return 0;
	}

	let added = 0;
	for (const lick of candidates) {
		for (const prog of getProgressionsForCategory(lick.category)) {
			if (ensureProgressionTag(lick.id, prog)) added++;
		}
	}

	// Stamp the marker even when nothing was added (e.g. categories with no
	// compatible progression): the state has been judged once; never rescan.
	stampProgBackfillMarker();

	return added;
}

/** Record the one-time progression backfill as done (idempotent, cloud-synced). */
function stampProgBackfillMarker(): void {
	const tags = loadUserLickTags();
	if (tags[MIGRATIONS_KEY]?.includes(PROG_BACKFILL_MARKER)) return;
	tags[MIGRATIONS_KEY] = [...(tags[MIGRATIONS_KEY] ?? []), PROG_BACKFILL_MARKER];
	saveUserLickTags(tags);
	syncLickTagsToCloud();
}

/**
 * Scan user licks and curated category overrides for orphan categories left
 * over from removed `PhraseCategory` enum values. For each match, swap the
 * category to a valid equivalent AND auto-assign the corresponding `prog:*`
 * tag — the orphan name is itself a strong signal of the progression the
 * user originally intended this lick for.
 *
 * Returns the number of licks touched. Stolen community licks are read-only,
 * so their categories aren't mutated, but a local prog tag is still added so
 * the lick becomes routable in this user's practice flow.
 */
export function migrateOrphanLickCategories(
	supabase?: SupabaseClient<Database>
): number {
	const sb = supabase ?? _supabase ?? undefined;
	let migrated = 0;

	// 1. User-recorded licks store category in their own row.
	for (const lick of getUserLicksLocal()) {
		const remap = ORPHAN_CATEGORY_MIGRATIONS[lick.category];
		if (!remap) continue;
		updateLickCategory(lick.id, remap.newCategory, sb);
		ensureProgressionTag(lick.id, remap.progressionTag);
		migrated++;
	}

	// 2. Category overrides on curated/community licks. Unlike the user-lick
	// branch we bypass `updateLickCategory` (curated overrides write to a
	// separate keyed-by-id blob, not the lick row), so we have to mirror its
	// opt-in seeding manually: every progression compatible with the new
	// category gets a `prog:*` tag. The orphan-specific tag is part of that
	// set, but kept as a final `ensureProgressionTag` call so the migration's
	// intent is explicit in the code.
	const overrides = getLickCategoryOverrides();
	let overridesChanged = false;
	for (const [id, cat] of Object.entries(overrides)) {
		const remap = ORPHAN_CATEGORY_MIGRATIONS[cat];
		if (!remap) continue;
		overrides[id] = remap.newCategory;
		overridesChanged = true;
		for (const prog of getProgressionsForCategory(remap.newCategory)) {
			ensureProgressionTag(id, prog);
		}
		ensureProgressionTag(id, remap.progressionTag);
		migrated++;
	}
	if (overridesChanged) {
		save(CATEGORY_OVERRIDES_KEY, overrides);
		if (sb) {
			syncLickMetadataToCloud(sb, { categoryOverrides: overrides }).catch(() => {});
		}
	}

	return migrated;
}
