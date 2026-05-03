import type { PitchClass, PhraseCategory } from '$lib/types/music';
import type { LickPracticeProgress, LickPracticeKeyProgress, ChordProgressionType } from '$lib/types/lick-practice';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { save, load } from './storage';
import { syncLickMetadataToCloud, loadLickMetadataFromCloud, type LickMetadata } from './sync';
import { getScopeGeneration } from './user-scope';
import { getAllLicks } from '$lib/phrases/library-loader';
import { getUserLicksLocal, getLickCategoryOverrides, updateLickCategory } from './user-licks';
import { INFERRED_PROGRESSION_TAG_BY_CATEGORY } from '$lib/data/progressions';

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
/** Maximum unlocked keys per lick (full 12-key circle). */
const MAX_UNLOCKED_KEYS = 12;

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
 */
export async function initLickMetadataFromCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	_supabase = supabase;
	const gen = getScopeGeneration();
	try {
		const cloud = await loadLickMetadataFromCloud(supabase);
		if (!cloud) return;
		if (gen !== getScopeGeneration()) return; // User switched mid-flight

		const localTags = load<Record<string, string[]>>(TAGS_KEY);
		if (!localTags || Object.keys(localTags).length === 0) {
			if (Object.keys(cloud.lickTags).length > 0) {
				save(TAGS_KEY, cloud.lickTags);
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
	} catch (error) {
		console.warn('Failed to hydrate lick metadata from cloud:', error);
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
			if (knownIds.has(id)) cleanedTags[id] = tagList;
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
	console.log('[diag] syncLickTagsToCloud called, _supabase=', _supabase ? 'set' : 'null');
	if (!_supabase) return;
	if (syncTagsTimer) clearTimeout(syncTagsTimer);
	syncTagsTimer = setTimeout(() => {
		console.log('[diag] syncLickTagsToCloud debounce fired, calling syncLickMetadataToCloud');
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

/** Get the minimum tempo across all 12 keys for a lick (used for session tempo) */
export function getLickTempo(progress: LickPracticeProgress, phraseId: string): number {
	const keyProgress = progress[phraseId];
	if (!keyProgress) return DEFAULT_TEMPO;
	const tempos = Object.values(keyProgress).map(kp => kp.currentTempo);
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
	if (averageScore >= 0.85) return 2;
	if (averageScore >= 0.70) return -1;
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

	if (hasPractice) {
		tags[phraseId] = current.filter(t => t !== 'practice');
		if (tags[phraseId].length === 0) delete tags[phraseId];
	} else {
		tags[phraseId] = [...current, 'practice'];
	}

	saveUserLickTags(tags);
	syncLickTagsToCloud();
	return !hasPractice;
}

export function hasPracticeTag(phraseId: string): boolean {
	const tags = loadUserLickTags();
	return tags[phraseId]?.includes('practice') ?? false;
}

export function setPracticeTag(phraseId: string, tagged: boolean): void {
	const tags = loadUserLickTags();
	const current = tags[phraseId] ?? [];
	const has = current.includes('practice');
	if (tagged && !has) {
		tags[phraseId] = [...current, 'practice'];
		saveUserLickTags(tags);
		syncLickTagsToCloud();
	} else if (!tagged && has) {
		tags[phraseId] = current.filter(t => t !== 'practice');
		if (tags[phraseId].length === 0) delete tags[phraseId];
		saveUserLickTags(tags);
		syncLickTagsToCloud();
	}
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
		const current = tags[id] ?? [];
		if (!current.includes('practice')) {
			tags[id] = [...current, 'practice'];
			added++;
		}
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
 * Retroactively apply `INFERRED_PROGRESSION_TAG_BY_CATEGORY` to every lick the
 * user already has. Mirrors what `updateLickCategory` now does on every new
 * category write — this just covers licks categorized before the auto-tag
 * hook existed. Idempotent on every subsequent run thanks to
 * `ensureProgressionTag`'s presence check.
 */
export function backfillInferredProgressionTags(): number {
	let added = 0;
	for (const lick of getAllLicks()) {
		const inferred = INFERRED_PROGRESSION_TAG_BY_CATEGORY[lick.category];
		if (!inferred) continue;
		if (ensureProgressionTag(lick.id, inferred)) added++;
	}
	return added;
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

	// 2. Category overrides on curated/community licks.
	const overrides = getLickCategoryOverrides();
	let overridesChanged = false;
	for (const [id, cat] of Object.entries(overrides)) {
		const remap = ORPHAN_CATEGORY_MIGRATIONS[cat];
		if (!remap) continue;
		overrides[id] = remap.newCategory;
		overridesChanged = true;
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
