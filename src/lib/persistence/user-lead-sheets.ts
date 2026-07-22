/**
 * User lead-sheet persistence — local-first storage for user-created and
 * imported lead sheets, mirroring `user-licks.ts`.
 *
 * localStorage is authoritative for the UI; cloud sync (Phase 2 of the
 * lead-sheet build-out) reconciles per-id via client_mtime + tombstones.
 */

import type { LeadSheet } from '$lib/types/lead-sheet';
import { load } from './storage';

/** localStorage key (namespaced by storage.ts) holding the live LeadSheet[] */
const STORAGE_KEY = 'user-leadsheets';

/** Get the user's lead sheets from localStorage only (no cloud round-trip). */
export function getUserLeadSheetsLocal(): LeadSheet[] {
	return load<LeadSheet[]>(STORAGE_KEY) ?? [];
}
