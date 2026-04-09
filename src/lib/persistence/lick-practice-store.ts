import type { PitchClass } from '$lib/types/music.ts';
import type { LickPracticeProgress, LickPracticeKeyProgress, ChordProgressionType } from '$lib/types/lick-practice.ts';
import { save, load } from './storage.ts';

const STORAGE_KEY = 'lick-practice-progress';
const TAGS_KEY = 'user-lick-tags';
const DEFAULT_TEMPO = 100;
const PROG_TAG_PREFIX = 'prog:';

export function loadLickPracticeProgress(): LickPracticeProgress {
	return load<LickPracticeProgress>(STORAGE_KEY) ?? {};
}

export function saveLickPracticeProgress(progress: LickPracticeProgress): void {
	save(STORAGE_KEY, progress);
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

/** Get the oldest lastPracticedAt across all keys for a lick (for sorting) */
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
	return !hasPractice;
}

export function hasPracticeTag(phraseId: string): boolean {
	const tags = loadUserLickTags();
	return tags[phraseId]?.includes('practice') ?? false;
}

export function getPracticeTaggedIds(): Set<string> {
	const tags = loadUserLickTags();
	const ids = new Set<string>();
	for (const [id, tagList] of Object.entries(tags)) {
		if (tagList.includes('practice')) ids.add(id);
	}
	return ids;
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

/** Check if a lick is tagged for a specific progression (via user tag). */
export function isTaggedForProgression(phraseId: string, type: ChordProgressionType): boolean {
	return hasProgressionTag(phraseId, type);
}
