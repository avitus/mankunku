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
	getCompatibleLickCategories,
	getProgressionsForCategory
} from '$lib/data/progressions';
import { getLickLastPracticed } from '$lib/persistence/lick-practice-store';

export interface UpcomingLickEntry {
	lick: Phrase;
	lastPracticedAt: number;
	progressions: ChordProgressionType[];
}

export const DEFAULT_PROGRESSION: ChordProgressionType = 'ii-V-I-major';

/**
 * True when a practice-tagged lick has at least one progression it can play
 * over: either an explicit `prog:*` tag or a category that appears in some
 * `PROGRESSION_LICK_CATEGORIES` entry. Licks failing this test are
 * "stranded" — kept in the practice set so user intent isn't lost, but
 * skipped by the picker so they can't starve eligible candidates.
 */
function hasFittingProgression(
	lick: Phrase,
	getProgressionTags: (lickId: string) => ChordProgressionType[]
): boolean {
	if (getProgressionTags(lick.id).length > 0) return true;
	return getProgressionsForCategory(lick.category).length > 0;
}

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
 *
 * "Stranded" candidates — practice-tagged but with no `prog:*` tag and a
 * category that isn't listed in any progression — are excluded from the
 * search. Without this guard a stranded lick (e.g. one carrying an orphan
 * category from a removed enum value) keeps its `lastPracticedAt` at 0
 * forever, monopolises the most-neglected slot, and forces the picker
 * back to DEFAULT_PROGRESSION every session.
 */
export function selectInitialProgression(args: {
	candidates: Phrase[];
	progress: LickPracticeProgress;
	sessionLog: LickPracticeSessionLogEntry[];
	getProgressionTags: (lickId: string) => ChordProgressionType[];
}): ChordProgressionType {
	const { candidates, progress, sessionLog, getProgressionTags } = args;
	if (candidates.length === 0) return DEFAULT_PROGRESSION;

	const eligible = candidates.filter((c) => hasFittingProgression(c, getProgressionTags));
	if (eligible.length === 0) return DEFAULT_PROGRESSION;

	let neglected = eligible[0];
	let neglectedTime = getLickLastPracticed(progress, neglected.id);
	for (let i = 1; i < eligible.length; i++) {
		const t = getLickLastPracticed(progress, eligible[i].id);
		if (t < neglectedTime) {
			neglected = eligible[i];
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

/**
 * Build the post-session "Upcoming Licks" list from already-resolved practice
 * dependencies. Pure — keeps the runes-bearing state module thin and lets
 * unit tests exercise the logic without booting the lick-practice runtime.
 *
 * For each candidate, the result includes its last-practiced timestamp (0 if
 * never) and the union of progressions it can be launched over: direct
 * category compatibility ∪ user-assigned `prog:*` tags. Substitutions are
 * intentionally excluded — they're an opt-in setup-page toggle, not a
 * one-click action.
 *
 * Licks with no compatible progressions are dropped (no actionable CTA).
 * Sorted by `lastPracticedAt` ascending so longest-ago / never-practiced
 * licks bubble to the top; just-finished licks fall to the bottom.
 */
export function buildUpcomingLicks(args: {
	candidates: Phrase[];
	progress: LickPracticeProgress;
	getProgressionTags: (lickId: string) => ChordProgressionType[];
}): UpcomingLickEntry[] {
	const { candidates, progress, getProgressionTags } = args;
	const order = Object.keys(PROGRESSION_TEMPLATES) as ChordProgressionType[];

	const entries: UpcomingLickEntry[] = [];
	for (const lick of candidates) {
		const set = new Set<ChordProgressionType>(getProgressionsForCategory(lick.category));
		for (const t of getProgressionTags(lick.id)) set.add(t);
		if (set.size === 0) continue;

		entries.push({
			lick,
			lastPracticedAt: getLickLastPracticed(progress, lick.id),
			progressions: order.filter((t) => set.has(t))
		});
	}

	entries.sort((a, b) => a.lastPracticedAt - b.lastPracticedAt);
	return entries;
}

/**
 * Practice-tagged licks that have no progression mapping at all — neither a
 * `prog:*` tag nor a category listed in any `PROGRESSION_LICK_CATEGORIES`
 * entry. Such licks can never appear in a session and exist only to be
 * surfaced in the UI as "needs progression — fix in the library".
 */
export function findStrandedLicks(args: {
	candidates: Phrase[];
	getProgressionTags: (lickId: string) => ChordProgressionType[];
}): Phrase[] {
	const { candidates, getProgressionTags } = args;
	return candidates.filter((c) => !hasFittingProgression(c, getProgressionTags));
}
