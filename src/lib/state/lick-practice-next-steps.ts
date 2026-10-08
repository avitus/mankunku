/**
 * Further practice prioritizes weak keys in learning licks (<12 unlocked),
 * then persistent weaknesses in fully unlocked licks. Rank by the median of
 * the last five session outcomes, not the worst attempt in today's report.
 * Learning keys need a weak majority; fully unlocked keys also need at least
 * three weak sessions. A new learning key can qualify on its first session.
 *
 * Pure derivation: the caller supplies unlock state and the session log.
 * Current-session writes and Daily progression slices count only once.
 * Trick entries never enter a lick's deep-practice start path.
 */

import type { PitchClass, Phrase, Mode } from '$lib/types/music';
import { progressionMode } from '$lib/data/progressions';
import { keyLabel } from '$lib/music/notation';
import type { LickPracticePlanItem, LickReport, SessionReport } from '$lib/types/lick-practice';
import { baseSessionId, type LickPracticeSessionLogEntry } from '$lib/persistence/lick-practice-sessions';
import { KEY_FLOOR_THRESHOLD, KEY_PROFICIENT_THRESHOLD } from '$lib/persistence/lick-practice-store';

/**
 * Minimum keys attempted before a bad average is read as grinding rather than
 * a short rough patch. Below this the user hasn't practised enough for
 * "stop" to be useful advice.
 */
export const REST_MIN_ATTEMPTS = 8;

/** Each sitting contributes once, regardless of retries or progression slices. */
export const RECENT_KEY_SESSIONS = 5;
/** Fully unlocked licks need repeated evidence before they get extra practice. */
export const PERSISTENT_WEAK_SESSIONS = 3;

export type NextStepKind = 'rest' | 'drill-weak-key' | 'done';

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
	 * Key to open the drill on alone, in concert pitch — the focus ramp.
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
	 * The session plan, still intact on the report screen: identifies trick
	 * entries, resolves the Phrase to start, and supplies the progression for
	 * legacy report entries that did not record one.
	 */
	plan: readonly LickPracticePlanItem[];
	/** Resolved persisted counts, including the legacy all-12-keys fallback. */
	unlockedKeyCounts: Readonly<Record<string, number>>;
	/** Includes incremental writes of this session; those are replaced by report. */
	sessionLog: readonly LickPracticeSessionLogEntry[];
	currentSessionId: string;

	/**
	 * Concert pitch class and progression mode → display label. Injected so the pure module stays
	 * instrument-agnostic while the copy matches the written-pitch key chips
	 * beside it (a tenor player reading "Drill C" next to an "D" chip would be
	 * a real bug). Defaults to concert spelling.
	 */
	formatKey?: (key: PitchClass, mode: Mode) => string;
}

const pct = (value: number): number => Math.round(value * 100);

/**
 * Build the session's single next step, or null when there is nothing to
 * report on at all (no attempts recorded).
 */
export function buildNextStep(input: NextStepInput): NextStep | null {
	const { report, plan } = input;
	const formatKey = input.formatKey ?? keyLabel;

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

	// Learning licks always rank before fully unlocked licks. A session's
	// worst individual score is never the ranking signal: use typical recent
	// performance, and require a majority of the available sittings to be weak.
	const candidates: WeakKey[] = [];
	for (const lick of lickReports) {
		const unlockedCount = input.unlockedKeyCounts[lick.lickId];
		// Without unlock state we cannot decide which priority this lick belongs to.
		if (unlockedCount === undefined) continue;
		const learning = unlockedCount < 12;
		for (const key of new Set(lick.keys.map((k) => k.key))) {
			const scores = recentKeyScores(input, lick.lickId, key);
			const weakCount = scores.filter((score) => score < KEY_PROFICIENT_THRESHOLD).length;
			if (weakCount <= scores.length / 2) continue;
			if (!learning && weakCount < PERSISTENT_WEAK_SESSIONS) continue;
			candidates.push({
				lick, key, learning, unlockedCount, scores, weakCount, typical: median(scores)
			});
		}
	}
	candidates.sort((a, b) =>
		Number(b.learning) - Number(a.learning) ||
		a.typical - b.typical ||
		a.lick.lickId.localeCompare(b.lick.lickId) || a.key.localeCompare(b.key)
	);
	const weakest = candidates[0];
	if (!weakest) return doneStep(report);

	const { lick, key, learning, unlockedCount, scores, weakCount, typical } = weakest;
	const progression = lick.progressionType ?? plan.find(item => item.phraseId === lick.lickId)?.progressionType;
	const label = formatKey(key, progression ? progressionMode(progression) : 'major');
	const stage = learning
		? `Still learning: ${unlockedCount}/12 keys unlocked.`
		: 'All 12 keys unlocked; this key is persistently weak.';
	const evidence = scores.length === 1
		? `${label} scored ${pct(typical)}% this session.`
		: `${label} was below ${pct(KEY_PROFICIENT_THRESHOLD)}% in ${weakCount} of its last ${scores.length} sessions (typical score ${pct(typical)}%).`;
	return {
		kind: 'drill-weak-key',
		headline: `Drill ${label} on ${lick.lickName}.`,
		reason: `${stage} ${evidence} Deep practice starts on ${label} alone and brings the other keys back once it's up to speed.`,
		action: deepAction(lick.lickId, plan, key)
	};
}

interface WeakKey {
	lick: LickReport;
	key: PitchClass;
	learning: boolean;
	unlockedCount: number;
	scores: number[];
	weakCount: number;
	typical: number;
}

/** Median resists one unusually poor performance (or one unusually good one). */
function median(scores: readonly number[]): number {
	const sorted = [...scores].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Collapse any repeated key attempts to one outcome for this sitting. */
function keyScores(report: SessionReport, lickId: string, key: PitchClass): number[] {
	return report.licks
		.filter((lick) => lick.lickId === lickId)
		.flatMap((lick) => lick.keys)
		.filter((result) => result.key === key && Number.isFinite(result.score))
		.map((result) => result.score);
}

/** Newest five distinct sittings that actually attempted this lick/key. */
function recentKeyScores(input: NextStepInput, lickId: string, key: PitchClass): number[] {
	const sessions = new Map<string, { timestamp: number; scores: number[] }>();
	for (const entry of input.sessionLog) {
		const id = baseSessionId(entry);
		if (id === input.currentSessionId) continue;
		const scores = keyScores(entry.report, lickId, key);
		if (scores.length === 0) continue;
		const previous = sessions.get(id);
		sessions.set(id, {
			timestamp: Math.max(previous?.timestamp ?? entry.timestamp, entry.timestamp),
			scores: [...(previous?.scores ?? []), ...scores]
		});
	}
	const current = keyScores(input.report, lickId, key);
	const prior = [...sessions.values()].sort((a, b) => b.timestamp - a.timestamp);
	return [current, ...prior.map((session) => session.scores)]
		.filter((scores) => scores.length > 0)
		.slice(0, RECENT_KEY_SESSIONS)
		.map((scores) => scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function doneStep(report: SessionReport): NextStep {
	return {
		kind: 'done',
		headline: "That's the session.",
		reason: `${pct(report.overallAverage)}% average over ${report.totalAttempts} keys. No clear learning gap or persistent weakness to prioritize today.`,
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
