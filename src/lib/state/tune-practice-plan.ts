import type { Fraction, HarmonicSegment, Mode, Note, PhraseCategory, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Grade, Score } from '$lib/types/scoring';
import type { FlattenedTune } from '$lib/tunes/flatten';
import type { TuneSection } from '$lib/types/tune';
import { SHAPE_PRIORITY, type DetectedProgression } from '$lib/tunes/progression-detector';
import type { LickSuggestion } from '$lib/tunes/lick-matcher';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	multiplyFraction,
	subtractFractions
} from '$lib/music/intervals';
import { PROGRESSION_TEMPLATES, isChordQualityCategory } from '$lib/data/progressions';
import { keyLabel } from '$lib/music/notation';
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
	/**
	 * What the window is FOR — the band's colour, name and rotation pool. A
	 * cadence window carries its progression; a single-chord role carved out
	 * of a longer progression carries the chord's own vamp type (a Minor Chord
	 * lick on the i of a ii-V-i is a `minor-vamp` window on those bars).
	 */
	progressionType: ChordProgressionType;
	/**
	 * What the band says the window is for: the band type's short name, or
	 * the chord's for a single-chord role with no vamp type of its own
	 * ("Diminished").
	 */
	bandName: string;
	/** The detected progression the window was carved from. */
	detectedType: ChordProgressionType;
	localKey: PitchClass;
	/**
	 * The concert key the window is named in: the top suggestion's target
	 * (the chord root for a single-chord role), else the progression's local
	 * key for a bare window.
	 */
	keyCenter: PitchClass;
	/** Tune-key degree label of the local key, e.g. '4' = "the IV key". */
	degreeLabel: string;
	/** Playback-timeline span of the WINDOW (whole-note units). */
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
	/**
	 * Every progression the detector finds, overlaps included — the planner
	 * resolves them once it knows which have a lick (an already-selected set
	 * plans identically).
	 */
	detect: (flat: FlattenedTune) => DetectedProgression[];
	match: (detection: DetectedProgression) => {
		suggestions: LickSuggestion[];
		uncategorized: unknown[];
	};
	/** Cap on suggestions per window, applied after the window is chosen. Absent = unlimited. */
	suggestionLimit?: number;
}

const EPSILON = 1e-9;

/**
 * A single-chord role is drawn as the chord's own vamp band. No diminished
 * vamp exists, so that role keeps its parent's type (and colour) and only
 * takes its own name — a 1-bar "Long ii-V-I (Min)" on the iiø7 alone would
 * misname the window.
 */
const CHORD_ROLE_BAND: Partial<
	Record<PhraseCategory, { type?: ChordProgressionType; name: string }>
> = {
	'minor-chord': { type: 'minor-vamp', name: PROGRESSION_TEMPLATES['minor-vamp'].shortName },
	'major-chord': { type: 'major-vamp', name: PROGRESSION_TEMPLATES['major-vamp'].shortName },
	'dominant-chord': {
		type: 'dominant-vamp',
		name: PROGRESSION_TEMPLATES['dominant-vamp'].shortName
	},
	'diminished-chord': { name: 'Diminished' }
};

/** A window the planner may keep: a lick-bearing role, or a bare progression. */
interface CandidateWindow {
	det: DetectedProgression;
	bandType: ChordProgressionType;
	bandName: string;
	start: Fraction;
	end: Fraction;
	/** Playback harmony indices the window covers (overlap is decided on these). */
	segmentIndices: number[];
	suggestions: LickSuggestion[];
	uncategorizedCount: number;
}

function spanBars(w: CandidateWindow): number {
	return fractionToFloat(w.end) - fractionToFloat(w.start);
}

/**
 * A window the player can actually fill: it holds a lick they HAVE in the
 * window's key — passed there, or unlocked there on Side B (`masteryTier`
 * known or learning). Points mode admits the whole catalog, so a long
 * cadence always holds *some* lick; without this a known 2-bar minor lick
 * lost its window to cadence material the player had never touched.
 */
function hasReadyLick(w: CandidateWindow): boolean {
	return w.suggestions.some((s) => s.masteryTier !== 'unknown');
}

/**
 * The windows a detection's suggestions carve out of it, one per ROLE — the
 * alignment offset the licks share, split by kind. A single-chord lick's
 * window is the chord it aligns to (the slot's coalesced run), offered only
 * to licks no longer than that chord and drawn as the chord's own vamp band.
 * A phrase-shaped lick's window runs from its aligned bar to the end of the
 * progression, stretched to hold the group's longest lick (an unresolved
 * ii-V's resolution bar) and taking the harmony segments that fall inside
 * the stretch, so the band and the scorer cover what the player is asked for.
 */
