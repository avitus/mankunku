import { PITCH_CLASSES, type Fraction, type HarmonicSegment, type PitchClass } from '$lib/types/music';
import type { Tune } from '$lib/types/tune';
import { addFractions, compareFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import { chordEvidence } from '$lib/music/chord-evidence';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import { DOMINANT_QUALITIES, MINOR_TONIC_QUALITIES } from '$lib/data/progression-shapes';
import { detectProgressions, type DetectedProgression } from './progression-detector';
import type { FlattenedTune } from './flatten';

interface HarmonicSpan {
	/** Indices into the supplied flatten, never notation indices guessed from bars. */
	segmentIndices: number[];
	startOffset: Fraction;
	duration: Fraction;
}

export type Cornerstone = HarmonicSpan & (
	{ kind: 'progression'; detection: DetectedProgression } |
	{ kind: 'minor-arrival'; localKey: PitchClass; wrapsAround: boolean }
);

export interface MajorRegion extends HarmonicSpan {
	/** Concert tonic of a compatible major collection, not a claim of unique tonality. */
	key: PitchClass;
	mode: 'major';
	evidence: {
		tonicSegmentIndices: number[];
		/** Each pair is [dominant segment, arriving tonic segment]. */
		cadences: [number, number][];
		matchesTuneKey: boolean;
	};
}

export interface HarmonicAnalysis {
	/** Existing detections remain available unchanged, including stationary vamps. */
	progressions: DetectedProgression[];
	/** Overlaps retained: reservations are independent of choosing a practice lick. */
	cornerstones: Cornerstone[];
	reservedSegmentIndices: number[];
	/** Scale-compatible readings, including chords also belonging to cornerstones. */
	compatibleMajorRegions: MajorRegion[];
	/** Practice candidates after cornerstone reservation; competing keys can overlap. */
	majorRegions: MajorRegion[];
	issues: ('invalid-timeline')[];
}

interface Run extends HarmonicSpan {
	chord: HarmonicSegment['chord'];
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

function endOf(span: Pick<HarmonicSpan, 'startOffset' | 'duration'>): Fraction {
	return addFractions(span.startOffset, span.duration);
}

/** Coalesce adjacent equal-quality roots for cadence identity, as the shape detector does. */
function chordRuns(harmony: HarmonicSegment[], order: number[]): Run[] {
	const runs: Run[] = [];
	for (const index of order) {
		const segment = harmony[index];
		const previous = runs.at(-1);
		if (previous && previous.chord.root === segment.chord.root &&
			previous.chord.quality === segment.chord.quality &&
			compareFractions(endOf(previous), segment.startOffset) === 0) {
			previous.duration = addFractions(previous.duration, segment.duration);
			previous.segmentIndices.push(index);
		} else {
			runs.push({ chord: segment.chord, segmentIndices: [index],
				startOffset: segment.startOffset, duration: segment.duration });
		}
	}
	return runs;
}

/**
 * Reserve m7–V7–minor arrivals without relabeling m7 as m7b5 or granting any
 * template lick eligibility. Harmonic rhythm is deliberately unrestricted here.
 */
function minorArrivals(runs: Run[], formEnd: Fraction, cyclic: boolean): Cornerstone[] {
	if (runs.length < 3) return [];
	const canWrap = cyclic && compareFractions(runs[0].startOffset, [0, 1]) === 0 &&
		compareFractions(endOf(runs[runs.length - 1]), formEnd) === 0;
	const scan = canWrap ? [...runs, ...runs.slice(0, 2).map((run) => ({
		...run, startOffset: addFractions(run.startOffset, formEnd)
	}))] : runs;
	const found: Cornerstone[] = [];
	for (let i = 0; i < runs.length && i + 2 < scan.length; i++) {
		const [ii, dominant, tonic] = scan.slice(i, i + 3);
		if (ii.chord.quality !== 'min7' || !DOMINANT_QUALITIES.includes(dominant.chord.quality) ||
			!MINOR_TONIC_QUALITIES.includes(tonic.chord.quality) ||
			pitchClassInterval(tonic.chord.root, ii.chord.root) !== 2 ||
			pitchClassInterval(tonic.chord.root, dominant.chord.root) !== 7 ||
			compareFractions(endOf(ii), dominant.startOffset) !== 0 ||
			compareFractions(endOf(dominant), tonic.startOffset) !== 0) continue;
		found.push({
			kind: 'minor-arrival', localKey: tonic.chord.root, wrapsAround: i + 2 >= runs.length,
			segmentIndices: [ii, dominant, tonic].flatMap((run) => run.segmentIndices),
			startOffset: ii.startOffset, duration: subtractFractions(endOf(tonic), ii.startOffset)
		});
	}
	return found;
}

/** Reject impossible timelines before detector arithmetic; gaps remain valid boundaries. */
function validTimeline(harmony: HarmonicSegment[], order: number[], formEnd: Fraction): boolean {
	const validFraction = (f: Fraction): boolean => Number.isSafeInteger(f[0]) &&
		Number.isSafeInteger(f[1]) && f[1] > 0;
	let previousEnd: Fraction = [0, 1];
	for (const index of order) {
		const segment = harmony[index];
		if (!validFraction(segment.startOffset) || !validFraction(segment.duration) ||
			segment.duration[0] <= 0 || compareFractions(segment.startOffset, previousEnd) < 0 ||
			compareFractions(endOf(segment), formEnd) > 0) return false;
		previousEnd = endOf(segment);
	}
	return true;
}

/**
 * Retain overlapping cornerstone and major-collection readings, then derive
 * practice regions with cornerstone ownership of shared chords. Pure and book-independent; shared by the session's
 * preview and live planner. See documentation/architecture/harmonic-analysis.md.
 */
export function analyzeHarmony(
	flat: FlattenedTune,
	tune: Pick<Tune, 'key' | 'timeSignature'>,
	options: { cyclic?: boolean; reservationScope?: 'cyclic' | 'form' } = {}
): HarmonicAnalysis {
	const empty: HarmonicAnalysis = {
		progressions: [], cornerstones: [], reservedSegmentIndices: [], compatibleMajorRegions: [], majorRegions: [], issues: []
	};
	const [beats, unit] = tune.timeSignature;
	if (!Number.isSafeInteger(beats) || beats <= 0 || !Number.isSafeInteger(unit) || unit <= 0 ||
		!Number.isSafeInteger(flat.totalBars) || flat.totalBars < 0) {
		return { ...empty, issues: ['invalid-timeline'] };
	}
	const formEnd: Fraction = [beats * flat.totalBars, unit];
	const order = flat.harmony.map((_, index) => index).sort((a, b) =>
		compareFractions(flat.harmony[a].startOffset, flat.harmony[b].startOffset) || a - b);
	if (!validTimeline(flat.harmony, order, formEnd)) return { ...empty, issues: ['invalid-timeline'] };
	const cyclic = options.cyclic ?? true;
	const progressions = detectProgressions(flat, tune, { cyclic });
	const cornerstones: Cornerstone[] = progressions
		.filter((detection) => detection.slots.length > 1 || detection.type === 'blues')
		.map((detection) => ({ kind: 'progression', detection,
			segmentIndices: detection.segmentIndices, startOffset: detection.startOffset, duration: detection.duration }));
	cornerstones.push(...minorArrivals(chordRuns(flat.harmony, order), formEnd, cyclic));
	cornerstones.sort((a, b) => compareFractions(a.startOffset, b.startOffset) ||
		compareFractions(b.duration, a.duration) || a.kind.localeCompare(b.kind));
	// Session capture stops at the form edge. A wrapped resolution refers to
	// the NEXT occurrence, not the opening occurrence on this timeline.
	const reserved = new Set(cornerstones.flatMap((cornerstone) =>
		options.reservationScope === 'form' ? cornerstone.segmentIndices.filter(index =>
			compareFractions(flat.harmony[index].startOffset, cornerstone.startOffset) >= 0) : cornerstone.segmentIndices));
	const evidence = flat.harmony.map(chordEvidence);
	const sectionBoundaries = flat.sectionMap.map((entry) => entry.barOffset * beats / unit);
	const scanRegions = (blocked: ReadonlySet<number>): MajorRegion[] => {
		const majorRegions: MajorRegion[] = [];
		for (const key of PITCH_CLASSES) {
			const scale = new Set(MAJOR_INTERVALS.map((interval) => transposePitchClass(key, interval)));
			let run: number[] = [];
			const flush = (): void => {
				if (run.length === 0) return;
				const startOffset = flat.harmony[run[0]].startOffset;
				const duration = subtractFractions(endOf(flat.harmony[run[run.length - 1]]), startOffset);
				const tonicSegmentIndices = run.filter((index) => evidence[index]?.root === key && evidence[index]?.majorTonic);
				if (tonicSegmentIndices.length && fractionToFloat(duration) >= beats / unit &&
					new Set(run.map((index) => evidence[index]!.root)).size >= 2) {
					const cadences: [number, number][] = [];
					for (let i = 1; i < run.length; i++) {
						const previous = run[i - 1];
						if (tonicSegmentIndices.includes(run[i]) &&
							pitchClassInterval(key, evidence[previous]!.root) === 7 &&
							evidence[previous]!.pitchClasses.includes(transposePitchClass(key, 11)) &&
							evidence[previous]!.pitchClasses.includes(transposePitchClass(key, 5))) {
							cadences.push([previous, run[i]]);
						}
					}
					majorRegions.push({ key, mode: 'major', segmentIndices: run, startOffset, duration,
						evidence: { tonicSegmentIndices, cadences, matchesTuneKey: key === tune.key } });
				}
				run = [];
			};
			for (const index of order) {
				const segment = flat.harmony[index];
				const tones = evidence[index];
				const previous = run.at(-1);
				if (previous !== undefined) {
					const start = fractionToFloat(segment.startOffset);
					const previousStart = fractionToFloat(flat.harmony[previous].startOffset);
					if (compareFractions(endOf(flat.harmony[previous]), segment.startOffset) !== 0 ||
						sectionBoundaries.some((boundary) => boundary > previousStart && boundary <= start)) flush();
				}
				if (blocked.has(index) || !tones || !tones.pitchClasses.every((pitch) => scale.has(pitch))) flush();
				else run.push(index);
			}
			flush();
		}
		majorRegions.sort((a, b) => compareFractions(a.startOffset, b.startOffset) ||
			compareFractions(b.duration, a.duration) || PITCH_CLASSES.indexOf(a.key) - PITCH_CLASSES.indexOf(b.key));
		return majorRegions;
	};
	const compatibleMajorRegions = scanRegions(new Set());
	const majorRegions = scanRegions(reserved);
	return { progressions, cornerstones, reservedSegmentIndices: order.filter((index) => reserved.has(index)),
		compatibleMajorRegions, majorRegions, issues: [] };
}
