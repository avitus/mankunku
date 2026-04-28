/**
 * Pure helpers for choosing the initial chord progression on the
 * /lick-practice setup screen. Kept out of the runes-bearing state module
 * (lick-practice.svelte.ts) so unit tests can import without booting the
 * full state machine.
 */

import type { Phrase } from '$lib/types/music';
import type {
	ChordProgressionType,
	LickPracticeProgress
} from '$lib/types/lick-practice';
import type { LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import {
	PROGRESSION_TEMPLATES,
	getCompatibleLickCategories
} from '$lib/data/progressions';
import { getLickLastPracticed } from '$lib/persistence/lick-practice-store';

export const DEFAULT_PROGRESSION: ChordProgressionType = 'ii-V-I-major';

/**
 * Pick the progression to pre-select on /lick-practice setup.
 *
 * Algorithm: of the user's practice-tagged licks, find the
 * least-recently-practiced one (lastPracticedAt = 0 wins). Among the
 * progressions that fit that lick — category-compatible OR carrying a
 * user `prog:*` tag for the lick (substitutions ignored) — return the
 * least-recently-practiced. Ties resolve to the first fit in
 * `Object.keys(PROGRESSION_TEMPLATES)` order, which mirrors the on-screen
 * pill row.
 */
export function selectInitialProgression(args: {
	candidates: Phrase[];
	progress: LickPracticeProgress;
	sessionLog: LickPracticeSessionLogEntry[];
	getProgressionTags: (lickId: string) => ChordProgressionType[];
}): ChordProgressionType {
	const { candidates, progress, sessionLog, getProgressionTags } = args;
	if (candidates.length === 0) return DEFAULT_PROGRESSION;

	let neglected = candidates[0];
	let neglectedTime = getLickLastPracticed(progress, neglected.id);
	for (let i = 1; i < candidates.length; i++) {
		const t = getLickLastPracticed(progress, candidates[i].id);
		if (t < neglectedTime) {
			neglected = candidates[i];
			neglectedTime = t;
		}
	}

	const order = Object.keys(PROGRESSION_TEMPLATES) as ChordProgressionType[];
	const userTags = getProgressionTags(neglected.id);
	const fits = order.filter(
		(p) =>
			userTags.includes(p) ||
			getCompatibleLickCategories(p).includes(neglected.category)
	);
	if (fits.length === 0) return DEFAULT_PROGRESSION;

	const lastPracticed = new Map<ChordProgressionType, number>();
	for (const entry of sessionLog) {
		const prev = lastPracticed.get(entry.progressionType) ?? 0;
		if (entry.timestamp > prev) {
			lastPracticed.set(entry.progressionType, entry.timestamp);
		}
	}

	let pick = fits[0];
	let pickTime = lastPracticed.get(pick) ?? 0;
	for (let i = 1; i < fits.length; i++) {
		const t = lastPracticed.get(fits[i]) ?? 0;
		if (t < pickTime) {
			pick = fits[i];
			pickTime = t;
		}
	}
	return pick;
}