function roleWindowsFor(
	det: DetectedProgression,
	suggestions: readonly LickSuggestion[],
	uncategorizedCount: number,
	flat: FlattenedTune,
	timeSignature: [number, number]
): CandidateWindow[] {
	const groups = new Map<string, { kind: 'chord' | 'phrase'; suggestions: LickSuggestion[] }>();
	for (const s of suggestions) {
		const kind = isChordQualityCategory(s.category) ? 'chord' : 'phrase';
		const key = `${fractionToFloat(s.templateAlignmentOffset)}|${kind}`;
		const group = groups.get(key) ?? { kind, suggestions: [] };
		group.suggestions.push(s);
		groups.set(key, group);
	}
	const detEnd = addFractions(det.startOffset, det.duration);
	const barWholeNotes = timeSignature[0] / timeSignature[1];
	const windows: CandidateWindow[] = [];
	for (const group of groups.values()) {
		const alignment = group.suggestions[0].templateAlignmentOffset;
		const slot = det.slots.find((sl) => compareFractions(sl.templateOffset, alignment) === 0) ?? null;
		if (group.kind === 'chord') {
			if (!slot) continue;
			const last = flat.harmony[slot.segmentIndices[slot.segmentIndices.length - 1]];
			const runEnd = addFractions(last.startOffset, last.duration);
			const runBars = (fractionToFloat(runEnd) - fractionToFloat(slot.startOffset)) / barWholeNotes;
			const fitting = group.suggestions.filter((s) => s.lengthBars <= runBars + EPSILON);
			if (fitting.length === 0) continue;
			const band = CHORD_ROLE_BAND[fitting[0].category];
			windows.push({
				det,
				bandType: band?.type ?? det.type,
				bandName: band?.name ?? PROGRESSION_TEMPLATES[det.type].shortName,
				start: slot.startOffset,
				end: runEnd,
				segmentIndices: [...slot.segmentIndices],
				suggestions: fitting,
				uncategorizedCount
			});
			continue;
		}
		const start = slot ? slot.startOffset : det.startOffset;
		const longest = Math.max(...group.suggestions.map((s) => s.lengthBars));
		const lickEnd = addFractions(start, [longest * timeSignature[0], timeSignature[1]]);
		const end = compareFractions(lickEnd, detEnd) > 0 ? lickEnd : detEnd;
		let segmentIndices = det.segmentIndices;
		if (slot) {
			const at = det.segmentIndices.indexOf(slot.segmentIndices[0]);
			if (at > 0) segmentIndices = det.segmentIndices.slice(at);
		}
		if (compareFractions(end, detEnd) > 0) {
			const extension: number[] = [];
			flat.harmony.forEach((h, idx) => {
				if (
					compareFractions(h.startOffset, detEnd) >= 0 &&
					compareFractions(h.startOffset, end) < 0 &&
					!segmentIndices.includes(idx)
				) {
					extension.push(idx);
				}
			});
			segmentIndices = [...segmentIndices, ...extension];
		}
		windows.push({
			det,
			bandType: det.type,
			bandName: PROGRESSION_TEMPLATES[det.type].shortName,
			start,
			end,
			segmentIndices,
			suggestions: group.suggestions,
			uncategorizedCount
		});
	}
	return windows;
}

/**
 * Turn detected progressions into scheduled insertion points.
 *
 * Selection is lick-aware (2026-09-17): the longest window with a lick the
 * player has ready wins an overlap, and the bars it leaves are filled by
 * shorter ones — so a long ii-V-i with no cadence lick ready hands its i
 * chord to a single-chord lick as that chord's own window, instead of naming
 * that lick across the whole cadence. Windows with a lick are placed first:
 * one holding a lick the player HAS in the key (`hasReadyLick`) before one
 * holding only unknown material, then longest first (shape specificity, then
 * chart position, break ties); the bare progressions are placed after them by
 * the same rule, so an untouched stretch still shows its harmony (the band
 * names the progression) but never over a filled window. Overlap is decided on harmony segments, as
 * `selectNonOverlapping` decides it, so an already-selected set plans
 * identically and wrapped detections stay safe.
 *
 * Tick math matches playback.ts exactly: one bar of count-in (`barTicks`
 * offset, the hard-coded playPhrase lead-in) and `wholeNotes * 4 * ppq` per
 * offset. No lead-in — the scorer's DTW + median-latency correction absorb
 * early entries; a 1-beat lead-out captures the resolution's tail, clamped so
 * a window never overlaps the next open or runs past the end of the form.
 */
