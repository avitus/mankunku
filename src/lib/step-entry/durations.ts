import type { Fraction } from '$lib/types/music';

export type DurationId = 'whole' | 'half' | 'quarter' | 'eighth'
	| 'whole-triplet' | 'half-triplet' | 'quarter-triplet' | 'eighth-triplet';

export type BaseDurationId = 'whole' | 'half' | 'quarter' | 'eighth';

export const DURATIONS: Record<DurationId, Fraction> = {
	whole: [1, 1], half: [1, 2], quarter: [1, 4], eighth: [1, 8],
	'whole-triplet': [2, 3], 'half-triplet': [1, 3],
	'quarter-triplet': [1, 6], 'eighth-triplet': [1, 12]
};

export const BASE_DURATION_IDS: BaseDurationId[] = ['whole', 'half', 'quarter', 'eighth'];

export const DURATION_DISPLAY_NAMES: Record<DurationId, string> = {
	whole: 'Whole Note', half: 'Half Note', quarter: 'Quarter Note', eighth: 'Eighth Note',
	'whole-triplet': 'Whole Triplet', 'half-triplet': 'Half Triplet',
	'quarter-triplet': 'Quarter Triplet', 'eighth-triplet': 'Eighth Triplet'
};

export const KEYBOARD_SHORTCUTS: Record<string, BaseDurationId> = {
	'1': 'whole', '2': 'half', '3': 'quarter', '4': 'eighth'
};

export function getDurationFraction(baseId: BaseDurationId, isTriplet: boolean): Fraction {
	const key: DurationId = isTriplet ? `${baseId}-triplet` : baseId;
	return DURATIONS[key];
}
