import type { Fraction, HarmonicSegment, PitchClass } from '$lib/types/music';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { Tune } from '$lib/types/tune';
import type { FlattenedTune } from './flatten';
import { addFractions, compareFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import { scaleDegreeOf, type ScaleDegree } from '$lib/music/scale-degree';
import { PROGRESSION_SHAPES, type ProgressionShape, type ShapeSlot } from '$lib/data/progression-shapes';

/**
 * Runtime detection of known chord-progression shapes (`PROGRESSION_SHAPES`)
 * inside a flattened tune's harmony. Timeline-agnostic: pass the notation-order
 * flatten for chart annotations or the `expandRepeats` flatten for playback
 * scheduling — segment indices in the results refer to whichever `harmony`
 * array was scanned.
 */

export interface DetectedSlot {
	/** Template-space `startOffset` of the mirrored `PROGRESSION_TEMPLATES` chord. */
	templateOffset: Fraction;
	/** Indices into the scanned harmony array; length > 1 when a run coalesced. */
	segmentIndices: number[];
	/** Absolute tune offset of the slot's first segment, whole-note units. */
	startOffset: Fraction;
}

export interface DetectedProgression {
	type: ChordProgressionType;
	/** One entry per shape slot, in slot order. */
	slots: DetectedSlot[];
	/** Flat concatenation of the slots' segment indices. */
	segmentIndices: number[];
	/** Concert local tonic the shape bound to (e.g. Bb inside an F tune). */
	localKey: PitchClass;
	/** `localKey` labeled against the tune's global key (label '4' = "the IV key"). */
	tuneKeyDegree: ScaleDegree;
	/** Absolute start, whole-note units. */
	startOffset: Fraction;
	/** Total span in whole-note units; loop-extended when `wrapsAround`. */
	duration: Fraction;
	/** 0-based bar of the first segment. */
	startBar: number;
	/** Exclusive end bar; exceeds the form's `totalBars` when `wrapsAround` (mod to display). */
	endBarExclusive: number;
	/** True when trailing slot(s) matched by wrapping to the top of the form. */
	wrapsAround: boolean;
}

export interface DetectOptions {
	/** Treat the form as looping so trailing slots may resolve at offset 0. Default true. */
	cyclic?: boolean;
	/** Restrict detection to a subset of shapes. Default: all. */
	types?: readonly ChordProgressionType[];
}

const EPSILON = 1e-9;
const ZERO: Fraction = [0, 1];

/** Selection priority: most specific shapes first. Shared with `selectNonOverlapping`. */
const SHAPE_PRIORITY: Record<ChordProgressionType, number> = {
	turnaround: 0,
	'ii-V-I-major-long': 1,
	'ii-V-I-minor-long': 1,
	'ii-V-I-major': 2,
	'ii-V-I-minor': 2,
	blues: 3,
	'major-vamp': 4,
	'minor-vamp': 4,
	'dominant-vamp': 4
};

function segEnd(seg: HarmonicSegment): Fraction {
	return addFractions(seg.startOffset, seg.duration);
}

function sameChord(a: HarmonicSegment, b: HarmonicSegment): boolean {
	return a.chord.root === b.chord.root && a.chord.quality === b.chord.quality;
}

export function detectProgressions(
	flat: FlattenedTune,
	tune: Pick<Tune, 'key' | 'timeSignature'>,
	options: DetectOptions = {}
): DetectedProgression[] {
	const { cyclic = true, types } = options;
	const harmony = flat.harmony;
	if (harmony.length === 0) return [];

	const barFloat = tune.timeSignature[0] / tune.timeSignature[1];
	const formEnd: Fraction = [tune.timeSignature[0] * flat.totalBars, tune.timeSignature[1]];

	// Scan a stably-sorted view so out-of-order imported harmony still scans
	// correctly; emitted indices always refer to the original array.
	const order = harmony
		.map((_, i) => i)
		.sort((a, b) => compareFractions(harmony[a].startOffset, harmony[b].startOffset) || a - b);

	const contiguous = (prev: HarmonicSegment, next: HarmonicSegment): boolean =>
		compareFractions(segEnd(prev), next.startOffset) === 0;

	/** A run head is a segment that does not continue an identical contiguous chord. */
	const isRunHead = (pos: number): boolean => {
		if (pos === 0) return true;
		const prev = harmony[order[pos - 1]];
		const here = harmony[order[pos]];
		return !(sameChord(prev, here) && contiguous(prev, here));
	};

	const matchShapeAt = (shape: ProgressionShape, start: number): DetectedProgression | null => {
		let pos = start;
		let wrapped = false;
		let localTonic: PitchClass | null = null;
		let prevEnd: Fraction | null = null;
		const slotRecords: DetectedSlot[] = [];

		for (const slot of shape.slots) {
			// Position the cursor at this slot's first segment: exactly contiguous
			// with the previous slot, or — once, when cyclic — wrapped to the top
			// of the form after consuming the final segment.
			if (prevEnd !== null) {
				const atCursor = pos < order.length ? harmony[order[pos]] : null;
				if (atCursor === null || compareFractions(atCursor.startOffset, prevEnd) !== 0) {
					const canWrap =
						cyclic &&
						!wrapped &&
						pos >= order.length &&
						compareFractions(prevEnd, formEnd) === 0 &&
						compareFractions(harmony[order[0]].startOffset, ZERO) === 0;
					if (!canWrap) return null;
					pos = 0;
					wrapped = true;
				}
			}
			if (wrapped && pos >= start) return null;
			const first = harmony[order[pos]];

			if (localTonic === null) {
				localTonic = transposePitchClass(first.chord.root, -slot.rootOffset);
				if (shape.requireTonicIsTuneKey && localTonic !== tune.key) return null;
			} else if (pitchClassInterval(localTonic, first.chord.root) !== slot.rootOffset) {
				return null;
			}
			if (!slot.qualities.includes(first.chord.quality)) return null;

			// Consume the maximal same-chord contiguous run. Coalescing never
			// crosses the wrap boundary — only advancing to a new slot may wrap.
			const segmentIndices = [order[pos]];
			let runEnd = segEnd(first);
			let next = pos + 1;
			while (
				next < order.length &&
				(!wrapped || next < start) &&
				sameChord(harmony[order[next]], first) &&
				compareFractions(harmony[order[next]].startOffset, runEnd) === 0
			) {
				segmentIndices.push(order[next]);
				runEnd = segEnd(harmony[order[next]]);
				next++;
			}

			const runBars =
				(fractionToFloat(runEnd) - fractionToFloat(first.startOffset)) / barFloat;
			if (slot.minBars !== undefined && runBars < slot.minBars - EPSILON) return null;
			if (slot.maxBars !== undefined && runBars > slot.maxBars + EPSILON) return null;

			slotRecords.push({
				templateOffset: slot.templateOffset,
				segmentIndices,
				startOffset: first.startOffset
			});
			prevEnd = runEnd;
			pos = next;
		}

		const startOffset = slotRecords[0].startOffset;
		const end = wrapped ? addFractions(formEnd, prevEnd!) : prevEnd!;
		const duration = subtractFractions(end, startOffset);
		return {
			type: shape.type,
			slots: slotRecords,
			segmentIndices: slotRecords.flatMap((s) => s.segmentIndices),
			localKey: localTonic!,
			tuneKeyDegree: scaleDegreeOf(localTonic!, tune.key),
			startOffset,
			duration,
			startBar: Math.floor(fractionToFloat(startOffset) / barFloat + EPSILON),
			endBarExclusive: Math.ceil(fractionToFloat(end) / barFloat - EPSILON),
			wrapsAround: wrapped
		};
	};

	const shapes = types
		? PROGRESSION_SHAPES.filter((s) => types.includes(s.type))
		: PROGRESSION_SHAPES;

	const results: DetectedProgression[] = [];
	for (const shape of shapes) {
		for (let start = 0; start < order.length; start++) {
			if (!isRunHead(start)) continue;
			const det = matchShapeAt(shape, start);
			if (det) results.push(det);
		}
	}

	return results.sort(
		(a, b) =>
			compareFractions(a.startOffset, b.startOffset) ||
			SHAPE_PRIORITY[a.type] - SHAPE_PRIORITY[b.type] ||
			a.type.localeCompare(b.type)
	);
}

/**
 * Greedy non-overlapping selection for session planning: most specific shape
 * first (turnaround > long ii-V-I > short ii-V-I > blues > vamps), longer
 * spans first within a tier, kept only when its segment set is disjoint from
 * everything already kept (segment-set disjointness stays correct for wrapped
 * windows). Result is re-sorted into chart order. Deterministic regardless of
 * input order.
 */
export function selectNonOverlapping(
	detections: readonly DetectedProgression[]
): DetectedProgression[] {
	const ranked = [...detections].sort(
		(a, b) =>
			SHAPE_PRIORITY[a.type] - SHAPE_PRIORITY[b.type] ||
			fractionToFloat(b.duration) - fractionToFloat(a.duration) ||
			compareFractions(a.startOffset, b.startOffset) ||
			a.type.localeCompare(b.type)
	);
	const used = new Set<number>();
	const kept: DetectedProgression[] = [];
	for (const det of ranked) {
		if (det.segmentIndices.some((i) => used.has(i))) continue;
		for (const i of det.segmentIndices) used.add(i);
		kept.push(det);
	}
	return kept.sort(
		(a, b) =>
			compareFractions(a.startOffset, b.startOffset) ||
			SHAPE_PRIORITY[a.type] - SHAPE_PRIORITY[b.type] ||
			a.type.localeCompare(b.type)
	);
}
