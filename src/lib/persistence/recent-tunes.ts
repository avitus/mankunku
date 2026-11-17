import { load, save } from './storage';

const STORAGE_KEY = 'recent-tunes';
const HISTORY_LIMIT = 50;

/** Newest-first stable tune IDs, local to the active account and browser. */
export function getRecentTuneIds(): string[] {
	const stored = load<unknown>(STORAGE_KEY);
	if (!Array.isArray(stored)) return [];
	return [...new Set(stored.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
		.slice(0, HISTORY_LIMIT);
}

/** Record a resolved tune visit/play without duplicates or transposed/sluggified IDs. */
export function recordRecentTune(tuneId: string): void {
	if (!tuneId.trim()) return;
	const recent = getRecentTuneIds();
	if (recent[0] === tuneId) return;
	save(STORAGE_KEY, [tuneId, ...recent.filter((id) => id !== tuneId)].slice(0, HISTORY_LIMIT));
}
