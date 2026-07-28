import type { Phrase, PitchClass } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';
import type { Tune } from '$lib/types/tune';
import type { BackingStyle } from '$lib/types/instruments';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { flattenTune, type FlattenedTune } from '$lib/tunes/flatten';
import { tuneToPhraseWithFlat } from '$lib/tunes/to-phrase';
import { detectProgressions, selectNonOverlapping } from '$lib/tunes/progression-detector';
import { buildLickMatcherDeps, suggestLicksForProgression } from '$lib/tunes/lick-matcher';
import { transposeTune } from '$lib/tunes/book-loader';
import { getBaseLickFromId, transposeLick } from '$lib/phrases/library-loader';
import { addFractions, compareFractions, subtractFractions } from '$lib/music/intervals';
import {
	applyInsertionResult,
	buildSessionPlan,
	carveMelody,
	emptyResultTally,
	type InsertionPoint,
	type InsertionResult,
	type TunePracticeMode,
	type TunePracticePhase,
	type TunePracticeStrictness
} from './tune-practice-plan';

/**
 * Scored tune-practice session state — thin Svelte-5 runes wrapper over the
 * pure logic in `tune-practice-plan.ts` (the lick-practice pattern: state
 * module bridges, plain modules carry the testable logic; the route owns the
 * audio orchestration). Not persisted.
 */

export interface TunePracticeConfig {
	mode: TunePracticeMode;
	strictness: TunePracticeStrictness;
	tempo: number;
	/** Concert key the session sheet is transposed to (set via written-key pills). */
	concertKey: PitchClass;
	backingStyle: BackingStyle;
	/** Play the written melody outside insertion windows (suggest/points). */
	playMelody: boolean;
}

/** Everything the route's audio layer needs, returned by session start. */
export interface TunePracticeAudioPlan {
	/** Transposed session sheet — a stable reference for NotationDisplay. */
	sheet: Tune;
	/** Playback phrase (melody carved out of windows; full harmony intact). */
	playedPhrase: Phrase;
	/** Playback-order flatten with provenance (cursor + window projection). */
	flat: FlattenedTune;
	/** Notation-order flatten (chart markers). */
	notationFlat: FlattenedTune;
}

const MAX_SUGGESTIONS = 5;

export const tunePractice = $state<{
	config: TunePracticeConfig;
	phase: TunePracticePhase;
	tuneId: string | null;
	tuneTitle: string;
	plan: InsertionPoint[];
	/** Uncategorized user licks in the pool (needs-setup hint on the setup screen). */
	uncategorizedCount: number;
	/** Index of the next-or-open insertion point. */
	currentIndex: number;
	windowOpen: boolean;
	results: InsertionResult[];
	totalPoints: number;
	streak: number;
	bestStreak: number;
	/** Points mode: insertion id → chosen suggestion index (default 0). */
	pickedSuggestion: Record<string, number>;
	startTime: number;
	elapsedSeconds: number;
}>({
	config: {
		mode: 'suggest',
		strictness: 'standard',
		tempo: 100,
		concertKey: 'C',
		backingStyle: 'swing',
		playMelody: true
	},
	phase: 'setup',
	tuneId: null,
	tuneTitle: '',
	plan: [],
	uncategorizedCount: 0,
	currentIndex: 0,
	windowOpen: false,
	results: [],
	totalPoints: 0,
	streak: 0,
	bestStreak: 0,
	pickedSuggestion: {},
	startTime: 0,
	elapsedSeconds: 0
});

/** Enter the setup phase for a tune (idempotent per tune). */
export function initTunePractice(sheet: Tune): void {
	if (tunePractice.tuneId !== sheet.id) {
		tunePractice.config.concertKey = sheet.key;
	}
	tunePractice.tuneId = sheet.id;
	tunePractice.tuneTitle = sheet.title;
	tunePractice.phase = 'setup';
	tunePractice.plan = [];
	tunePractice.currentIndex = 0;
	tunePractice.windowOpen = false;
	tunePractice.results = [];
	tunePractice.totalPoints = 0;
	tunePractice.streak = 0;
	tunePractice.bestStreak = 0;
	tunePractice.pickedSuggestion = {};
	tunePractice.elapsedSeconds = 0;
}

export interface SessionPreview {
	total: number;
	byType: Partial<Record<ChordProgressionType, number>>;
	uncategorizedCount: number;
	/** Notation-order bar ranges for setup-screen chart markers. */
	markers: { id: string; startBar: number; endBarExclusive: number }[];
}

/**
 * Cheap setup-screen preview: how many insertion points the detector finds
 * (counts and bar ranges are transposition-invariant, so the base sheet
 * suffices) and how many user licks can't match anything for lack of prog
 * tags. Runs on the notation-order flatten — the detector's bar fields are
 * already chart bars.
 */
export function previewSessionPlan(sheet: Tune): SessionPreview {
	const detections = selectNonOverlapping(detectProgressions(flattenTune(sheet), sheet));
	const byType: Partial<Record<ChordProgressionType, number>> = {};
	for (const det of detections) {
		byType[det.type] = (byType[det.type] ?? 0) + 1;
	}
	let uncategorizedCount = 0;
	if (detections.length > 0) {
		const deps = buildLickMatcherDeps(sheet);
		uncategorizedCount = suggestLicksForProgression(detections[0], deps).uncategorized.length;
	}
	return {
		total: detections.length,
		byType,
		uncategorizedCount,
		markers: detections.map((det, i) => ({
			id: `preview-${i}`,
			startBar: det.startBar,
			endBarExclusive: det.endBarExclusive
		}))
	};
}

