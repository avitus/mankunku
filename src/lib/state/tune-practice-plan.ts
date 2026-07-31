import type { Fraction, HarmonicSegment, Note, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Grade, Score } from '$lib/types/scoring';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { TuneSection } from '$lib/types/tune';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	multiplyFraction
} from '$lib/music/intervals';
import { scoreToGrade } from '$lib/scoring/grades';
import { KEY_PROFICIENT_THRESHOLD } from '$lib/persistence/lick-practice-store';

/**
 * Pure planning + accumulation logic for the tune-practice session
 * (`tune-practice.svelte.ts` is the thin runes wrapper; the route owns audio
 * orchestration). Mirrors the lick-practice split where testable logic lives
 * in plain modules (`lick-practice-picker.ts`).
 */

export type TunePracticeMode = 'suggest' | 'points' | 'freestyle';
export type TunePracticeStrictness = 'guided' | 'standard' | 'solo';
export type TunePracticePhase = 'setup' | 'count-in' | 'head' | 'running' | 'complete';

export interface InsertionPoint {
	id: string;
	progressionType: ChordProgressionType;
	localKey: PitchClass;
	/** Tune-key degree label of the local key, e.g. '4' = "the IV key". */
	degreeLabel: string;
	/** Playback-timeline span (whole-note units, from the detector). */
	startOffset: Fraction;
	duration: Fraction;
	playbackBarRange: { start: number; endExclusive: number };
	/** Projection onto the notation timeline (chart markers). */
	notationSegmentIndices: number[];
	notationBarRange: { start: number; endExclusive: number };
	/**
	 * Notation-timeline span in whole-note units (half-open). Used to clip
	 * chart bands to mid-bar boundaries so abutted progressions split a bar
	 * instead of stacking full-bar washes.
	 */
	notationTimeRange: { start: number; end: number };
	/** Groups repeat occurrences: one notation marker ↔ N playback windows. */
	markerKey: string;
	suggestions: LickSuggestion[];
	uncategorizedCount: number;
	/** Absolute transport ticks (count-in included). */
	openTick: number;
	closeTick: number;
}

export interface InsertionResult {
	insertionId: string;
	/** Name of the lick the window was scored against; null for a skipped window. */
	lickName: string | null;
	/** null = no notes captured in the window (skipped, not failed). */
	score: Score | null;
	grade: Grade | null;
	basePoints: number;
	connectionBonus: number;
}

export interface BuildPlanDeps {
	/** Playback-order flatten (expandRepeats), with provenance. */
	flat: FlattenedTune;
	/** Notation-order flatten (chart markers). */
	notationFlat: FlattenedTune;
	timeSignature: [number, number];
	ppq: number;
	/**
	 * The optional head chorus. 'shift' (repeat-free charts): the practice
	 * chorus is an appended duplicate, so every detection shifts by the head's
	 * length. 'filter' (whole-form repeat charts): the expanded timeline
	 * ALREADY contains head pass + solo pass — keep only detections in the
	 * solo pass, unshifted.
	 */
	head?: { bars: number; mode: 'shift' | 'filter' };
	/** Detector composed with non-overlap selection by the caller. */
	detect: (flat: FlattenedTune) => DetectedProgression[];
	match: (detection: DetectedProgression) => {
		suggestions: LickSuggestion[];
		uncategorized: unknown[];
	};
}

const EPSILON = 1e-9;

/**
 * Turn detected progressions into scheduled insertion points. Tick math
 * matches playback.ts exactly: one bar of count-in (`barTicks` offset, the
 * hard-coded playPhrase lead-in) and `wholeNotes * 4 * ppq` per offset. No
 * lead-in — the scorer's DTW + median-latency correction absorb early
 * entries; a 1-beat lead-out captures the resolution's tail, clamped so a
 * window never overlaps the next open or runs past the end of the form.
 */
