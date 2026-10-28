import { load, save } from './storage';

const KEY = 'lick-practice-duration';

/** The setup page's Duration knob range (PracticeSetup.svelte). */
export const MIN_PRACTICE_MINUTES = 3;
export const MAX_PRACTICE_MINUTES = 20;

/**
 * The lick-practice time budget the user last dialled, device-local and
 * isolated by the storage layer's active user. Null when nothing usable is
 * stored, so the config keeps its default.
 */
export function loadPracticeDuration(): number | null {
	const stored = load<unknown>(KEY);
	if (typeof stored !== 'number' || !Number.isFinite(stored) || stored < 1) return null;
	return Math.min(MAX_PRACTICE_MINUTES, Math.max(MIN_PRACTICE_MINUTES, Math.round(stored)));
}

export function savePracticeDuration(minutes: number): void {
	save(KEY, minutes);
}
