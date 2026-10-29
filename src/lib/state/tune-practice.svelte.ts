import { savedTunePracticePreferences, saveTunePracticePreferences, savedTuneKey, saveTuneKey, savedTunePracticeStyle, saveTunePracticeStyle, type TunePracticePreferences } from '$lib/tunes/preferences';
import { tuneBackingStyle } from '$lib/tunes/backing-style';
import { savedTunePlayback, saveTunePlayback } from '$lib/tunes/playback-preferences';
import { jamSheets } from '$lib/tunes/jam-sheets';
import { savedSoloChoruses, saveSoloChoruses } from '$lib/tunes/solo-choruses';
import type { Fraction, Phrase, PitchClass } from '$lib/types/music';
import type { Score } from '$lib/types/scoring';
import type { Trick, TrickContext, TrickParameters } from '$lib/types/tricks';
import type { Tune } from '$lib/types/tune';
import type { BackingStyle } from '$lib/types/instruments';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import { flattenTune, type FlattenedTune } from '$lib/tunes/flatten';
import { changesSheetFor } from '$lib/tunes/changes-sheet';
import { suggestBarsPerLine } from '$lib/music/chart-layout';
import type { TuneAbcOptions } from '$lib/music/tune-notation';
import { tuneToPhraseWithFlat } from '$lib/tunes/to-phrase';
import { detectProgressions } from '$lib/tunes/progression-detector';
import { concertKeyToWritten } from '$lib/music/transposition';
import {
	buildLickMatcherDeps,
	isInPlayersBook,
	suggestLicksForProgression,
	type LickSuggestion
} from '$lib/tunes/lick-matcher';
import { transposeTune } from '$lib/tunes/book-loader';
import { getAllLicks, getBaseLickFromId, transposeLick } from '$lib/phrases/library-loader';
import { getTrickById } from '$lib/tricks';
import { getInstrument, settings } from '$lib/state/settings.svelte';
import {
	getEffectivePracticeLickIds,
	loadLickPracticeProgress
} from '$lib/persistence/lick-practice-store';
import { buildBookIndex, type FreestyleBook } from '$lib/matching/book-index';
import type { FreestyleMatch } from '$lib/matching/freestyle';
import { addFractions, compareFractions, subtractFractions } from '$lib/music/intervals';
import { countInBarsForTempo } from '$lib/audio/drum-count-in';
import { isInPickupLeadIn } from '$lib/music/pickup';
import {
	applyInsertionResult,
	assignSuggestRotation,
	buildSessionPhrase,
	buildSessionPlan,
	clearPickupBarHarmony,
	headBarsForFlat,
	notationBarForPlaybackBar,
	resolvePickedSuggestion,
	soloPassPickupBars,
	windowCandidates,
	windowLabel,
	type BuildPlanDeps,
	type CueLevel,
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
 * audio orchestration). Results are not persisted; chorus and playback preferences are local per user.
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
	/**
	 * Saved tune-backing preference, captured for this session. Playback and
	 * bleed evidence read this value so they always agree about the sounding band.
	 */
	backingTrackEnabled: boolean;
	/** Mute melody audio without changing the selected head / solo / outro form. */
	melodyEnabled: boolean;
	metronomeEnabled: boolean;
	/** Practice choruses, excluding the head (1–12). */
	choruses: number;
}

