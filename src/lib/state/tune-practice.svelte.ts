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
import { getAllLicks, getBaseLickFromId, isCuratedLickId, transposeLick } from '$lib/phrases/library-loader';
import {
	getEffectivePracticeLickIds,
	hasLickProgress,
	loadLickPracticeProgress
} from '$lib/persistence/lick-practice-store';
import { buildBookIndex, type FreestyleBook } from '$lib/matching/book-index';
import type { FreestyleMatch } from '$lib/matching/freestyle';
import { addFractions, compareFractions, subtractFractions } from '$lib/music/intervals';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import {
	applyInsertionResult,
	assignSuggestRotation,
	buildSessionPhrase,
	buildSessionPlan,
	emptyResultTally,
	headBarsForFlat,
	resolvePickedSuggestion,
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
	/** Play the head (the written melody, one chorus) before the practice chorus. */
	playHead: boolean;
}

/** Everything the route's audio layer needs, returned by session start. */
export interface TunePracticeAudioPlan {
	/** Transposed session sheet — a stable reference for NotationDisplay. */
	sheet: Tune;
	/** The same sheet with the melody cleared — shown once the head is done. */
	changesSheet: Tune;
	/** Head chorus melody (if any) + harmony across every chorus. */
	playedPhrase: Phrase;
	/** Playback-order flatten with provenance (cursor + window projection). */
	flat: FlattenedTune;
	/** Notation-order flatten (chart markers). */
	notationFlat: FlattenedTune;
	/** Bars before the practice material starts (0 without a head). */
	leadBars: number;
	/**
	 * The EFFECTIVE head decision (`config.playHead && hasMelody`). Consumers
	 * must read this rather than `config.playHead`, which ignores that a
	 * melody-less chart never plays a head chorus.
	 */
	playHead: boolean;
	/**
	 * True when the practice chorus is an APPENDED duplicate of the form
	 * (repeat-free chart). False on whole-form-repeat charts, where the
	 * expanded timeline already holds head pass + solo pass — see the jazz
	 * form rule in headBarsForFlat.
	 */
	duplicatedForm: boolean;
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
	/** Freestyle: recognized known licks, in playing order. */
	freestyleMatches: FreestyleMatch[];
	/** Freestyle: the currently-showing applause card, if any. */
	celebration: { name: string; score: number } | null;
	startTime: number;
	elapsedSeconds: number;
}>({
	config: {
		mode: 'suggest',
		strictness: 'standard',
		tempo: 100,
		concertKey: 'C',
		backingStyle: 'swing',
		playHead: true
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
	freestyleMatches: [],
	celebration: null,
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
	tunePractice.freestyleMatches = [];
	tunePractice.celebration = null;
	tunePractice.elapsedSeconds = 0;
}

export interface SessionPreview {
	total: number;
	byType: Partial<Record<ChordProgressionType, number>>;
	uncategorizedCount: number;
	/** Notation-order bar ranges + progression labels for setup-screen chart markers. */
	markers: {
		id: string;
		startBar: number;
		endBarExclusive: number;
		/** Whole-note span for mid-bar band clipping (see RangeMarker.timeRange). */
		timeRange: { start: number; end: number };
		label: string;
		progressionType: ChordProgressionType;
	}[];
}

/**
 * Setup-screen preview mirroring the REAL session plan: the same expanded
 * flatten, non-overlap selection, and head filtering the session will use
 * (counts and bar ranges are transposition-invariant, so the base sheet
 * suffices), plus how many user licks can't match anything for lack of prog
 * tags. Chart markers dedupe repeat occurrences by markerKey.
 */
export function previewSessionPlan(sheet: Tune, playHead: boolean): SessionPreview {
	const flat = flattenTune(sheet, { expandRepeats: true });
	const notationFlat = flattenTune(sheet);
	const hasMelody = flat.notes.some((n) => n.pitch !== null);
	const effectiveHead = playHead && hasMelody;
	const { headBars, formRepeats } = headBarsForFlat(flat);
	const plan = buildSessionPlan({
		flat,
		notationFlat,
		timeSignature: sheet.timeSignature,
		ppq: 480,
		head: effectiveHead ? { bars: headBars, mode: formRepeats ? 'filter' : 'shift' } : undefined,
		detect: (f) => selectNonOverlapping(detectProgressions(f, sheet)),
		match: () => ({ suggestions: [], uncategorized: [] })
	});

	const byType: Partial<Record<ChordProgressionType, number>> = {};
	for (const ip of plan) {
		byType[ip.progressionType] = (byType[ip.progressionType] ?? 0) + 1;
	}

	const markers: SessionPreview['markers'] = [];
	const seenMarker = new Set<string>();
	for (const ip of plan) {
		if (seenMarker.has(ip.markerKey)) continue;
		seenMarker.add(ip.markerKey);
		markers.push({
			id: ip.markerKey,
			startBar: ip.notationBarRange.start,
			endBarExclusive: ip.notationBarRange.endExclusive,
			timeRange: ip.notationTimeRange,
			label: PROGRESSION_TEMPLATES[ip.progressionType].shortName,
			progressionType: ip.progressionType
		});
	}

	let uncategorizedCount = 0;
	const detections = selectNonOverlapping(detectProgressions(notationFlat, sheet));
	if (detections.length > 0) {
		const deps = buildLickMatcherDeps(sheet);
		uncategorizedCount = suggestLicksForProgression(detections[0], deps).uncategorized.length;
	}

	return { total: plan.length, byType, uncategorizedCount, markers };
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

	// A head chorus needs a melody — chords-only charts (iReal imports and
	// most community tunes) would otherwise open with a full silent chorus.
	const hasMelody = flat.notes.some((n) => n.pitch !== null);
	const playHead = tunePractice.config.playHead && hasMelody;
	const mode = tunePractice.config.mode;

	const built = buildSessionPhrase({ flat, timeSignature: transposed.timeSignature, playHead });
	const plan = buildSessionPlan({
		flat,
		notationFlat,
		timeSignature: transposed.timeSignature,
		ppq,
		head: playHead
			? { bars: built.headBars, mode: built.duplicatedForm ? 'shift' : 'filter' }
			: undefined,
		detect: (f) => selectNonOverlapping(detectProgressions(f, transposed)),
		match: (det) => {
			// Suggest mode cycles the FULL eligible list, restricted to licks the
			// user can deploy at this song's tempo and in this spot's key.
			const options =
				mode === 'suggest'
					? { playableKeysOnly: true, sessionTempo: tunePractice.config.tempo }
					: { limit: MAX_SUGGESTIONS };
			const result = suggestLicksForProgression(det, matcherDeps, options);
			return { suggestions: result.suggestions, uncategorized: result.uncategorized };
		}
	});

	const playedPhrase: Phrase = {
		...phrase,
		notes: built.notes,
		harmony: built.harmony,
		difficulty: { ...phrase.difficulty, lengthBars: built.phraseBars }
	};
	const changesSheet: Tune = {
		...transposed,
		sections: transposed.sections.map((sec) => ({ ...sec, notes: [] }))
	};

	tunePractice.tuneId = sheet.id;
	tunePractice.tuneTitle = sheet.title;
	tunePractice.plan = plan;
	tunePractice.pickedSuggestion = mode === 'suggest' ? assignSuggestRotation(plan) : {};
	tunePractice.uncategorizedCount = plan[0]?.uncategorizedCount ?? 0;
	tunePractice.currentIndex = 0;
	tunePractice.windowOpen = false;
	tunePractice.results = [];
	tunePractice.totalPoints = 0;
	tunePractice.streak = 0;
	tunePractice.bestStreak = 0;
	tunePractice.freestyleMatches = [];
	tunePractice.celebration = null;
	tunePractice.startTime = Date.now();
	tunePractice.elapsedSeconds = 0;
	tunePractice.phase = 'count-in';

	return {
		sheet: transposed,
		changesSheet,
		playedPhrase,
		flat,
		notationFlat,
		leadBars: built.headBars,
		duplicatedForm: built.duplicatedForm,
		playHead
	};
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
	const suggestion = resolvePickedSuggestion(ip.suggestions, tunePractice.pickedSuggestion[ip.id]);
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

export function markHead(): void {
	if (tunePractice.phase === 'count-in') tunePractice.phase = 'head';
}

export function markRunning(): void {
	if (tunePractice.phase === 'count-in' || tunePractice.phase === 'head') {
		tunePractice.phase = 'running';
	}
}

/** The name shown on the chart for an insertion point (pick-aware), if any. */
export function suggestionNameFor(ip: InsertionPoint): string | null {
	const suggestion = resolvePickedSuggestion(ip.suggestions, tunePractice.pickedSuggestion[ip.id]);
	return suggestion?.lickName ?? null;
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
	tunePractice.celebration = null;
	tunePractice.phase = 'complete';
}

/**
 * The freestyle recognition pool: licks the user actually KNOWS — practice
 * set members, anything with practice progress, and the user's own or
 * adopted licks — never the whole curated catalog (celebrating a lick the
 * user has never seen would be noise). Read-only store access.
 */
export function buildFreestyleBook(ppq: number): FreestyleBook {
	const licks = getAllLicks();
	const practiceIds = getEffectivePracticeLickIds(licks);
	const progress = loadLickPracticeProgress();
	const known = licks.filter(
		(l) => practiceIds.has(l.id) || hasLickProgress(progress, l.id) || !isCuratedLickId(l.id)
	);
	return buildBookIndex(known, ppq);
}

export function recordFreestyleMatch(match: FreestyleMatch): void {
	tunePractice.freestyleMatches = [...tunePractice.freestyleMatches, match];
	tunePractice.celebration = { name: match.name, score: match.score };
}

export function clearCelebration(): void {
	tunePractice.celebration = null;
}

export function updateElapsedTime(): void {
	if (
		tunePractice.phase === 'count-in' ||
		tunePractice.phase === 'head' ||
		tunePractice.phase === 'running'
	) {
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
	tunePractice.freestyleMatches = [];
	tunePractice.celebration = null;
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
