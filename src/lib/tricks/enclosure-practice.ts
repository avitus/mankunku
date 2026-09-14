import { PROGRESSION_TEMPLATES, type ProgressionTemplate } from '$lib/data/progressions';
import type { ChordProgressionType } from '$lib/types/lick-practice';
import type { TrickParameters } from '$lib/types/tricks';
import { ENCLOSURE_TYPES } from './devices/enclosures';

/** Supported beds; harmony and duration always come from the progression catalog. */
export const ENCLOSURE_PRACTICE_BEDS: readonly ProgressionTemplate[] = [
	...ENCLOSURE_TYPES.map((family) => PROGRESSION_TEMPLATES[family.bed]),
	PROGRESSION_TEMPLATES['ii-V-I-major-long'],
	PROGRESSION_TEMPLATES['ii-V-I-minor-long']
];

/** Unknown/unsupported choices fall back to the variant's original vamp. */
export function resolveEnclosurePracticeBed(
	parameters: TrickParameters,
	requested?: ChordProgressionType
): ChordProgressionType {
	if (requested && ENCLOSURE_PRACTICE_BEDS.some((bed) => bed.type === requested)) return requested;
	return (ENCLOSURE_TYPES.find((family) => family.value === parameters.type) ?? ENCLOSURE_TYPES[0]).bed;
}
