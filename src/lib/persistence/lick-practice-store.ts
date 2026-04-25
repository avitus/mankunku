import type { PitchClass, PhraseCategory } from '$lib/types/music';
import type { LickPracticeProgress, LickPracticeKeyProgress, ChordProgressionType } from '$lib/types/lick-practice';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { save, load } from './storage';
import { syncLickMetadataToCloud, loadLickMetadataFromCloud } from './sync';
import { getScopeGeneration } from './user-scope';

const STORAGE_KEY = 'lick-practice-progress';
const TAGS_KEY = 'user-lick-tags';
const UNLOCK_KEY = 'lick-unlock-count';
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

		const CATEGORY_OVERRIDES_KEY = 'lick-category-overrides';
		const localCatOverrides = load<Record<string, PhraseCategory>>(CATEGORY_OVERRIDES_KEY);
		if (!localCatOverrides || Object.keys(localCatOverrides).length === 0) {
			if (Object.keys(cloud.categoryOverrides).length > 0) {
				save(CATEGORY_OVERRIDES_KEY, cloud.categoryOverrides);
			}
		}

		const localUnlocks = load<Record<string, number>>(UNLOCK_KEY);
		if (!localUnlocks || Object.keys(localUnlocks).length === 0) {
			if (Object.keys(cloud.unlockCounts).length > 0) {
				save(UNLOCK_KEY, cloud.unlockCounts);
			}
		}
	} catch (error) {
		console.warn('Failed to hydrate lick metadata from cloud:', error);
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

export function loadUnlockCounts(): Record<string, number> {
	return load<Record<string, number>>(UNLOCK_KEY) ?? {};
}

function saveUnlockCounts(counts: Record<string, number>): void {
	save(UNLOCK_KEY, counts);
	syncUnlockCountsToCloud();
}

/**
 * Resolve the unlocked key count for a lick.
 *
 *   - explicit stored value (clamped to [1, 12]), else
 *   - 12 if the lick has progress in all 12 keys (grandfathers pre-feature
 *     users — the old code wrote all 12 per session, so full coverage is
 *     unique to pre-feature data), else
 *   - 1 (brand-new lick or post-feature lick whose first session failed).
 *
 * The "all 12 keys" check matters: a fresh lick whose entry-key session
 * failed has progress in 1 key but no stored count, and we must not
 * grandfather it back up to 12 — otherwise a single bad session demotes
 * the user to the daunting full-12-key cycle.
 */
export function getUnlockedKeyCount(
	progress: LickPracticeProgress,
	phraseId: string
): number {
	const stored = loadUnlockCounts()[phraseId];
	if (typeof stored === 'number') {
		return Math.min(MAX_UNLOCKED_KEYS, Math.max(1, stored));
	}
	const keysWithProgress = progress[phraseId]
		? Object.keys(progress[phraseId]).length
		: 0;
	return keysWithProgress >= MAX_UNLOCKED_KEYS ? MAX_UNLOCKED_KEYS : 1;
}

/**
 * Bump the unlock count by 1, capped at 12. Returns the new count.
 * Reads the resolved current count via getUnlockedKeyCount so that
 * pre-feature licks with existing progress (which fall back to 12)
 * don't get accidentally reset to 2 the first time they're bumped.
 */
export function bumpUnlockedKeyCount(
	progress: LickPracticeProgress,
	phraseId: string
): number {
	const counts = loadUnlockCounts();
	const current = getUnlockedKeyCount(progress, phraseId);
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
