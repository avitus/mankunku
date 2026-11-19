import type { PitchClass } from '$lib/types/music';
import type { ChordEvidence } from '$lib/music/chord-evidence';
import { addFractions, compareFractions, fractionToFloat, subtractFractions } from '$lib/music/intervals';
import { transposePitchClass, pitchClassInterval } from '$lib/music/transposition';
import type { FlattenedTune } from './flatten';
import type { MajorRegion } from './harmonic-analysis';

export interface SecondaryDominant {
	segmentIndices: number[];
	resolutionIndex: number;
	targetKey: PitchClass;
	targetDegree: 'ii' | 'iii' | 'IV' | 'V' | 'vi';
}

export interface ContextualMajorRegion extends MajorRegion {
	secondaryDominants: SecondaryDominant[];
}

const DEGREES = [0, 2, 4, 5, 7, 9, 11];
const TARGETS: Readonly<Record<number, SecondaryDominant['targetDegree']>> = {
	2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi'
};

/**
 * Continue an established major center through successive brief applied dominants when
 * each diatonic resolution promptly rejoins the preceding harmonic vocabulary.
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
	const position = new Map(order.map((index, i) => [index, i]));
	const result: ContextualMajorRegion[] = [];
	const coveredThrough = new Map<PitchClass, number>();
	for (const region of regions) {
		if (!region.evidence.cadences.length || fractionToFloat(region.duration) < 2 * barLength) continue;
		if (position.get(region.segmentIndices[0])! <= (coveredThrough.get(region.key) ?? -1)) continue;
		const scale = new Set(DEGREES.map(degree => transposePitchClass(region.key, degree)));
		const fits = (index: number): boolean => !!evidence[index]?.pitchClasses.every(pitch => scale.has(pitch));
		const segmentIndices = [...region.segmentIndices];
		const secondaryDominants: SecondaryDominant[] = [];
		let preceding = region.segmentIndices;
		let cursor = position.get(preceding.at(-1)!)! + 1;
		while (cursor < order.length) {
			const dominantIndex = order[cursor];
			const dominant = evidence[dominantIndex];
			if (!dominant || fits(dominantIndex) || !adjacent(preceding.at(-1)!, dominantIndex)) break;
			const core = [0, 4, 7, 10].map(interval => transposePitchClass(dominant.root, interval));
			if (!core.every(pitch => dominant.pitchClasses.includes(pitch)) ||
				!dominant.pitchClasses.every(pitch => scale.has(pitch) || core.includes(pitch))) break;
			const dominantIndices = [dominantIndex];
			// Repeated notation segments of the same sounding chord count as one event.
			while (++cursor < order.length) {
				const index = order[cursor];
				const next = evidence[index];
				if (!next || next.root !== dominant.root || next.pitchClasses.join() !== dominant.pitchClasses.join() ||
					!adjacent(dominantIndices.at(-1)!, index)) break;
				dominantIndices.push(index);
			}
			if (fractionToFloat(subtractFractions(endOf(dominantIndices.at(-1)!), harmony[dominantIndex].startOffset)) > barLength) break;
			const resolutionIndex = order[cursor];
			const resolution = evidence[resolutionIndex];
			if (!resolution || !fits(resolutionIndex) || !adjacent(dominantIndices.at(-1)!, resolutionIndex) ||
				pitchClassInterval(resolution.root, dominant.root) !== 7) break;
			const degree = pitchClassInterval(region.key, resolution.root);
			const targetDegree = TARGETS[degree];
			const third = [2, 4, 9].includes(degree) ? 3 : 4;
			if (!targetDegree || ![0, third, 7].every(interval => resolution.pitchClasses.includes(transposePitchClass(resolution.root, interval)))) break;
			const tail = [resolutionIndex];
			while (++cursor < order.length && fits(order[cursor]) && adjacent(tail.at(-1)!, order[cursor])) tail.push(order[cursor]);
			// Each excursion must return to the vocabulary heard immediately before it.
			const previousRoots = new Set(preceding.map(index => evidence[index]!.root));
			const sharedRoots = new Set<PitchClass>();
			let heardHome = false;
			for (const index of tail) {
				if (fractionToFloat(subtractFractions(harmony[index].startOffset, harmony[resolutionIndex].startOffset)) > 2 * barLength) break;
				const root = evidence[index]!.root;
				if (root === region.key || root === transposePitchClass(region.key, 7)) heardHome = true;
				if (root !== resolution.root && previousRoots.has(root)) sharedRoots.add(root);
			}
			if (!heardHome || sharedRoots.size < 2 ||
				fractionToFloat(subtractFractions(endOf(tail.at(-1)!), harmony[resolutionIndex].startOffset)) < barLength) break;
			segmentIndices.push(...dominantIndices, ...tail);
			secondaryDominants.push({ segmentIndices: dominantIndices, resolutionIndex, targetKey: resolution.root, targetDegree });
			preceding = tail;
		}
		if (secondaryDominants.length) {
			const last = segmentIndices.at(-1)!;
			result.push({ ...region, segmentIndices, duration: subtractFractions(endOf(last), region.startOffset), secondaryDominants });
			coveredThrough.set(region.key, position.get(last)!);
		}
	}
	return result;
}