export function buildSessionPlan(deps: BuildPlanDeps): InsertionPoint[] {
	const { flat, notationFlat, timeSignature, ppq, detect, match } = deps;
	const barTicks = timeSignature[0] * ppq;
	const barWholeNotes = timeSignature[0] / timeSignature[1];
	const head = deps.head;
	// Ticks before the practice timeline's own zero: the 1-bar count-in, plus
	// the head chorus when it is an appended-duplicate ('shift') head. A
	// 'filter' head lives INSIDE the detection timeline, so only the count-in
	// shifts.
	const leadTicks = barTicks + (head?.mode === 'shift' ? head.bars * barTicks : 0);
	const formEndTick = leadTicks + flat.totalBars * barTicks;
	const ticksOf = (f: Fraction) => Math.round(fractionToFloat(f) * 4 * ppq);

	let detections = [...detect(flat)].sort(
		(a, b) => compareFractions(a.startOffset, b.startOffset) || a.type.localeCompare(b.type)
	);
	if (head?.mode === 'filter') {
		// Detections inside the head pass are heard, not practiced.
		const boundary = head.bars * barWholeNotes;
		detections = detections.filter((det) => fractionToFloat(det.startOffset) >= boundary - EPSILON);
	}

	return detections.map((det, i) => {
		const openTick = leadTicks + ticksOf(det.startOffset);
		let closeTick = leadTicks + ticksOf(addFractions(det.startOffset, det.duration)) + ppq;
		const next = detections[i + 1];
		if (next) closeTick = Math.min(closeTick, leadTicks + ticksOf(next.startOffset));
		closeTick = Math.min(closeTick, formEndTick);

		const notationSegmentIndices = det.segmentIndices
			.map((s) => flat.segmentSourceIndices[s])
			.filter((idx): idx is number => idx !== undefined);
		let notationStart = Infinity;
		let notationEnd = -Infinity;
		for (const idx of notationSegmentIndices) {
			const seg = notationFlat.harmony[idx];
			if (!seg) continue;
			notationStart = Math.min(notationStart, fractionToFloat(seg.startOffset));
			notationEnd = Math.max(
				notationEnd,
				fractionToFloat(addFractions(seg.startOffset, seg.duration))
			);
		}
		const notationBarRange = Number.isFinite(notationStart)
			? {
					start: Math.floor(notationStart / barWholeNotes + EPSILON),
					endExclusive: Math.ceil(notationEnd / barWholeNotes - EPSILON)
				}
			: { start: det.startBar, endExclusive: det.endBarExclusive };
		const notationTimeRange = Number.isFinite(notationStart)
			? { start: notationStart, end: notationEnd }
			: {
					start: fractionToFloat(det.startOffset),
					end: fractionToFloat(addFractions(det.startOffset, det.duration))
				};

		const { suggestions, uncategorized } = match(det);

		return {
			id: `ip-${i}`,
			progressionType: det.type,
			localKey: det.localKey,
			degreeLabel: det.tuneKeyDegree.label,
			startOffset: det.startOffset,
			duration: det.duration,
			playbackBarRange: { start: det.startBar, endExclusive: det.endBarExclusive },
			notationSegmentIndices,
			notationBarRange,
			notationTimeRange,
			// Group markers by their notation segment set; fall back to the unique
			// insertion id when provenance is missing, so points with no segment
			// indices don't all collapse under one empty '' key and mis-place.
			markerKey:
				notationSegmentIndices.length > 0
					? [...notationSegmentIndices].sort((a, b) => a - b).join(',')
					: `ip-${i}`,
			suggestions,
			uncategorizedCount: uncategorized.length,
			openTick,
			closeTick
		};
	});
}

/**
 * Where the head ends inside an expanded playback form. THE JAZZ FORM RULE:
 * a repeat around the WHOLE tune outlines the form — head, then solo
 * choruses, then head out — it does NOT mean "play the melody twice". The
 * expanded flatten of such a chart is already "head with first ending, then
 * the form again with second ending", so the head is pass one (everything
 * before the second body begins) and the solo is pass two.
 *
 * Detection reads the EXPANDED section map (the same expansion the audio and
 * chart use) — never the raw repeat markers, which imported charts express
 * inconsistently. A whole-form outline is a repeat where, once the second
 * pass begins (the first revisited section), the replayed body runs to the
 * end with only new tail sections (a second ending / coda) after it. An
 * INTERNAL repeat (e.g. `|: A :| B A` in an AABA chart) interleaves NEW form
 * material with the replayed body — a new section followed by a replayed one
 * — and is an ordinary play-twice repeat, not a form outline; those charts
 * head through the whole form and get an appended solo chorus instead.
 */
export function headBarsForFlat(flat: FlattenedTune): { headBars: number; formRepeats: boolean } {
	const noRepeat = { headBars: flat.totalBars, formRepeats: false };
	const sm = flat.sectionMap;

	const seen = new Set<number>();
	let revisitIdx = -1;
	for (let i = 0; i < sm.length; i++) {
		if (seen.has(sm[i].sourceSection)) {
			revisitIdx = i;
			break;
		}
		seen.add(sm[i].sourceSection);
	}
	if (revisitIdx === -1) return noRepeat;

	// From the second pass onward, a NEW section (never seen in pass one)
	// followed later by a replayed one means new form material is sandwiched
	// inside the repeat → internal repeat, not a whole-form outline.
	let sawNew = false;
	for (let i = revisitIdx; i < sm.length; i++) {
		if (seen.has(sm[i].sourceSection)) {
			if (sawNew) return noRepeat;
		} else {
			sawNew = true;
		}
	}
	return { headBars: sm[revisitIdx].barOffset, formRepeats: true };
}

