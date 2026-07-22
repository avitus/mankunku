/**
 * Curated lead-sheet index — re-exports all curated tunes.
 * All melodies are public-domain (traditional) or original.
 */
import type { LeadSheet } from '$lib/types/lead-sheet';
import { WHEN_THE_SAINTS } from './when-the-saints';
import { AMAZING_GRACE } from './amazing-grace';
import { MANKUNKU_BLUES } from './mankunku-blues';

export const ALL_CURATED_LEAD_SHEETS: LeadSheet[] = [
	WHEN_THE_SAINTS,
	AMAZING_GRACE,
	MANKUNKU_BLUES
];

export { WHEN_THE_SAINTS, AMAZING_GRACE, MANKUNKU_BLUES };
