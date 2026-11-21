import type { Fraction, PitchClass } from '$lib/types/music';
import type { ChordEvidence } from '$lib/music/chord-evidence';
import { addFractions, compareFractions, fractionToFloat } from '$lib/music/intervals';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import type { FlattenedTune } from './flatten';
import { augmentedDominantTarget } from './tonal-centers';
import type { MajorRegion } from './harmonic-analysis';

export interface MajorContinuation {
	key: PitchClass;
	/** Only the passage between the two cadenced collections. */
	segmentIndices: number[];
	exceptions: { index: number; role: 'borrowed iv' | 'passing diminished seventh' | 'applied augmented dominant' }[];
}

export interface MajorTurnaround {
	key: PitchClass;
	/** The iiø–V/vi itself; scale-based lick eligibility is still chord-specific. */
	segmentIndices: number[];
	/** Empty when the chart ends on V/vi. Never invent a sounded vi. */
	resolutionIndices: number[];
}

/** A cadenced I can retain its center over a short turnaround toward its relative minor. */
export function majorTurnarounds(flat: FlattenedTune, order: number[], evidence: (ChordEvidence | null)[],
	regions: MajorRegion[], boundaries: number[], barLength: number, formEnd: Fraction, cyclic: boolean): MajorTurnaround[] {
	const found: MajorTurnaround[] = [];
	const position = new Map(order.map((index, n) => [index, n]));
	const harmony = flat.harmony;
	const endOf = (i: number) => addFractions(harmony[i].startOffset, harmony[i].duration);
	const offset = (i: number) => fractionToFloat(harmony[i].startOffset);
	const cadenced = regions.filter(r => r.evidence.cadences.length);
	for (const region of cadenced) {
		const key = region.key;
		const tonic = region.evidence.cadences.at(-1)![1];
		const tail = region.segmentIndices.slice(region.segmentIndices.indexOf(tonic));
		const change = tail.findIndex(i => evidence[i]!.root !== key);
		if (change < 0 || !tail.slice(0, change).every(i => evidence[i]!.majorTonic)) continue;
		const approach = tail.slice(change);
		const iiRoot = transposePitchClass(key, 11);
		const iiTones = [0, 3, 6, 10].map(step => transposePitchClass(iiRoot, step));
		if (offset(approach[0]) - offset(tonic) > 4 * barLength || !approach.every(i => {
			const chord = evidence[i]!;
			return chord.root === iiRoot && chord.pitchClasses.length === 4 && iiTones.every(p => chord.pitchClasses.includes(p));
		})) continue;

		const dominantRoot = transposePitchClass(key, 4);
		const core = [0, 4, 7, 10].map(step => transposePitchClass(dominantRoot, step));
		const flatNine = transposePitchClass(dominantRoot, 1);
		const segments = [...approach];
		let cursor = position.get(approach.at(-1)!)! + 1;
		for (; cursor < order.length; cursor++) {
			const index = order[cursor], chord = evidence[index];
			if (chord?.root !== dominantRoot || !core.every(p => chord.pitchClasses.includes(p)) ||
				!chord.pitchClasses.every(p => core.includes(p) || p === flatNine) ||
				compareFractions(endOf(segments.at(-1)!), harmony[index].startOffset) !== 0) break;
			segments.push(index);
		}
		if (segments.length === approach.length) continue;
		const end = endOf(segments.at(-1)!);
		if (fractionToFloat(end) - offset(approach[0]) > barLength ||
			boundaries.some(b => b > offset(approach[0]) && b < fractionToFloat(end))) continue;

		const endsForm = compareFractions(end, formEnd) === 0;
		const wraps = endsForm && cyclic && compareFractions(harmony[order[0]].startOffset, [0, 1]) === 0;
		const next = wraps ? order[0] : order[cursor];
		const resolutionIndices: number[] = [];
		if (next !== undefined) {
			const target = evidence[next];
			if (compareFractions(harmony[next].startOffset, wraps ? [0, 1] : end) !== 0 ||
				target?.root !== transposePitchClass(key, 9) ||
				![3, 7].every(step => target.pitchClasses.includes(transposePitchClass(target.root, step)))) continue;
			const returning = cadenced.find(r => r.key === key && r.segmentIndices[0] === next &&
				offset(r.evidence.cadences[0][1]) - offset(next) <= 4 * barLength);
			if (!returning) continue;
			for (const i of returning.segmentIndices) {
				if (evidence[i]!.root !== target.root) break;
				resolutionIndices.push(i);
			}
			if (fractionToFloat(endOf(resolutionIndices.at(-1)!)) - offset(next) > barLength) continue;
		} else if (!endsForm) continue;
		found.push({ key, segmentIndices: segments, resolutionIndices });
	}
	return found;
}

export interface BorrowedMajorApproach {
	key: PitchClass;
	/** The borrowed iiø and V, excluding the major tonic that confirms them. */
	segmentIndices: number[];
}