/**
 * The audio material for a session: an optional head chorus (the written
 * melody, played ONCE — see `headBarsForFlat`) followed by melody-free solo
 * material. On a whole-form-repeat chart the expanded timeline already holds
 * head pass + solo pass, so only the second pass's melody is dropped; on a
 * repeat-free chart the practice chorus is an appended duplicate of the
 * changes. Melody notes are always a prefix of `flat.notes`, so
 * `PlaybackEvent.sourceIndex` values keep indexing `flat.notes` and
 * provenance stays valid.
 */
export function buildSessionPhrase(args: {
	flat: FlattenedTune;
	timeSignature: [number, number];
	playHead: boolean;
}): {
	notes: Note[];
	harmony: HarmonicSegment[];
	phraseBars: number;
	headBars: number;
	duplicatedForm: boolean;
} {
	const { flat, timeSignature, playHead } = args;
	const barDuration: Fraction = [timeSignature[0], timeSignature[1]];
	const barWholeNotes = timeSignature[0] / timeSignature[1];
	const harmony = flat.harmony.map((h) => ({ ...h, chord: { ...h.chord } }));
	if (!playHead) {
		return { notes: [], harmony, phraseBars: flat.totalBars, headBars: 0, duplicatedForm: false };
	}
	const { headBars, formRepeats } = headBarsForFlat(flat);
	if (formRepeats) {
		// The head is pass one of the timeline; keep only its melody (a prefix
		// of flat.notes — sections are emitted in ascending-offset order).
		const boundary = headBars * barWholeNotes;
		const notes = flat.notes
			.filter((n) => fractionToFloat(n.offset) < boundary - EPSILON)
			.map((n) => ({ ...n }));
		return { notes, harmony, phraseBars: flat.totalBars, headBars, duplicatedForm: false };
	}
	const shift = multiplyFraction(barDuration, flat.totalBars);
	const practiceChorus = flat.harmony.map((h) => ({
		...h,
		chord: { ...h.chord },
		startOffset: addFractions(h.startOffset, shift)
	}));
	return {
		notes: flat.notes.map((n) => ({ ...n })),
		harmony: [...harmony, ...practiceChorus],
		phraseBars: flat.totalBars * 2,
		headBars,
		duplicatedForm: true
	};
}

/**
 * Suggest-mode variety: cycle each progression type through its full eligible
 * lick pool across the session's insertion points. Tracks how often each lick
 * has been assigned per progression type and, at every point, picks the
 * least-used eligible lick (ties broken by rank = list order). This surfaces
 * genuinely-different licks even though each point's eligible list can differ
 * in order and length — the target key varies per spot, so a positional
 * index-modulo would repeat one lick and starve another.
 */
export function assignSuggestRotation(plan: readonly InsertionPoint[]): Record<string, number> {
	const usesByType = new Map<ChordProgressionType, Map<string, number>>();
	const picks: Record<string, number> = {};
	for (const ip of plan) {
		if (ip.suggestions.length === 0) continue;
		const uses = usesByType.get(ip.progressionType) ?? new Map<string, number>();
		let bestIdx = 0;
		let bestUses = Infinity;
		ip.suggestions.forEach((s, idx) => {
			const u = uses.get(s.lickId) ?? 0;
			if (u < bestUses) {
				bestUses = u;
				bestIdx = idx;
			}
		});
		picks[ip.id] = bestIdx;
		const chosen = ip.suggestions[bestIdx].lickId;
		uses.set(chosen, (uses.get(chosen) ?? 0) + 1);
		usesByType.set(ip.progressionType, uses);
	}
	return picks;
}

/**
 * Map a playback-form bar (0-based, within one pass of the expanded form) to
 * its notation-chart bar via the flatten's `sectionMap`. Both passes of a
 * repeated section land on the same chart bar. Returns null outside the form.
 */
export function notationBarForPlaybackBar(
	sectionMap: FlattenedTune['sectionMap'],
	sections: readonly Pick<TuneSection, 'bars'>[],
	playbackBar: number
): number | null {
	if (playbackBar < 0) return null;
	const notationBases: number[] = [];
	let acc = 0;
	for (const sec of sections) {
		notationBases.push(acc);
		acc += sec.bars;
	}
	for (const entry of sectionMap) {
		const bars = sections[entry.sourceSection]?.bars ?? 0;
		if (playbackBar >= entry.barOffset && playbackBar < entry.barOffset + bars) {
			return notationBases[entry.sourceSection] + (playbackBar - entry.barOffset);
		}
	}
	return null;
}

