import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { PitchClass } from '$lib/types/music';
import { scaleDegreeOf } from '$lib/music/scale-degree';
import { fractionToFloat } from '$lib/music/intervals';
import { progressionColor } from '$lib/music/progression-display';
import { PROGRESSION_TEMPLATES } from '$lib/data/progressions';
import type { DetectedProgression } from './progression-detector';
import type { MajorRegion } from './harmonic-analysis';

/** Presentation identity only: a region is never a generated progression template. */
export type PracticeTargetType = ChordProgressionType | 'major-region';

export interface MajorRegionTarget {
	type: 'major-region';
	region: MajorRegion;
	localKey: PitchClass;
	tuneKeyDegree: DetectedProgression['tuneKeyDegree'];
	startOffset: MajorRegion['startOffset'];
	duration: MajorRegion['duration'];
	segmentIndices: number[];
}

export type PracticeTarget = DetectedProgression | MajorRegionTarget;

/** Return the chart label without treating a region as a progression template. */
export function practiceTargetName(type: PracticeTargetType): string {
	return type === 'major-region' ? 'Major region' : PROGRESSION_TEMPLATES[type].shortName;
}

/** Share the major color for regions while retaining named progression colors. */
export function practiceTargetColor(type: PracticeTargetType): string {
	return type === 'major-region' ? 'var(--prog-major-vamp)' : progressionColor(type);
}

/**
 * Decide harmony before consulting a lick book. Prefer cadential evidence, then
 * the song key, then the longer supported phrase. Equal overlapping alternatives
 * remain unassigned; pitch-class order and lick availability never settle a tie.
 */
export function majorRegionTargets(regions: readonly MajorRegion[], tuneKey: PitchClass): MajorRegionTarget[] {
	/** Prefer harmonic evidence before span length when regions compete. */
	const compare = (a: MajorRegion, b: MajorRegion): number =>
		Number(a.evidence.cadences.length > 0) - Number(b.evidence.cadences.length > 0) ||
		Number(a.evidence.matchesTuneKey) - Number(b.evidence.matchesTuneKey) ||
		fractionToFloat(a.duration) - fractionToFloat(b.duration);
	return regions.filter((candidate) => !regions.some((other) => other !== candidate &&
		other.key !== candidate.key && other.segmentIndices.some((index) => candidate.segmentIndices.includes(index)) &&
		compare(other, candidate) >= 0)).map((region) => ({
		type: 'major-region', region, localKey: region.key, tuneKeyDegree: scaleDegreeOf(region.key, tuneKey),
		startOffset: region.startOffset, duration: region.duration, segmentIndices: region.segmentIndices
	}));
}