/** Extend an evidenced V–I backwards through its contiguous borrowed iiø7. */
export function borrowedMajorApproaches(flat: FlattenedTune, order: number[], evidence: (ChordEvidence | null)[],
	regions: MajorRegion[], boundaries: number[]): BorrowedMajorApproach[] {
	const result: BorrowedMajorApproach[] = [];
	const position = new Map(order.map((index, n) => [index, n]));
	for (const region of regions) {
		const cadence = region.evidence.cadences[0];
		if (!cadence) continue;
		const dominant = transposePitchClass(region.key, 7);
		const tonicPosition = region.segmentIndices.indexOf(cadence[1]);
		const dominantIndices = region.segmentIndices.slice(0, tonicPosition);
		// The strict collection must open directly on V7 (possibly written in pieces).
		const guideTones = [4, 10].map(step => transposePitchClass(dominant, step));
		if (!dominantIndices.every(i => {
			const chord = evidence[i];
			return chord?.root === dominant && guideTones.every(p => chord.pitchClasses.includes(p));
		})) continue;
		const ii = transposePitchClass(region.key, 2);
		const halfDiminished = [0, 3, 6, 10].map(step => transposePitchClass(ii, step));
		const first = position.get(dominantIndices[0])!;
		let start = first;
		while (start > 0) {
			const i = order[start - 1];
			const chord = evidence[i];
			const previous = flat.harmony[i], next = flat.harmony[order[start]];
			if (chord?.root !== ii || chord.pitchClasses.length !== 4 || !halfDiminished.every(p => chord.pitchClasses.includes(p)) ||
				compareFractions(addFractions(previous.startOffset, previous.duration), next.startOffset) !== 0 ||
				boundaries.some(b => b > fractionToFloat(previous.startOffset) && b <= fractionToFloat(next.startOffset))) break;
			start--;
		}
		if (start < first) result.push({ key: region.key, segmentIndices: [...order.slice(start, first), ...dominantIndices] });
	}
	return result;
}

/** Explain short tonic-free passages bracketed by cadences in the same major key. */
export function majorContinuations(flat: FlattenedTune, order: number[], evidence: (ChordEvidence | null)[],
	regions: MajorRegion[], boundaries: number[], barLength: number): MajorContinuation[] {
	const result: MajorContinuation[] = [];
	const position = new Map(order.map((index, n) => [index, n]));
	const cadenced = regions.filter(r => r.evidence.cadences.length);
	const lastByKey = new Map<PitchClass, MajorRegion>();
	const endOf = (index: number): Fraction => addFractions(flat.harmony[index].startOffset, flat.harmony[index].duration);

	for (const right of cadenced) {
		const key = right.key;
		const left = lastByKey.get(key);
		lastByKey.set(key, right);
		if (!left) continue;
		const before = left.segmentIndices.at(-1)!;
		const after = right.segmentIndices[0];
		const start = fractionToFloat(endOf(before));
		const end = fractionToFloat(flat.harmony[after].startOffset);
		if (end <= start || end - start > 4 * barLength ||
			boundaries.some(t => t >= start && t <= end)) continue;
		if (cadenced.some(r => r.key !== key && r.evidence.cadences.some(([, tonic]) => {
			const time = fractionToFloat(flat.harmony[tonic].startOffset);
			return time >= start && time < end;
		}))) continue;

		const path = order.slice(position.get(before), position.get(after)! + 1);
		if (path.some((index, n) => !evidence[index] || (n > 0 &&
			compareFractions(endOf(path[n - 1]), flat.harmony[index].startOffset) !== 0))) continue;
		const scale = new Set([0, 2, 4, 5, 7, 9, 11].map(step => transposePitchClass(key, step)));
		const fits = (index: number) => evidence[index]!.pitchClasses.every(p => scale.has(p));
		const exceptions: MajorContinuation['exceptions'] = [];
		let supported = true;
		for (let n = 1; n < path.length - 1;) {
			const first = n++;
			const chord = evidence[path[first]]!;
			// One sustained harmony can be written as several adjacent segments.
			while (n < path.length - 1 && evidence[path[n]]!.root === chord.root &&
				evidence[path[n]]!.pitchClasses.join() === chord.pitchClasses.join()) n++;
			if (fits(path[first])) continue;
			const previous = path[first - 1], next = path[n];
			const duration = fractionToFloat(endOf(path[n - 1])) - fractionToFloat(flat.harmony[path[first]].startOffset);
			if (duration > barLength || !fits(previous) || !fits(next)) { supported = false; break; }
			const tones = chord.pitchClasses.map(p => pitchClassInterval(chord.root, p)).sort((a, b) => a - b).join();
			const from = evidence[previous]!, to = evidence[next]!;
			let role: MajorContinuation['exceptions'][number]['role'];
			if (pitchClassInterval(key, chord.root) === 5 && from.root === chord.root && from.majorTonic &&
				(tones === '0,3,7' || tones === '0,3,7,10') && [0, 4].includes(pitchClassInterval(key, to.root))) {
				role = 'borrowed iv';
			} else if (tones === '0,3,6,9' && [1, 11].includes(pitchClassInterval(from.root, chord.root)) &&
				pitchClassInterval(from.root, chord.root) === pitchClassInterval(chord.root, to.root)) {
				role = 'passing diminished seventh';
			} else if (augmentedDominantTarget(chord, to, key)) {
				role = 'applied augmented dominant';
			} else { supported = false; break; }
			for (const index of path.slice(first, n)) exceptions.push({ index, role });
		}
		if (supported && exceptions.length) result.push({ key, segmentIndices: path.slice(1, -1), exceptions });
	}
	return result;
}
