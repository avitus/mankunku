import type { PitchClass } from '$lib/types/music';
import type { ChordEvidence } from '$lib/music/chord-evidence';
import { addFractions, compareFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import { transposePitchClass, pitchClassInterval } from '$lib/music/transposition';
import type { FlattenedTune } from './flatten';
import type { MajorRegion } from './harmonic-analysis';

export interface ContextualMajorRegion extends MajorRegion {
	/** An explained exception to the collection, never permission for scale-based lick matching. */
	secondaryDominant: {
		segmentIndices: number[];
		resolutionIndex: number;
		targetKey: PitchClass;
		targetDegree: 'ii' | 'iii' | 'IV' | 'V' | 'vi';
	};
}

const DEGREES = [0, 2, 4, 5, 7, 9, 11];
const TARGETS: Readonly<Record<number, ContextualMajorRegion['secondaryDominant']['targetDegree']>> = {
	2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi'
};

/**
 * Continue an established major center through one brief applied dominant when
 * its diatonic resolution promptly rejoins the preceding harmonic vocabulary.
 * Conservative contextual interpretation only: strict collections and exercise
 * reservations are supplied unchanged by harmonic-analysis.
 */
export function contextualMajorRegions(
	flat: FlattenedTune, order: number[], evidence: (ChordEvidence | null)[],
	regions: MajorRegion[], barLength: number, sectionBoundaries: number[]
): ContextualMajorRegion[] {
	const harmony = flat.harmony;
	const endOf = (index: number) => addFractions(harmony[index].startOffset, harmony[index].duration);
	/** A section, gap or repeat-context boundary cannot be explained away. */
	const adjacent = (left: number, right: number): boolean =>
		compareFractions(endOf(left), harmony[right].startOffset) === 0 &&
		!sectionBoundaries.some(boundary => boundary > fractionToFloat(harmony[left].startOffset) &&
			boundary <= fractionToFloat(harmony[right].startOffset));
	const result: ContextualMajorRegion[] = [];
	for (const region of regions) {
		// A signature or a lone tonic is not enough to establish the parent key.
		if (!region.evidence.cadences.length || fractionToFloat(region.duration) < 2 * barLength) continue;
		const scale = new Set(DEGREES.map(degree => transposePitchClass(region.key, degree)));
		const fits = (index: number): boolean => !!evidence[index]?.pitchClasses.every(pitch => scale.has(pitch));
		let cursor = order.indexOf(region.segmentIndices.at(-1)!) + 1;
		const dominantIndex = order[cursor];
		const dominant = evidence[dominantIndex];
		if (!dominant || fits(dominantIndex) || !adjacent(region.segmentIndices.at(-1)!, dominantIndex)) continue;
		const core = [0, 4, 7, 10].map(interval => transposePitchClass(dominant.root, interval));
		if (!core.every(pitch => dominant.pitchClasses.includes(pitch)) ||
			!dominant.pitchClasses.every(pitch => scale.has(pitch) || core.includes(pitch))) continue;
		const dominantIndices = [dominantIndex];
		// Repeated notation segments of the same sounding chord count as one event.
		while (++cursor < order.length) {
			const index = order[cursor];
			const next = evidence[index];
			if (!next || next.root !== dominant.root || next.pitchClasses.join() !== dominant.pitchClasses.join() ||
				!adjacent(dominantIndices.at(-1)!, index)) break;
			dominantIndices.push(index);
		}
		if (fractionToFloat(subtractFractions(endOf(dominantIndices.at(-1)!), harmony[dominantIndex].startOffset)) > barLength) continue;
		const resolutionIndex = order[cursor];
		const resolution = evidence[resolutionIndex];
		if (!resolution || !fits(resolutionIndex) || !adjacent(dominantIndices.at(-1)!, resolutionIndex) ||
			pitchClassInterval(resolution.root, dominant.root) !== 7) continue;
		const degree = pitchClassInterval(region.key, resolution.root);
		const targetDegree = TARGETS[degree];
		const third = [2, 4, 9].includes(degree) ? 3 : 4;
		if (!targetDegree || ![0, third, 7].every(interval => resolution.pitchClasses.includes(transposePitchClass(resolution.root, interval)))) continue;
		const tail = [resolutionIndex];
		while (++cursor < order.length && fits(order[cursor]) && adjacent(tail.at(-1)!, order[cursor])) tail.push(order[cursor]);
		const roots = new Set(tail.map(index => evidence[index]!.root));
		const precedingRoots = new Set(region.segmentIndices.map(index => evidence[index]!.root));
		// A sustained new tonic is not a return. Require varied, shared harmony
		// and the parent's tonic or dominant within two bars of the resolution.
		const returnEnd = tail.findIndex((index, i) => {
			const prefix = tail.slice(0, i + 1).map(j => evidence[j]!.root);
			return new Set(prefix).size >= 3 && prefix.some(root => root === region.key || root === transposePitchClass(region.key, 7)) &&
				new Set(prefix.filter(root => root !== resolution.root && precedingRoots.has(root))).size >= 2 &&
				fractionToFloat(subtractFractions(harmony[index].startOffset, harmony[resolutionIndex].startOffset)) <= 2 * barLength;
		});
		if (roots.size < 3 || returnEnd < 0 ||
			fractionToFloat(subtractFractions(endOf(tail.at(-1)!), harmony[resolutionIndex].startOffset)) < barLength) continue;
		result.push({ ...region, segmentIndices: [...region.segmentIndices, ...dominantIndices, ...tail],
			duration: subtractFractions(endOf(tail.at(-1)!), region.startOffset),
			secondaryDominant: { segmentIndices: dominantIndices, resolutionIndex, targetKey: resolution.root, targetDegree } });
	}
	return result;
}
