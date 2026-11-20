import type { Fraction, PitchClass } from '$lib/types/music';
import type { ChordEvidence } from '$lib/music/chord-evidence';
import { addFractions, compareFractions, fractionToFloat } from '$lib/music/intervals';
import { pitchClassInterval, transposePitchClass } from '$lib/music/transposition';
import type { FlattenedTune } from './flatten';
import type { MajorRegion } from './harmonic-analysis';

export interface MajorContinuation {
	key: PitchClass;
	/** Only the passage between the two cadenced collections. */
	segmentIndices: number[];
	exceptions: { index: number; role: 'borrowed iv' | 'passing diminished seventh' | 'applied augmented dominant' }[];
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
			} else if (tones === '0,4,8,10' && pitchClassInterval(to.root, chord.root) === 7 &&
				[2, 4, 9].includes(pitchClassInterval(key, to.root)) &&
				[3, 7].every(step => to.pitchClasses.includes(transposePitchClass(to.root, step)))) {
				role = 'applied augmented dominant';
			} else { supported = false; break; }
			for (const index of path.slice(first, n)) exceptions.push({ index, role });
		}
		if (supported && exceptions.length) result.push({ key, segmentIndices: path.slice(1, -1), exceptions });
	}
	return result;
}
