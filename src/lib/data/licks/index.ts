/**
 * Lick library index — re-exports all curated licks.
 */
import { II_V_I_MAJOR_LICKS } from './ii-V-I-major.ts';
import { BLUES_LICKS } from './blues.ts';
import { BEBOP_LICKS } from './bebop-lines.ts';
import { II_V_I_MINOR_LICKS } from './ii-V-I-minor.ts';
import type { Phrase } from '$lib/types/music.ts';

export const ALL_CURATED_LICKS: Phrase[] = [
	...II_V_I_MAJOR_LICKS,
	...BLUES_LICKS,
	...BEBOP_LICKS,
	...II_V_I_MINOR_LICKS
];

export { II_V_I_MAJOR_LICKS, BLUES_LICKS, BEBOP_LICKS, II_V_I_MINOR_LICKS };
