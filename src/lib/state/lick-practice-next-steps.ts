/**
 * End-of-session next step — the single recommendation shown on the
 * lick-practice report.
 *
 * Deliberately ONE suggestion, or none. A list of things to do next is a wall
 * of advice; the value here is that the app names the one gate that actually
 * bound this session and makes it startable in a tap.
 *
 * Three outcomes, in order:
 *
 * 1. **Rest veto.** A sub-floor average over enough keys means the engine has
 *    already stepped the tempo down and blocked the unlock
 *    (`computeAutoTempoAdjustment`, the `KEY_FLOOR_THRESHOLD` gate in
 *    `lick-practice.svelte.ts`). More reps in the same sitting is the one
 *    thing that makes it worse, so this is exclusive — nothing else is
 *    considered.
 * 2. **The one recommendation.** The weakest key under the floor if there is
 *    one, otherwise the weakest lick. Both tee up Deep Practice. The weak-key
 *    step hands over the key as a **focus key**: the drill opens on that key
 *    alone and works it back up to speed before the other keys return (the
 *    focus ramp — `FocusRamp`). The weak-lick step passes no key: deep
 *    practice already sorts the whole rotation worst-first by rolling score
 *    and demos the head key while it is below proficient, so it lands on the
 *    offending key by itself, with the reference played.
 * 3. **Nothing worth flagging.** Every lick at or above
 *    `KEY_PROFICIENT_THRESHOLD` — by the engine's own definition the session
 *    earned its unlocks and tempo — so we say so and get out of the way.
 *
 * Pure and Node-testable: no runes, no storage reads, no `Date.now()`. The
 * whole thing is a derivation of the report that the caller already has, which
 * is why none of it is persisted.
 *
 * Trick report entries are never targeted: their `lickId` is the composite
 * variant key (`trickVariantKey`), and handing one to a lick start path would
 * both miss and risk variant keys entering lick-store blobs.
 */

import type { PitchClass, Phrase } from '$lib/types/music';
import type { LickPracticePlanItem, LickReport, SessionReport } from '$lib/types/lick-practice';
import { KEY_FLOOR_THRESHOLD, KEY_PROFICIENT_THRESHOLD } from '$lib/persistence/lick-practice-store';

/**
 * Minimum keys attempted before a bad average is read as grinding rather than
 * a short rough patch. Below this the user hasn't practised enough for
 * "stop" to be useful advice.
 */
export const REST_MIN_ATTEMPTS = 8;

/**
 * How far rhythm must trail pitch on the weak key before we call it a timing
 * problem rather than a note problem. Below this the two are close enough
 * that naming one would be guessing.
 */
export const RHYTHM_GAP = 0.15;

export type NextStepKind =
	/** Stop for today — the session is already past the point of diminishing returns. */
	| 'rest'
	/** Deep-practice the lick holding the single weakest key. */
	| 'drill-weak-key'
	/** Deep-practice the lowest-averaging lick (no key tripped the floor). */
	| 'drill-weak-lick'
	/** Nothing to flag. */
	| 'done';

export interface NextStepAction {
	/** Only Deep Practice is offered today; the literal keeps the union open. */
	kind: 'deep';
	lickId: string;
	/**
	 * The plan item's resolved Phrase, when it had one. `startSingleLickSession`
	 * accepts `string | Phrase`, and `getLickById` misses for user/community
	 * licks — passing the Phrase is what keeps those startable.
	 */
	phrase?: Phrase;
	/**
	 * Key to open the drill on ALONE — the focus ramp. Set by the weak-key
	 * step only; the weak-lick step wants the whole rotation.
	 */
	focusKey?: PitchClass;
	/** Button copy. */
	label: string;
}

export interface NextStep {
	kind: NextStepKind;
	/** Imperative one-liner. */
	headline: string;
	/** One sentence of why, carrying the number that fired the rule. */
	reason: string;
	/** null when the right answer is to do nothing. */
	action: NextStepAction | null;
}