export interface StrictnessKnobs {
	octaveInsensitive: boolean;
	bleedFilterEnabled: boolean;
	/** How much the UI reveals: full cues, reduced (keys/countdown only), or none. */
	cueLevel: 'full' | 'reduced' | 'none';
}

/**
 * Strictness maps onto EXISTING pipeline knobs only — the grading scale never
 * changes. Guided/standard mirror continuous lick-practice (octave-insensitive,
 * bleed filter on); solo mirrors call-and-response strictness and respects the
 * user's real bleed-filter preference.
 */
export function strictnessKnobs(
	strictness: TunePracticeStrictness,
	userBleedFilterEnabled: boolean
): StrictnessKnobs {
	switch (strictness) {
		case 'guided':
			return { octaveInsensitive: true, bleedFilterEnabled: true, cueLevel: 'full' };
		case 'standard':
			return { octaveInsensitive: true, bleedFilterEnabled: true, cueLevel: 'reduced' };
		case 'solo':
			return {
				octaveInsensitive: false,
				bleedFilterEnabled: userBleedFilterEnabled,
				cueLevel: 'none'
			};
	}
}

/**
 * The suggestion an insertion window scores against: the user's pick when it
 * is a valid index, else the top-ranked suggestion, else null.
 */
export function resolvePickedSuggestion(
	suggestions: readonly LickSuggestion[],
	pickedIndex: number | undefined
): LickSuggestion | null {
	if (suggestions.length === 0) return null;
	if (pickedIndex !== undefined && pickedIndex >= 0 && pickedIndex < suggestions.length) {
		return suggestions[pickedIndex];
	}
	return suggestions[0];
}

export interface ResultTally {
	results: InsertionResult[];
	totalPoints: number;
	/** Consecutive windows at or above KEY_PROFICIENT_THRESHOLD. */
	streak: number;
	bestStreak: number;
}

export function emptyResultTally(): ResultTally {
	return { results: [], totalPoints: 0, streak: 0, bestStreak: 0 };
}

/**
 * Fold one closed window into the running tally. Points mode awards
 * `round(overall * 100)` base points, doubled by a connection bonus when this
 * window AND the previous one both clear `KEY_PROFICIENT_THRESHOLD` (the
 * existing pass bar — no new thresholds). Suggest mode records grades only.
 * A null score is a skipped window: no points, streak resets.
 */
export function applyInsertionResult(
	tally: ResultTally,
	insertionId: string,
	lickName: string | null,
	score: Score | null,
	mode: TunePracticeMode
): ResultTally {
	const passed = score !== null && score.overall >= KEY_PROFICIENT_THRESHOLD;
	const prevConnected = tally.streak > 0;
	const basePoints = score !== null && mode === 'points' ? Math.round(score.overall * 100) : 0;
	const connectionBonus = mode === 'points' && passed && prevConnected ? basePoints : 0;
	const streak = passed ? tally.streak + 1 : 0;
	return {
		results: [
			...tally.results,
			{
				insertionId,
				lickName,
				score,
				grade: score !== null ? scoreToGrade(score.overall) : null,
				basePoints,
				connectionBonus
			}
		],
		totalPoints: tally.totalPoints + basePoints + connectionBonus,
		streak,
		bestStreak: Math.max(tally.bestStreak, streak)
	};
}

/**
 * Index results by their `insertionId` for plan-point lookup. Results accrue in
 * play order and a skipped window contributes none, so reading them by array
 * position (`results[i]`) maps every later plan point to the WRONG result after
 * any gap — grades, colours, and the report all shift by one. Keyed lookup is
 * gap-safe; each plan entry's id (`ip-<i>`) is unique, so there are no
 * collisions. Later writes for the same id win (a re-annotated repeat pass).
 */
export function indexResultsByInsertion(
	results: readonly InsertionResult[]
): Map<string, InsertionResult> {
	const byId = new Map<string, InsertionResult>();
	for (const r of results) byId.set(r.insertionId, r);
	return byId;
}

/**
 * Whether a played insertion's chart band has aged out — cleared shortly after
 * its scoring window passes so the chart behind the playhead stays clean.
 *
 * `closeTick`/`barTicks` are absolute session ticks (they share the one-bar
 * count-in offset), so `closeBar` and `currentBar` land in the same real-bar
 * space. Unplayed points never clear; a later repeat pass of the same chart
 * position re-annotates through its own (still-upcoming) occurrence.
 */
export function insertionMarkerCleared(args: {
	played: boolean;
	closeTick: number;
	barTicks: number;
	currentBar: number;
	clearAfterBars: number;
}): boolean {
	if (!args.played || args.barTicks <= 0) return false;
	const closeBar = Math.floor((args.closeTick - args.barTicks) / args.barTicks);
	return args.currentBar - closeBar >= args.clearAfterBars;
}