export function buildSessionPlan(deps: BuildPlanDeps): InsertionPoint[] {
	const { flat, notationFlat, timeSignature, ppq, detect, match, suggestionLimit } = deps;
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

	const filled: CandidateWindow[] = [];
	const bare: CandidateWindow[] = [];
	for (const det of detections) {
		const { suggestions, uncategorized } = match(det);
		filled.push(...roleWindowsFor(det, suggestions, uncategorized.length, flat, timeSignature));
		bare.push({
			det,
			bandType: det.type,
			bandName: PROGRESSION_TEMPLATES[det.type].shortName,
			start: det.startOffset,
			end: addFractions(det.startOffset, det.duration),
			segmentIndices: det.segmentIndices,
			suggestions: [],
			uncategorizedCount: uncategorized.length
		});
	}

	const rank = (a: CandidateWindow, b: CandidateWindow): number =>
		Number(hasReadyLick(b)) - Number(hasReadyLick(a)) ||
		spanBars(b) - spanBars(a) ||
		SHAPE_PRIORITY[a.det.type] - SHAPE_PRIORITY[b.det.type] ||
		compareFractions(a.start, b.start) ||
		a.det.type.localeCompare(b.det.type) ||
		a.bandType.localeCompare(b.bandType);
	const used = new Set<number>();
	const kept: CandidateWindow[] = [];
	const place = (candidates: CandidateWindow[]): void => {
		for (const w of [...candidates].sort(rank)) {
			if (w.segmentIndices.some((i) => used.has(i))) continue;
			for (const i of w.segmentIndices) used.add(i);
			kept.push(w);
		}
	};
	place(filled);
	place(bare);
	kept.sort(
		(a, b) =>
			compareFractions(a.start, b.start) ||
			SHAPE_PRIORITY[a.det.type] - SHAPE_PRIORITY[b.det.type] ||
			a.det.type.localeCompare(b.det.type)
	);

	return kept.map((w, i) => {
		const det = w.det;
		const openTick = leadTicks + ticksOf(w.start);
		let closeTick = leadTicks + ticksOf(w.end) + ppq;
		const next = kept[i + 1];
		if (next) closeTick = Math.min(closeTick, leadTicks + ticksOf(next.start));
		closeTick = Math.min(closeTick, formEndTick);

		const notationSegmentIndices = w.segmentIndices
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
		const startFloat = fractionToFloat(w.start);
		const endFloat = fractionToFloat(w.end);
		const notationBarRange = Number.isFinite(notationStart)
			? {
					start: Math.floor(notationStart / barWholeNotes + EPSILON),
					endExclusive: Math.ceil(notationEnd / barWholeNotes - EPSILON)
				}
			: {
					start: Math.floor(startFloat / barWholeNotes + EPSILON),
					endExclusive: Math.ceil(endFloat / barWholeNotes - EPSILON)
				};
		const notationTimeRange = Number.isFinite(notationStart)
			? { start: notationStart, end: notationEnd }
			: { start: startFloat, end: endFloat };

		const suggestions =
			suggestionLimit !== undefined ? w.suggestions.slice(0, suggestionLimit) : w.suggestions;

		return {
			id: `ip-${i}`,
			progressionType: w.bandType,
			bandName: w.bandName,
			detectedType: det.type,
			localKey: det.localKey,
			keyCenter: suggestions[0]?.targetKey ?? det.localKey,
			degreeLabel: det.tuneKeyDegree.label,
			startOffset: w.start,
			duration: subtractFractions(w.end, w.start),
			playbackBarRange: {
				start: Math.floor(startFloat / barWholeNotes + EPSILON),
				endExclusive: Math.ceil(endFloat / barWholeNotes - EPSILON)
			},
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
			uncategorizedCount: w.uncategorizedCount,
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
 * end with only a SHORT new tail (a second ending / coda) after it — shorter
 * than the pass it follows. An INTERNAL repeat is anything else: either NEW
 * form material interleaved with the replayed body (`|: A :| B A` in an AABA
 * chart — a new section followed by a replayed one), or a tail at least as
 * long as the pass (`|: A [1 :| [2 | B` — Autumn Leaves, where a 16-bar B
 * follows an 8-bar repeat; the closing A of an AABA chart authored as its own
 * section is the same shape, since it never reads as a replay). Both are
 * ordinary play-twice repeats, not form outlines; those charts head through
 * the whole form and get an appended solo chorus instead.
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
	let firstNewIdx = -1;
	for (let i = revisitIdx; i < sm.length; i++) {
		if (seen.has(sm[i].sourceSection)) {
			if (firstNewIdx !== -1) return noRepeat;
		} else if (firstNewIdx === -1) {
			firstNewIdx = i;
		}
	}

	// The new sections are now a contiguous tail. A second ending or a coda is
	// shorter than the pass it follows; a tail at least as long as pass one is
	// the rest of the form, and the repeat only enclosed a section of it.
	const headBars = sm[revisitIdx].barOffset;
	const tailBars = firstNewIdx === -1 ? 0 : flat.totalBars - sm[firstNewIdx].barOffset;
	if (tailBars >= headBars) return noRepeat;
	return { headBars, formRepeats: true };
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

/**
 * Whether the chart carries its insertion bands, lick names and the pick card
 * yet. While a head plays, the sheet is the melody and nothing prompts for a
 * lick — the count-in before it included (Andy, 2026-09-17); everything
 * appears with the solo chorus. Without a head there is nothing to hear
 * first, so the annotations show from the count-in as before.
 */
export function annotationsVisible(args: { phase: TunePracticePhase; playHead: boolean }): boolean {
	if (!args.playHead) return true;
	return args.phase !== 'count-in' && args.phase !== 'head';
}

/**
 * The text a lick window carries: the lick and the key it is played in, in
 * the player's written pitch — a single-chord lick may sit on a chord two
 * bars from where its progression began, so the name alone left the key to
 * guesswork.
 */
export function windowLabel(lickName: string, writtenKey: PitchClass, mode: Mode): string {
	return `${lickName} · ${keyLabel(writtenKey, mode)}`;
}

/** What the chart names over an insertion band. */
export type CueLevel = 'lick' | 'progression' | 'none';

export interface StrictnessKnobs {
	octaveInsensitive: boolean;
	bleedFilterEnabled: boolean;
	/**
	 * What the bands name: the lick (and, in points mode, the pick card), the
	 * progression alone, or nothing.
	 */
	cueLevel: CueLevel;
}

/**
 * Strictness is about how much the chart TELLS the player, never about how
 * the app listens. Every level scores any octave — nothing is demonstrated in
 * tune practice, so there is no heard register to match, and a lick
 * legitimately moves an octave to stay on the horn — and every level scores
 * the bleed-filtered notes (forgiving on speakers, inert on headphones). The
 * grading scale never changes. Guided names the lick over each band; Standard
 * names only the progression, so the vocabulary is the player's choice and
 * every fitting lick is a valid answer (`windowCandidates`); Solo names
 * nothing.
 */
export function strictnessKnobs(strictness: TunePracticeStrictness): StrictnessKnobs {
	const listening = { octaveInsensitive: true, bleedFilterEnabled: true };
	switch (strictness) {
		case 'guided':
			return { ...listening, cueLevel: 'lick' };
		case 'standard':
			return { ...listening, cueLevel: 'progression' };
		case 'solo':
			return { ...listening, cueLevel: 'none' };
	}
}

/**
 * The suggestions a window is scored against. When the chart names the lick,
 * that lick (the user's pick, else the top rank) is the one answer. When it
 * names only the progression, or nothing, the player was never told which
 * lick to play, so every fitting suggestion is a candidate — the take is
 * scored against each and `bestCandidateResult` keeps the best.
 */
export function windowCandidates(
	suggestions: readonly LickSuggestion[],
	pickedIndex: number | undefined,
	cueLevel: CueLevel
): LickSuggestion[] {
	if (cueLevel === 'lick') {
		const picked = resolvePickedSuggestion(suggestions, pickedIndex);
		return picked ? [picked] : [];
	}
	return [...suggestions];
}

/**
 * The text drawn over an insertion band, if any: the lick at the lick cue
 * level (the progression when no lick fits, so the player still knows what
 * to blow over), the progression alone at the progression level, nothing at
 * none — and nothing in freestyle, whatever the level.
 */
export function insertionLabel(args: {
	mode: TunePracticeMode;
	cueLevel: CueLevel;
	lickName: string | null;
	progressionName: string;
}): string | undefined {
	if (args.mode === 'freestyle' || args.cueLevel === 'none') return undefined;
	if (args.cueLevel === 'lick') return args.lickName ?? args.progressionName;
	return args.progressionName;
}

export interface CandidateResult {
	lickName: string;
	score: Score | null;
}

/**
 * The candidate the take matched best. An unscorable candidate (its lick could
 * not be resolved) ranks below any scored one; when none scored, the first
 * stands, unscored, so the window still records which lick it was for.
 */
export function bestCandidateResult(results: readonly CandidateResult[]): CandidateResult {
	if (results.length === 0) throw new Error('bestCandidateResult: no candidates');
	let best = results[0];
	for (const r of results.slice(1)) {
		if (r.score && (!best.score || r.score.overall > best.score.overall)) best = r;
	}
	return best;
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
