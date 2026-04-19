/**
 * Lick library index — re-exports all curated licks.
 */
import { II_V_I_MAJOR_LICKS } from './ii-V-I-major';
import { BLUES_LICKS } from './blues';
import { BEBOP_LICKS } from './bebop-lines';
import { II_V_I_MINOR_LICKS } from './ii-V-I-minor';
import { SHORT_II_V_I_MAJOR_LICKS } from './short-ii-V-I-major';
import { SHORT_II_V_I_MINOR_LICKS } from './short-ii-V-I-minor';
import { V_I_MAJOR_LICKS } from './v-i-major';
import { V_I_MINOR_LICKS } from './v-i-minor';
import { MAJOR_CHORD_LICKS } from './major-chord';
import { DOMINANT_CHORD_LICKS } from './dominant-chord';
import { MINOR_CHORD_LICKS } from './minor-chord';
import { DIMINISHED_CHORD_LICKS } from './diminished-chord';
import { PENTATONIC_LICKS } from './pentatonic';
import { MODAL_LICKS } from './modal';
import { RHYTHM_CHANGES_LICKS } from './rhythm-changes';
import { BALLAD_LICKS } from './ballad';
import { BEGINNER_CELL_LICKS } from './beginner-cells';
import { COMBINED_LICKS } from '$lib/phrases/combiner';
import type { Phrase } from '$lib/types/music';

export const ALL_CURATED_LICKS: Phrase[] = [
	...BEGINNER_CELL_LICKS,
	...COMBINED_LICKS,
	...II_V_I_MAJOR_LICKS,
	...BLUES_LICKS,
	...BEBOP_LICKS,
	...II_V_I_MINOR_LICKS,
	...SHORT_II_V_I_MAJOR_LICKS,
	...SHORT_II_V_I_MINOR_LICKS,
	...V_I_MAJOR_LICKS,
	...V_I_MINOR_LICKS,
	...MAJOR_CHORD_LICKS,
	...DOMINANT_CHORD_LICKS,
	...MINOR_CHORD_LICKS,
	...DIMINISHED_CHORD_LICKS,
	...PENTATONIC_LICKS,
	...MODAL_LICKS,
	...RHYTHM_CHANGES_LICKS,
	...BALLAD_LICKS
];

export {
	BEGINNER_CELL_LICKS,
	II_V_I_MAJOR_LICKS,
	BLUES_LICKS,
	BEBOP_LICKS,
	II_V_I_MINOR_LICKS,
	SHORT_II_V_I_MAJOR_LICKS,
	SHORT_II_V_I_MINOR_LICKS,
	V_I_MAJOR_LICKS,
	V_I_MINOR_LICKS,
	MAJOR_CHORD_LICKS,
	DOMINANT_CHORD_LICKS,
	MINOR_CHORD_LICKS,
	DIMINISHED_CHORD_LICKS,
	PENTATONIC_LICKS,
	MODAL_LICKS,
	RHYTHM_CHANGES_LICKS,
	BALLAD_LICKS
};
