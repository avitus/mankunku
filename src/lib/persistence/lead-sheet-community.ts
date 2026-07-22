/**
 * Community lead-sheet layer — favorites, adoption, and offline caching of
 * adopted sheets, mirroring `community.ts` for licks.
 *
 * localStorage is authoritative for the UI's "is this favorited / adopted"
 * state; the cloud tables are hydrated on startup (Phase 2 of the lead-sheet
 * build-out).
 */

import type { LeadSheet } from '$lib/types/lead-sheet';
import { load } from './storage';

/**
 * localStorage key holding the LeadSheet payloads for adopted community
 * sheets, so the library renders them offline.
 */
const ADOPTED_PAYLOADS_KEY = 'leadsheet-adopted-payloads';

/** Get adopted community lead sheets from the local cache. */
export function getAdoptedLeadSheetsLocal(): LeadSheet[] {
	return load<LeadSheet[]>(ADOPTED_PAYLOADS_KEY) ?? [];
}
