import type { PitchClass, PhraseCategory } from '$lib/types/music.ts';
import type { LickPracticeProgress, LickPracticeKeyProgress, ChordProgressionType } from '$lib/types/lick-practice.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types.ts';
import { save, load } from './storage.ts';
import { syncLickMetadataToCloud, loadLickMetadataFromCloud } from './sync.ts';

const STORAGE_KEY = 'lick-practice-progress';
const TAGS_KEY = 'user-lick-tags';
const DEFAULT_TEMPO = 100;
const PROG_TAG_PREFIX = 'prog:';

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
	try {
		const cloud = await loadLickMetadataFromCloud(supabase);
		if (!cloud) return;

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
	} catch (error) {
		console.warn('Failed to hydrate lick metadata from cloud:', error);
	}
}

/** Debounce timers — prevents rapid writes from racing in the cloud. */
let syncTagsTimer: ReturnType<typeof setTimeout> | null = null;
let syncProgressTimer: ReturnType<typeof setTimeout> | null = null;
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
