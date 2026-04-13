/**
 * Lick library index — re-exports all curated licks.
 */
import { II_V_I_MAJOR_LICKS } from './ii-V-I-major.ts';
import { BLUES_LICKS } from './blues.ts';
import { BEBOP_LICKS } from './bebop-lines.ts';
import { II_V_I_MINOR_LICKS } from './ii-V-I-minor.ts';
import { SHORT_II_V_I_MAJOR_LICKS } from './short-ii-V-I-major.ts';
import { SHORT_II_V_I_MINOR_LICKS } from './short-ii-V-I-minor.ts';
import { V_I_MAJOR_LICKS } from './V-I-major.ts';
import { V_I_MINOR_LICKS } from './V-I-minor.ts';
import { MAJOR_CHORD_LICKS } from './major-chord.ts';
import { DOMINANT_CHORD_LICKS } from './dominant-chord.ts';
import { MINOR_CHORD_LICKS } from './minor-chord.ts';
import { DIMINISHED_CHORD_LICKS } from './diminished-chord.ts';
import { PENTATONIC_LICKS } from './pentatonic.ts';
import { MODAL_LICKS } from './modal.ts';
import { RHYTHM_CHANGES_LICKS } from './rhythm-changes.ts';
import { BALLAD_LICKS } from './ballad.ts';
import { BEGINNER_CELL_LICKS } from './beginner-cells.ts';
import { COMBINED_LICKS } from '$lib/phrases/combiner.ts';
import type { Phrase } from '$lib/types/music.ts';

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