/** Everything the route's audio layer needs, returned by session start. */
export interface TunePracticeAudioPlan {
	/** Transposed session sheet — a stable reference for NotationDisplay. */
	sheet: Tune;
	/**
	 * The same sheet with the melody cleared — shown once the head is done.
	 * Built by `changesSheetFor`, which keeps the pickup bar the melody implied.
	 */
	changesSheet: Tune;
	/**
	 * Engraving options for BOTH sheets: the melody sheet's own bars-per-line
	 * pick, pinned so the changes sheet breaks its systems identically and the
	 * head→changes swap re-engraves the same layout (the density pick reads
	 * note counts, so a melody-free sheet would otherwise widen its lines).
	 */
	chartOptions: TuneAbcOptions;
	/** Head chorus melody (if any) + harmony across every chorus. */
	playedPhrase: Phrase;
	/** Playback-order flatten with provenance (cursor + window projection). */
	flat: FlattenedTune;
	closingSheet: Tune;
	closingFlat: FlattenedTune;
	closingStartBar: number | null;
	separateClosingChart: boolean;
	/** Notation-order flatten (chart markers). */
	notationFlat: FlattenedTune;
	/** Bars before the practice material starts (0 without a head). */
	leadBars: number;
	outroStartBar: number | null;
	outroSourceStartBar: number;
	noteSourceIndices: number[];
	/**
	 * Bars of drum count-in ahead of the tune, from the session tempo — the
	 * lead-in the route hands playPhrase and every transport tick sits behind.
	 */
	countInBars: number;
	/**
	 * The session opens on a pickup bar the band sits out — silent but for
	 * the head's pickup notes — so the count runs on through it (playPhrase's
	 * `countIn.pickup`). The bar stays the form's bar 0: no tick moves.
	 */
	countInPickup: boolean;
	/**
	 * Start of the solo pass within the original expanded chart: after a
	 * whole-form repeat's head pass, and after a pickup bar, which only the
	 * head plays (`soloPassPickupBars`).
	 */
	practiceStartBar: number;
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
		strictness: 'guided',
		tempo: 100,
		concertKey: 'C',
		backingStyle: 'swing',
		choruses: 1,
		playHead: true,
		// Restored from the saved tune preference on setup entry; this initial
		// value only matters before the first setup screen mounts.
		backingTrackEnabled: settings.backingTrackEnabled,
		melodyEnabled: true,
		metronomeEnabled: false
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

/** Restore the active user's last chorus count after browser hydration. */
export function restoreTunePracticeChoruses(): void {
	tunePractice.config.choruses = savedSoloChoruses();
}

/** Remember the chorus count locally for the next tune or visit. */
export function setTunePracticeChoruses(choruses: number): void {
	tunePractice.config.choruses = saveSoloChoruses(choruses);
}

/** Restore once on setup entry; never overwrite the user's choice mid-session. */
export function restoreTunePracticePlaybackPreferences(): void {
	tunePractice.config.backingTrackEnabled = savedTunePlayback('backing', settings.backingTrackEnabled);
	tunePractice.config.melodyEnabled = savedTunePlayback('melody', true);
	tunePractice.config.metronomeEnabled = savedTunePlayback('metronome', false);
}

/** Persist band enablement while keeping playback and bleed evidence in sync. */
export function setTunePracticeBacking(enabled: boolean): void {
	tunePractice.config.backingTrackEnabled = saveTunePlayback('backing', enabled);
}

/** Remember melody audibility independently of the head/outro form choice. */
export function setTunePracticeMelody(enabled: boolean): void {
	tunePractice.config.melodyEnabled = saveTunePlayback('melody', enabled);
}

/** Persist the click setting used by both playback and scoring. */
export function setTunePracticeMetronome(enabled: boolean): void {
	tunePractice.config.metronomeEnabled = saveTunePlayback('metronome', enabled);
}

/** Restore saved choices on each visit, including a client-side return to the same tune. */
export function restoreTunePracticeSettings(sheet: Tune): void {
	Object.assign(tunePractice.config, savedTunePracticePreferences());
	tunePractice.config.concertKey = savedTuneKey(sheet.id, sheet.key);
	tunePractice.config.backingStyle = savedTunePracticeStyle(sheet.id, tuneBackingStyle(sheet, settings.tuneBackingStyles));
	restoreTunePracticeChoruses();
	restoreTunePracticePlaybackPreferences();
}

/** Save only the practice mode, cue level and head/outro choice. */
export function setTunePracticeOptions(options: Partial<TunePracticePreferences>): void {
	Object.assign(tunePractice.config, options);
	saveTunePracticePreferences(tunePractice.config);
}

/** Remember the sounding key for this tune on both tune pages. */
export function setTunePracticeKey(key: PitchClass): void {
	tunePractice.config.concertKey = key;
	if (tunePractice.tuneId) saveTuneKey(tunePractice.tuneId, key);
}

/** Remember this tune’s practice feel without changing its authored style. */
export function setTunePracticeStyle(style: BackingStyle): void {
	tunePractice.config.backingStyle = style;
	if (tunePractice.tuneId) saveTunePracticeStyle(tunePractice.tuneId, style);
}

/** Enter the setup phase for a tune (idempotent per tune). */
export function initTunePractice(sheet: Tune): void {
	restoreTunePracticeSettings(sheet);
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
	/** Planned windows with an eligible lick, including repeat/chorus occurrences. */
	matchedCount: number;
	byType: Partial<Record<ChordProgressionType, number>>;
	uncategorizedCount: number;
	/** Notation-order bands naming the first planned lick at each chart position. */
	markers: {
		id: string;
		startBar: number;
		endBarExclusive: number;
		/** Whole-note span for mid-bar band clipping (see RangeMarker.timeRange). */
		timeRange: { start: number; end: number };
		label: string;
		lickName: string | null;
		progressionType: ChordProgressionType;
	}[];
}

/**
 * Preview the same eligible licks, role windows and rotation that Start uses,
 * without arming a session. Repeated chart positions show their first visit.
 */
export function previewSessionPlan(sheet: Tune, playHead: boolean, choruses = 1): SessionPreview {
	const { plan, pickedSuggestion, audioPlan } = prepareTunePracticeSession(
		sheet, { ...tunePractice.config, playHead, choruses }, 480
	);

	const byType: Partial<Record<ChordProgressionType, number>> = {};
	for (const ip of plan) {
		byType[ip.progressionType] = (byType[ip.progressionType] ?? 0) + 1;
	}

	const markers: SessionPreview['markers'] = [];
	const seenMarker = new Set<string>();
	for (const ip of plan) {
		if (!!ip.closingPass !== (audioPlan.closingStartBar === 0 && audioPlan.separateClosingChart)) continue;
		if (seenMarker.has(ip.markerKey)) continue;
		seenMarker.add(ip.markerKey);
		const lickName = suggestedWindowLabel(ip, pickedSuggestion[ip.id]);
		markers.push({
			id: ip.markerKey,
			startBar: ip.notationBarRange.start,
			endBarExclusive: ip.notationBarRange.endExclusive,
			timeRange: ip.notationTimeRange,
			label: lickName ?? ip.bandName,
			lickName,
			progressionType: ip.progressionType
		});
	}

	return {
		total: plan.length,
		matchedCount: plan.filter(ip => ip.suggestions.length > 0).length,
		byType,
		uncategorizedCount: plan[0]?.uncategorizedCount ?? 0,
		markers
	};
}

/**
 * Build the full session: transpose the sheet to the configured concert key,
 * detect progressions on the playback timeline, rank licks per insertion
 * point and prepare the audio artifacts. Reads the player's book, but never
 * starts audio or changes session state: setup and Start share this builder.
 */
function prepareTunePracticeSession(sheet: Tune, config: TunePracticeConfig, ppq: number): {
	audioPlan: TunePracticeAudioPlan;
	plan: InsertionPoint[];
	pickedSuggestion: Record<string, number>;
} {
	const keyed =
		sheet.key === config.concertKey
			? sheet
			: transposeTune(sheet, config.concertKey);
	const { returning: transposed, closing: closingSheet, soloStartBar } = jamSheets(keyed);
	const separateClosingChart = closingSheet !== transposed;
	const closingFlat = clearPickupBarHarmony(closingSheet, flattenTune(closingSheet, { expandRepeats: true }));
	const closingPickupBars = soloPassPickupBars(closingSheet, closingFlat);
	const expanded = tuneToPhraseWithFlat(transposed, { expandRepeats: true });
	const phrase = expanded.phrase;
	// The band sits the pickup bar out; its chord, if the chart writes one, sounds from bar 1.
	const flat = clearPickupBarHarmony(transposed, expanded.flat);
	const notationFlat = flattenTune(transposed);
	const matcherDeps = buildLickMatcherDeps(transposed, getInstrument());

	// A head chorus needs a melody — chords-only charts (iReal imports and
	// most community tunes) would otherwise open with a full silent chorus.
	const hasMelody = flat.notes.some((n) => n.pitch !== null);
	const playHead = config.playHead && hasMelody;
	const mode = config.mode;

	const { headBars, formRepeats } = headBarsForFlat(flat);
	const choruses = config.choruses;
	// A pickup is played once, with the head; every practice chorus runs bar 1 to the end.
	const pickupBars = Math.max(soloStartBar, soloPassPickupBars(transposed, flat));
	const built = buildSessionPhrase({ flat, timeSignature: transposed.timeSignature, playHead, playOutro: true, choruses, pickupBars, closingFlat, closingPickupBars });
	const countInBars = countInBarsForTempo(config.tempo);
	const practiceStartBar = (formRepeats ? headBars : 0) + pickupBars;
	// The played phrase opens on the head's first bar, or without a head on
	// the solo pass's first; the count runs on when that bar is a pickup.
	const firstChartBar = notationBarForPlaybackBar(flat.sectionMap, transposed.sections, playHead ? 0 : practiceStartBar);
	const countInPickup = firstChartBar !== null && isInPickupLeadIn(transposed, firstChartBar);
	const planDeps: BuildPlanDeps = {
		countInBars,
		pickupBars,
		flat,
		notationFlat,
		timeSignature: transposed.timeSignature,
		ppq,
		choruses,
		head: formRepeats
			? { bars: headBars, mode: playHead ? 'filter' : 'skip' }
			: playHead ? { bars: built.headBars, mode: 'shift' } : undefined,
		// Every detection, overlaps included: the planner keeps the longest
		// window that has a lick and fills the rest shorter.
		detect: (f) => detectProgressions(f, transposed),
		match: (det) => {
			// Every mode offers only the player's own book: the session names a
			// lick and shows no notation, so an unpracticed curated lick would be
			// a title with nothing to play (2026-10-07). Suggest mode cycles the
			// FULL eligible list, further restricted to licks the user can deploy
			// at this song's tempo and in this spot's key.
			const options =
				mode === 'suggest'
					? { ownBookOnly: true, playableKeysOnly: true, sessionTempo: config.tempo }
					: { ownBookOnly: true };
			const result = suggestLicksForProgression(det, matcherDeps, options);
			return { suggestions: result.suggestions, uncategorized: result.uncategorized };
		},
		// Points mode caps the pick card; the cap applies per chosen window, so
		// a role's licks are never crowded out by another role's on the same
		// progression.
		suggestionLimit: mode === 'suggest' ? undefined : MAX_SUGGESTIONS
	};
	let plan = buildSessionPlan(planDeps);
	if (!playHead && separateClosingChart) {
		const closingStart = built.closingStartBar!;
		const closingTick = (countInBars + closingStart) * transposed.timeSignature[0] * ppq;
		plan = plan.filter(ip => ip.openTick < closingTick);
		const lastSolo = buildSessionPlan({ ...planDeps, flat: closingFlat, notationFlat: flattenTune(closingSheet),
			pickupBars: closingPickupBars, choruses: 1, head: { bars: closingStart, mode: 'shift' },
			detect: f => detectProgressions(f, closingSheet) });
		plan.push(...lastSolo.map((ip, i) => ({ ...ip, id: `ip-closing-${i}`, closingPass: true })));
	}

	const playedPhrase: Phrase = {
		...phrase,
		notes: built.notes,
		harmony: built.harmony,
		// The band reads the complete emitted session, including its resolved ending.
		sectionMap: built.sectionMap,
		performanceForm: built.performanceForm,
		difficulty: { ...phrase.difficulty, lengthBars: built.phraseBars }
	};
	const changesSheet = changesSheetFor(transposed);
	const chartOptions: TuneAbcOptions = { barsPerLine: suggestBarsPerLine(transposed) };

	const audioPlan: TunePracticeAudioPlan = {
		sheet: transposed,
		closingSheet, closingFlat, closingStartBar: built.closingStartBar, separateClosingChart,
		changesSheet,
		chartOptions,
		playedPhrase,
		flat,
		notationFlat,
		leadBars: built.headBars,
		outroStartBar: built.outroStartBar,
		outroSourceStartBar: built.outroSourceStartBar,
		noteSourceIndices: built.noteSourceIndices,
		countInBars,
		countInPickup,
		practiceStartBar,
		duplicatedForm: built.duplicatedForm,
		playHead
	};
	return { audioPlan, plan, pickedSuggestion: mode === 'suggest' ? assignSuggestRotation(plan) : {} };
}

/** Arm the already-shared plan only when the player presses Start. */
export function startTunePracticeSession(sheet: Tune, ppq: number): TunePracticeAudioPlan {
	const { audioPlan, plan, pickedSuggestion } = prepareTunePracticeSession(sheet, tunePractice.config, ppq);

	tunePractice.tuneId = sheet.id;
	tunePractice.tuneTitle = sheet.title;
	tunePractice.plan = plan;
	tunePractice.pickedSuggestion = pickedSuggestion;
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

	return audioPlan;
}

/**
 * Resolve the expected phrase for one suggestion in an insertion window:
 * the lick transposed to its target key, with note offsets shifted by the
 * suggestion's alignment inside the window so the scorer's timeline matches
 * what the user is asked to play (window open = time zero).
 */
export function expectedForSuggestion(
	ip: InsertionPoint,
	suggestion: LickSuggestion
): { phrase: Phrase; lickName: string } | null {
	let transposed: Phrase;
	if (suggestion.trick && suggestion.phrase) {
		// Synthetic trick suggestion: the generated example is ALREADY in the
		// target key — no transposeLick — but it shifts like any lick.
		transposed = suggestion.phrase;
	} else {
		const lick = getBaseLickFromId(suggestion.lickId);
		if (!lick) return null;
		transposed = transposeLick(lick, suggestion.targetKey);
	}
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

/** A trick suggestion's scoring parts — windows with these score via Fluency. */
export interface TrickWindowInfo {
	trick: Trick;
	parameters: TrickParameters;
	context: TrickContext;
	/**
	 * The suggestion's alignment inside the window (the same math
	 * `expectedForSuggestion` applies to note offsets): the window opens at the
	 * progression start but the trick is aligned to a later bar, so the
	 * scorer's played onsets must be rebased by it.
	 */
	shift: Fraction;
}

/**
 * Resolve one suggestion's trick parts, or null when it is not a trick (or
 * its trick id is unknown). A non-null result scores via Fluency instead of
 * the exact-phrase pipeline.
 */
export function trickForSuggestion(
	ip: InsertionPoint,
	suggestion: LickSuggestion
): TrickWindowInfo | null {
	if (!suggestion.trick) return null;
	const trick = getTrickById(suggestion.trick.trickId);
	if (!trick) return null;
	return {
		trick,
		parameters: suggestion.trick.parameters,
		context: suggestion.trick.context,
		shift: subtractFractions(suggestion.insertionOffset, ip.startOffset)
	};
}

/** One answer a window accepts: the lick's window-aligned phrase, or its trick. */
export interface WindowCandidate {
	lickName: string;
	/** The transposed, window-aligned phrase; null when the lick could not be resolved. */
	phrase: Phrase | null;
	/** Non-null when the candidate is a trick — scored via Fluency, not the phrase. */
	trickInfo: TrickWindowInfo | null;
}

/**
 * The answers an insertion window is scored against, resolved from the plan's
 * suggestions by the strictness cue level (`windowCandidates`): the named
 * lick alone when the chart names licks, every fitting suggestion otherwise.
 * Resolved once at window open, so a pick made after the downbeat cannot
 * change what the take is scored against.
 *
 * Scoring every candidate is cheap enough to run in the close handler: an
 * UNRESTRICTED list is 260 suggestions at its worst across the curated tunes,
 * and scoring all 260 through `runScorePipeline` measures 0.6-2.2 ms (2026-09-11)
 * — orders below the segmentation that precedes it. Production lists are far
 * smaller anyway: every mode passes `ownBookOnly`, suggest mode adds
 * `playableKeysOnly` (the player's own unlocked vocabulary) and points mode
 * caps at `MAX_SUGGESTIONS`. The cap that matters is therefore about MEANING,
 * not speed — a best-of-N over the whole curated catalog would let some lick
 * fluke a match against any take, which is why the candidate pool stays the
 * player's own book (`isInPlayersBook`), as freestyle recognition does with
 * `buildFreestyleBook`.
 */
export function candidatesForWindow(ip: InsertionPoint, cueLevel: CueLevel): WindowCandidate[] {
	return windowCandidates(ip.suggestions, tunePractice.pickedSuggestion[ip.id], cueLevel).map(
		(s) => ({
			lickName: s.lickName,
			phrase: expectedForSuggestion(ip, s)?.phrase ?? null,
			trickInfo: trickForSuggestion(ip, s)
		})
	);
}

export function pickSuggestion(insertionId: string, index: number): void {
	tunePractice.pickedSuggestion[insertionId] = index;
}

export function markHead(): void {
	if (tunePractice.phase === 'count-in') tunePractice.phase = 'head';
}

/** Leave the scored solo phase and close any remaining insertion window. */
export function markOutro(): void {
	if (tunePractice.phase === 'running') {
		tunePractice.phase = 'outro';
		tunePractice.windowOpen = false;
	}
}

export function markRunning(): void {
	if (tunePractice.phase === 'count-in' || tunePractice.phase === 'head') {
		tunePractice.phase = 'running';
	}
}

/**
 * The text shown on the chart for an insertion point (pick-aware), if any:
 * the lick and the written key it is played in (`windowLabel`).
 */
export function suggestionNameFor(ip: InsertionPoint): string | null {
	return suggestedWindowLabel(ip, tunePractice.pickedSuggestion[ip.id]);
}

/** Resolve the selected suggestion into a lick name and instrument-written key. */
function suggestedWindowLabel(ip: InsertionPoint, pickedIndex: number | undefined): string | null {
	const suggestion = resolvePickedSuggestion(ip.suggestions, pickedIndex);
	if (!suggestion) return null;
	return windowLabel(
		suggestion.lickName,
		concertKeyToWritten(suggestion.targetKey, getInstrument()),
		suggestion.mode
	);
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
	const known = licks.filter((l) => isInPlayersBook(l.id, practiceIds, progress));
	return buildBookIndex(known, ppq);
}

export function recordFreestyleMatch(match: FreestyleMatch): void {
	tunePractice.freestyleMatches = [...tunePractice.freestyleMatches, match];
	tunePractice.celebration = { name: match.name, score: match.score };
}

export function clearCelebration(): void {
	tunePractice.celebration = null;
}

/** Refresh elapsed seconds only while the take is active. */
export function updateElapsedTime(): void {
	if (
		tunePractice.phase === 'count-in' ||
		tunePractice.phase === 'head' ||
		tunePractice.phase === 'running' ||
		tunePractice.phase === 'outro'
	) {
		tunePractice.elapsedSeconds = Math.floor((Date.now() - tunePractice.startTime) / 1000);
	}
}

/**
 * Return to the setup screen, clearing everything a take produced (plan,
 * results, streaks, picks, celebration) while leaving the config's own
 * choices alone. Used by "practice again" and by the route's guard against a
 * mid-session phase left behind by navigating away. It IS an arrival at
 * setup, so the audio switches restore the last saved tune preferences.
 */
export function resetTunePractice(): void {
	tunePractice.phase = 'setup';
	restoreTunePracticePlaybackPreferences();
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
	type InsertionPoint,
	type InsertionResult,
	type TunePracticeMode,
	type TunePracticePhase,
	type TunePracticeStrictness
};