/**
 * Build the full session: transpose the sheet to the configured concert key,
 * detect progressions on the playback timeline, rank licks per insertion
 * point, carve the melody out of the windows, and arm the state machine.
 * Returns the audio artifacts the route schedules playback from.
 */
export function startTunePracticeSession(sheet: Tune, ppq: number): TunePracticeAudioPlan {
	const transposed =
		sheet.key === tunePractice.config.concertKey
			? sheet
			: transposeTune(sheet, tunePractice.config.concertKey);
	const { phrase, flat } = tuneToPhraseWithFlat(transposed, { expandRepeats: true });
	const notationFlat = flattenTune(transposed);
	const matcherDeps = buildLickMatcherDeps(transposed);

	const plan = buildSessionPlan({
		flat,
		notationFlat,
		timeSignature: transposed.timeSignature,
		ppq,
		detect: (f) => selectNonOverlapping(detectProgressions(f, transposed)),
		match: (det) => {
			const result = suggestLicksForProgression(det, matcherDeps, { limit: MAX_SUGGESTIONS });
			return { suggestions: result.suggestions, uncategorized: result.uncategorized };
		}
	});

	const mode = tunePractice.config.mode;
	const carving = mode !== 'freestyle' && tunePractice.config.playMelody;
	const playedPhrase = carving
		? {
				...phrase,
				notes: carveMelody(
					phrase.notes,
					plan.map((ip) => ({ start: ip.startOffset, end: addFractions(ip.startOffset, ip.duration) }))
				)
			}
		: phrase;

	tunePractice.tuneId = sheet.id;
	tunePractice.tuneTitle = sheet.title;
	tunePractice.plan = plan;
	tunePractice.uncategorizedCount = plan[0]?.uncategorizedCount ?? 0;
	tunePractice.currentIndex = 0;
	tunePractice.windowOpen = false;
	tunePractice.results = [];
	tunePractice.totalPoints = 0;
	tunePractice.streak = 0;
	tunePractice.bestStreak = 0;
	tunePractice.startTime = Date.now();
	tunePractice.elapsedSeconds = 0;
	tunePractice.phase = 'count-in';

	return { sheet: transposed, playedPhrase, flat, notationFlat };
}

/**
 * Resolve the expected phrase for an insertion window: the picked (or top)
 * suggestion, transposed to its target key, with note offsets shifted by the
 * suggestion's alignment inside the window so the scorer's timeline matches
 * what the user is asked to play (window open = time zero).
 */
export function expectedForWindow(
	ip: InsertionPoint
): { phrase: Phrase; lickName: string } | null {
	const pickedIdx = tunePractice.pickedSuggestion[ip.id] ?? 0;
	const suggestion = ip.suggestions[pickedIdx] ?? ip.suggestions[0];
	if (!suggestion) return null;
	const lick = getBaseLickFromId(suggestion.lickId);
	if (!lick) return null;
	const transposed = transposeLick(lick, suggestion.targetKey);
	const shift = subtractFractions(suggestion.insertionOffset, ip.startOffset);
	if (compareFractions(shift, [0, 1]) === 0) {
		return { phrase: transposed, lickName: suggestion.lickName };
	}
	return {
		phrase: {
			...transposed,
			notes: transposed.notes.map((n) => ({ ...n, offset: addFractions(n.offset, shift) })),
			harmony: transposed.harmony.map((h) => ({
				...h,
				startOffset: addFractions(h.startOffset, shift)
			}))
		},
		lickName: suggestion.lickName
	};
}

export function pickSuggestion(insertionId: string, index: number): void {
	tunePractice.pickedSuggestion[insertionId] = index;
}

export function markRunning(): void {
	if (tunePractice.phase === 'count-in') tunePractice.phase = 'running';
}

export function markWindowOpen(index: number): void {
	tunePractice.currentIndex = index;
	tunePractice.windowOpen = true;
}

/** Fold a closed window into the tally and advance to the next insertion point. */
export function recordWindowResult(
	insertionId: string,
	lickName: string | null,
	score: Score | null
): void {
	tunePractice.windowOpen = false;
	const tally = applyInsertionResult(
		{
			results: tunePractice.results,
			totalPoints: tunePractice.totalPoints,
			streak: tunePractice.streak,
			bestStreak: tunePractice.bestStreak
		},
		insertionId,
		lickName,
		score,
		tunePractice.config.mode
	);
	tunePractice.results = tally.results;
	tunePractice.totalPoints = tally.totalPoints;
	tunePractice.streak = tally.streak;
	tunePractice.bestStreak = tally.bestStreak;
	tunePractice.currentIndex = Math.min(tunePractice.currentIndex + 1, tunePractice.plan.length);
}

export function completeTunePracticeSession(): void {
	tunePractice.windowOpen = false;
	tunePractice.phase = 'complete';
}

export function updateElapsedTime(): void {
	if (tunePractice.phase === 'count-in' || tunePractice.phase === 'running') {
		tunePractice.elapsedSeconds = Math.floor((Date.now() - tunePractice.startTime) / 1000);
	}
}

export function resetTunePractice(): void {
	tunePractice.phase = 'setup';
	tunePractice.plan = [];
	tunePractice.currentIndex = 0;
	tunePractice.windowOpen = false;
	tunePractice.results = [];
	tunePractice.totalPoints = 0;
	tunePractice.streak = 0;
	tunePractice.bestStreak = 0;
	tunePractice.pickedSuggestion = {};
	tunePractice.elapsedSeconds = 0;
}

// Re-exported so route-level consumers import session vocabulary from one place.
export {
	emptyResultTally,
	type InsertionPoint,
	type InsertionResult,
	type TunePracticeMode,
	type TunePracticePhase,
	type TunePracticeStrictness
};
