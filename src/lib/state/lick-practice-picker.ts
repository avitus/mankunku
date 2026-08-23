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
import { PROGRESSION_TEMPLATES, progressionFitsLick } from '$lib/data/progressions';
import { getLickLastPracticed } from '$lib/persistence/lick-practice-store';

export interface UpcomingLickEntry {
	lick: Phrase;
	lastPracticedAt: number;
	progressions: ChordProgressionType[];
}

export const DEFAULT_PROGRESSION: ChordProgressionType = 'ii-V-I-major';

/**
 * True when a practice-tagged lick has at least one explicit `prog:*` tag
 * that its own chord shape FITS (`progressionFitsLick`).
 * Category compatibility alone no longer counts: every practice-eligible
 * lick must carry the progressions it should play under as user tags
 * (seeded by `updateLickCategory` from the templates the lick's own harmony
 * fits, pruned of misfits on hydrate, or hand-toggled on the pills). Licks
 * failing this test are "stranded" — kept in the practice set so user
 * intent isn't lost, but skipped by the picker and the session-time
 * `getPracticeLicks` filter so they can't starve eligible candidates.
 */
function hasFittingProgression(
	lick: Phrase,
	getProgressionTags: (lickId: string) => ChordProgressionType[]
): boolean {
	// A tag that the lick's own chord shape doesn't fit is inert everywhere
	// else (picker, session filter, prune), so it must not count here either —
	// otherwise a lick whose only tag is stale is "eligible" yet unpickable.
	return getProgressionTags(lick.id).some(
		(type: ChordProgressionType): boolean => progressionFitsLick(lick, type).fits
	);
}

/**
 * Pick the least-recently-practiced compatible progression for a single lick.
 *
 * Looks only at the `prog:*` tags the user has opted the lick into. Among
 * those, returns the one whose max timestamp in `sessionLog` is smallest;
 * ties resolve to the first fit in `PROGRESSION_TEMPLATES` key order, which
 * mirrors the on-screen pill row. Returns null when the lick has no `prog:*`
 * tags so callers can choose how to handle stranded licks (Daily Practice
 * skips them; the initial-progression picker falls back to DEFAULT_PROGRESSION).
 *
 * The selection algorithm is exactly the inner loop that powered
 * `selectInitialProgression` before this helper was extracted; the function
 * was lifted out so Daily Practice can reuse it per lick rather than only
 * for the single most-neglected lick.
 */
export function pickProgressionForLick(args: {
	lickId: string;
	progressionTags: ChordProgressionType[];
	sessionLog: LickPracticeSessionLogEntry[];
	/**
	 * When given, tagged progressions the lick does not FIT (its own chord
	 * shape vs the template — `progressionFitsLick`) are skipped, so a stale
	 * or cross-device tag can never serve a 3-bar ii-V-i over the half-bar
	 * short template. Callers that omit it keep today's tag-only behaviour.
	 */
	lick?: Phrase;
}): ChordProgressionType | null {
	const { progressionTags, sessionLog, lick } = args;
	if (progressionTags.length === 0) return null;

	const order = Object.keys(PROGRESSION_TEMPLATES) as ChordProgressionType[];
	const userTags = new Set(progressionTags);
	const fits = order.filter(
		(p: ChordProgressionType): boolean => userTags.has(p) && (!lick || progressionFitsLick(lick, p).fits)
	);
	if (fits.length === 0) return null;

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
 * Pick the progression to pre-select on /lick-practice setup.
 *
 * Algorithm: of the user's practice-tagged licks, find the
 * least-recently-practiced one (lastPracticedAt = 0 wins). For that lick,
 * delegate to `pickProgressionForLick` to choose among its tagged
 * progressions.
 *
 * "Stranded" candidates — practice-tagged but with no `prog:*` tag at all
 * — are excluded from the search. Without this guard a stranded lick
 * (e.g. one whose tags were never backfilled, or whose user removed every
 * progression tag) keeps its `lastPracticedAt` at 0 forever, monopolises
 * the most-neglected slot, and forces the picker back to
 * DEFAULT_PROGRESSION every session.
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

	return pickProgressionForLick({
		lickId: neglected.id,
		lick: neglected,
		progressionTags: getProgressionTags(neglected.id),
		sessionLog
	}) ?? DEFAULT_PROGRESSION;
}

/**
 * Build the post-session "Upcoming Licks" list from already-resolved practice
 * dependencies. Pure — keeps the runes-bearing state module thin and lets
 * unit tests exercise the logic without booting the lick-practice runtime.
 *
 * For each candidate, the result includes its last-practiced timestamp (0 if
 * never) and the set of progressions the user has explicitly opted the lick
 * into via `prog:*` tags. Category compatibility no longer auto-fills the
 * list, and substitutions are intentionally excluded — they're an opt-in
 * setup-page toggle, not a one-click action.
 *
 * Licks with no `prog:*` tags are dropped (no actionable CTA). Sorted by
 * `lastPracticedAt` ascending so longest-ago / never-practiced licks bubble
 * to the top; just-finished licks fall to the bottom.
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
		const set = new Set<ChordProgressionType>(getProgressionTags(lick.id));
		if (set.size === 0) continue;

		// Only progressions the lick actually fits are actionable CTAs.
		const progressions = order.filter(
			(t: ChordProgressionType): boolean => set.has(t) && progressionFitsLick(lick, t).fits
		);
		if (progressions.length === 0) continue;
		entries.push({
			lick,
			lastPracticedAt: getLickLastPracticed(progress, lick.id),
			progressions
		});
	}

	entries.sort((a, b) => a.lastPracticedAt - b.lastPracticedAt);
	return entries;
}

/**
 * Practice-tagged licks that have no `prog:*` tags. Such licks can never
 * appear in a session — `getPracticeLicks` and `selectInitialProgression`
 * both require at least one explicit progression opt-in — so they exist
 * only to be surfaced in the UI as "needs progression — fix in the
 * library". After the setup-time backfill, the only way to land here is
 * to manually clear every `prog:*` tag on a practice-tagged lick.
 */
export function findStrandedLicks(args: {
	candidates: Phrase[];
	getProgressionTags: (lickId: string) => ChordProgressionType[];
}): Phrase[] {
	const { candidates, getProgressionTags } = args;
	return candidates.filter((c) => !hasFittingProgression(c, getProgressionTags));
}