export interface NextStepInput {
	report: SessionReport;
	/**
	 * The session plan, still intact on the report screen. Read for two things
	 * only: which report entries are trick items, and the resolved Phrase to
	 * hand to the start path.
	 */
	plan: readonly LickPracticePlanItem[];
	/**
	 * Concert pitch class → display label. Injected so the pure module stays
	 * instrument-agnostic while the copy matches the written-pitch key chips
	 * beside it (a tenor player reading "Drill C" next to an "D" chip would be
	 * a real bug). Defaults to concert spelling.
	 */
	formatKey?: (key: PitchClass) => string;
}

const pct = (value: number): number => Math.round(value * 100);

/**
 * Build the session's single next step, or null when there is nothing to
 * report on at all (no attempts recorded).
 */
export function buildNextStep(input: NextStepInput): NextStep | null {
	const { report, plan } = input;
	const formatKey = input.formatKey ?? ((key: PitchClass) => key as string);

	if (report.licks.length === 0) return null;

	// Rule 1 — exclusive. Evaluated over the session totals, so a grind is a
	// grind whether the reps were licks or tricks.
	if (report.overallAverage < KEY_FLOOR_THRESHOLD && report.totalAttempts >= REST_MIN_ATTEMPTS) {
		return {
			kind: 'rest',
			headline: 'Call it for today.',
			reason: `You averaged ${pct(report.overallAverage)}% over ${report.totalAttempts} keys. Another round now just rehearses the mistakes.`,
			action: null
		};
	}

	const trickIds = new Set(
		plan.filter((item) => item.kind === 'trick').map((item) => item.phraseId)
	);
	const lickReports = report.licks.filter((l) => !trickIds.has(l.lickId));
	if (lickReports.length === 0) return doneStep(report);

	// Rule 2a — the single weakest key under the floor, across every lick.
	let weakest: { lick: LickReport; key: LickReport['keys'][number] } | null = null;
	for (const lick of lickReports) {
		for (const key of lick.keys) {
			if (key.score >= KEY_FLOOR_THRESHOLD) continue;
			if (!weakest || key.score < weakest.key.score) weakest = { lick, key };
		}
	}

	if (weakest) {
		const { lick, key } = weakest;
		const timing = key.rhythmAccuracy < key.pitchAccuracy - RHYTHM_GAP;
		return {
			kind: 'drill-weak-key',
			headline: `Drill ${formatKey(key.key)} on ${lick.lickName}.`,
			reason:
				`It came in at ${pct(key.score)}% — one key under ${pct(KEY_FLOOR_THRESHOLD)}% blocks both the tempo bump and your next key.` +
				(timing ? " It's the time, not the notes." : '') +
				` Deep practice starts on ${formatKey(key.key)} alone and brings the other keys back once it's up to speed.`,
			action: deepAction(lick.lickId, plan, key.key)
		};
	}

	// Rule 2b — nothing tripped the floor, so the weakest lick overall. A lick
	// at or above proficient earned its unlock and its tempo bump; there is
	// nothing there to flag.
	const lowest = lickReports.reduce((worst, l) => (l.averageScore < worst.averageScore ? l : worst));
	if (lowest.averageScore >= KEY_PROFICIENT_THRESHOLD) return doneStep(report);

	// "the weakest of the set" is only true when there was a set — a deep
	// practice session reports one lick.
	const rank = lickReports.length > 1 ? ', the weakest of the set' : '';
	return {
		kind: 'drill-weak-lick',
		headline: `Another pass on ${lowest.lickName}.`,
		reason: `It averaged ${pct(lowest.averageScore)}%${rank}. Deep practice starts on its worst key and demos it first.`,
		action: deepAction(lowest.lickId, plan)
	};
}

function doneStep(report: SessionReport): NextStep {
	return {
		kind: 'done',
		headline: "That's the session.",
		reason: `${pct(report.overallAverage)}% average over ${report.totalAttempts} keys. Nothing here needs another round today.`,
		action: null
	};
}

function deepAction(
	lickId: string,
	plan: readonly LickPracticePlanItem[],
	focusKey?: PitchClass
): NextStepAction {
	// A report entry always has a plan item in practice; tolerate a miss rather
	// than dropping the recommendation, since the bare id still resolves for
	// every curated lick.
	const item = plan.find((p) => p.phraseId === lickId && p.kind !== 'trick');
	return {
		kind: 'deep',
		lickId,
		phrase: item?.phrase,
		...(focusKey ? { focusKey } : {}),
		label: 'Start deep practice'
	};
}
