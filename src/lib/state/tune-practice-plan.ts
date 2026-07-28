import type { Fraction, Note, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Grade, Score } from '$lib/types/scoring';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import { addFractions, compareFractions, fractionToFloat } from '$lib/music/intervals';
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
export type TunePracticePhase = 'setup' | 'count-in' | 'running' | 'complete';

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
	const formEndTick = barTicks + flat.totalBars * barTicks;
	const ticksOf = (f: Fraction) => Math.round(fractionToFloat(f) * 4 * ppq);

	const detections = [...detect(flat)].sort(
		(a, b) => compareFractions(a.startOffset, b.startOffset) || a.type.localeCompare(b.type)
	);

	return detections.map((det, i) => {
		const openTick = barTicks + ticksOf(det.startOffset);
		let closeTick = barTicks + ticksOf(addFractions(det.startOffset, det.duration)) + ppq;
		const next = detections[i + 1];
		if (next) closeTick = Math.min(closeTick, barTicks + ticksOf(next.startOffset));
		closeTick = Math.min(closeTick, formEndTick);

		const notationSegmentIndices = det.segmentIndices.map(
			(s) => flat.segmentSourceIndices[s]
		);
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
			markerKey: [...notationSegmentIndices].sort((a, b) => a - b).join(','),
			suggestions,
			uncategorizedCount: uncategorized.length,
			openTick,
			closeTick
		};
	});
}

export interface CarveWindow {
	/** Whole-note units on the playback timeline, half-open [start, end). */
	start: Fraction;
	end: Fraction;
}

/**
 * Null out the pitches of melody notes whose sounding span intersects any
 * window, so the instrument never plays over an open mic window. Strictly
 * index-preserving — rests are skipped at event-build time, so provenance
 * and `sourceIndex` values stay valid.
 */
export function carveMelody(notes: readonly Note[], windows: readonly CarveWindow[]): Note[] {
	const spans = windows.map((w) => ({
		start: fractionToFloat(w.start),
		end: fractionToFloat(w.end)
	}));
	return notes.map((note) => {
		if (note.pitch === null) return { ...note };
		const noteStart = fractionToFloat(note.offset);
		const noteEnd = noteStart + fractionToFloat(note.duration);
		const inWindow = spans.some(
			(s) => noteStart < s.end - EPSILON && s.start < noteEnd - EPSILON
		);
		return inWindow ? { ...note, pitch: null } : { ...note };
	});
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
