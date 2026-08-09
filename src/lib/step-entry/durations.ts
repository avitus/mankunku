import type { Fraction } from '$lib/types/music';

export type DurationId = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'
	| 'whole-triplet' | 'half-triplet' | 'quarter-triplet' | 'eighth-triplet'
	| 'half-dotted' | 'quarter-dotted' | 'eighth-dotted';

export type BaseDurationId = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

/** Bases that have a dotted variant in DURATIONS. */
export const DOTTED_BASES: ReadonlySet<BaseDurationId> = new Set(['half', 'quarter', 'eighth']);

/** Bases that have a triplet variant in DURATIONS. */
export const TRIPLET_BASES: ReadonlySet<BaseDurationId> = new Set([
	'whole', 'half', 'quarter', 'eighth'
]);

export const DURATIONS: Record<DurationId, Fraction> = {
	whole: [1, 1], half: [1, 2], quarter: [1, 4], eighth: [1, 8], sixteenth: [1, 16],
	'whole-triplet': [2, 3], 'half-triplet': [1, 3],
	'quarter-triplet': [1, 6], 'eighth-triplet': [1, 12],
	'half-dotted': [3, 4], 'quarter-dotted': [3, 8], 'eighth-dotted': [3, 16]
};

export const BASE_DURATION_IDS: BaseDurationId[] = [
	'whole', 'half', 'quarter', 'eighth', 'sixteenth'
];

export const DURATION_DISPLAY_NAMES: Record<DurationId, string> = {
	whole: 'Whole Note', half: 'Half Note', quarter: 'Quarter Note', eighth: 'Eighth Note',
	sixteenth: 'Sixteenth Note',
	'whole-triplet': 'Whole Triplet', 'half-triplet': 'Half Triplet',
	'quarter-triplet': 'Quarter Triplet', 'eighth-triplet': 'Eighth Triplet',
	'half-dotted': 'Dotted Half Note', 'quarter-dotted': 'Dotted Quarter Note',
	'eighth-dotted': 'Dotted Eighth Note'
};

export const KEYBOARD_SHORTCUTS: Record<string, BaseDurationId> = {
	'1': 'whole', '2': 'half', '3': 'quarter', '4': 'eighth', '5': 'sixteenth'
};

/**
 * Resolve the base duration plus its modifier toggles to a concrete DurationId.
 *
 * Dotted wins over triplet, and a modifier the base has no variant for is
 * ignored — so every (base, triplet, dotted) triple maps to a real DURATIONS
 * key. That totality is the point: a sixteenth has no triplet in this
 * vocabulary, and constructing the id blindly would yield `sixteenth-triplet`
 * and hand an `undefined` fraction to the note being entered.
 */
export function resolveDurationId(
	baseId: BaseDurationId,
	isTriplet: boolean,
	isDotted: boolean = false
): DurationId {
	if (isDotted && DOTTED_BASES.has(baseId)) return `${baseId}-dotted` as DurationId;
	if (isTriplet && TRIPLET_BASES.has(baseId)) return `${baseId}-triplet` as DurationId;
	return baseId;
}

export function getDurationFraction(baseId: BaseDurationId, isTriplet: boolean, isDotted: boolean = false): Fraction {
	return DURATIONS[resolveDurationId(baseId, isTriplet, isDotted)];
}
