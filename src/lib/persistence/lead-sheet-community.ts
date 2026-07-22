/**
 * Community lead-sheet layer — favorites, adoption, and offline caching of
 * adopted sheets, mirroring `community.ts` for licks.
 *
 * Local-first pattern:
 *  - localStorage is authoritative for the UI's "is this favorited / adopted"
 *    state so rendering never waits on a round trip.
 *  - Writes go to Supabase fire-and-forget, with graceful logging on failure.
 *  - `initLeadSheetCommunityFromCloud` hydrates the local caches (favorites,
 *    adoptions, adopted-sheet payloads, authors) from Supabase on startup.
 *  - A generation guard (via `getScopeGeneration`) discards writebacks if a
 *    user switch happened mid-flight.
 *
 * Community listing (`listCommunityLeadSheets`) is the exception — a live
 * paginated query against Supabase rather than a local cache.
 */

import type { LeadSheet } from '$lib/types/lead-sheet';
import { save, load } from './storage';
import { getScopeGeneration } from './user-scope';
import { cloudRowToLeadSheet } from './user-lead-sheets';
import { validateAdoptedLeadSheet } from '$lib/leadsheets/adopted-lead-sheet-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

/** localStorage key holding favorited lead-sheet ids. */
const FAVORITES_KEY = 'leadsheet-favorites';

/** localStorage key holding the ids of adopted community lead sheets. */
const ADOPTIONS_KEY = 'leadsheet-adoptions';

/**
 * localStorage key holding the LeadSheet payloads for adopted community
 * sheets, so the library renders them offline.
 */
const ADOPTED_PAYLOADS_KEY = 'leadsheet-adopted-payloads';

/** localStorage key holding author attribution per adopted sheet id. */
const ADOPTED_AUTHORS_KEY = 'leadsheet-adopted-authors';

export interface AdoptedLeadSheetAuthor {
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
}

/** Page size for `listCommunityLeadSheets`. */
export const LEAD_SHEET_PAGE_SIZE = 50;

export interface LeadSheetCommunityFilters {
	search?: string;
	authorSearch?: string;
	sort?: 'popular' | 'newest';
	/** Omit sheets authored by this user (their own live under /lead-sheets). */
	excludeUserId?: string;
}

export interface CommunityLeadSheet {
	sheet: LeadSheet;
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
	favoriteCount: number;
	isFavoritedByMe: boolean;
	isAdoptedByMe: boolean;
}

// ─── Local cache helpers ────────────────────────────────────────────────

export function getLeadSheetFavoritesLocal(): Set<string> {
	return new Set(load<string[]>(FAVORITES_KEY) ?? []);
}

export function getLeadSheetAdoptionsLocal(): Set<string> {
	return new Set(load<string[]>(ADOPTIONS_KEY) ?? []);
}

/** Get adopted community lead sheets from the local cache. */
export function getAdoptedLeadSheetsLocal(): LeadSheet[] {
	return load<LeadSheet[]>(ADOPTED_PAYLOADS_KEY) ?? [];
}

export function getAdoptedLeadSheetAuthorsLocal(): Record<string, AdoptedLeadSheetAuthor> {
	return load<Record<string, AdoptedLeadSheetAuthor>>(ADOPTED_AUTHORS_KEY) ?? {};
}

function saveFavoritesLocal(ids: Set<string>): void {
	save(FAVORITES_KEY, Array.from(ids));
}

function saveAdoptionsLocal(ids: Set<string>): void {
	save(ADOPTIONS_KEY, Array.from(ids));
}

function saveAdoptedPayloadsLocal(sheets: LeadSheet[]): void {
	save(ADOPTED_PAYLOADS_KEY, sheets);
}

function saveAdoptedAuthorsLocal(authors: Record<string, AdoptedLeadSheetAuthor>): void {
	save(ADOPTED_AUTHORS_KEY, authors);
}

/**
 * A foreign payload's pdfUrl points into the AUTHOR's private storage folder
 * — the adopter can neither download nor own it. Strip before caching.
 */
function stripForeignAssets(sheet: LeadSheet): LeadSheet {
	if (sheet.pdfUrl === undefined) return sheet;
	const { pdfUrl: _pdfUrl, ...rest } = sheet;
	return rest;
}

// ─── Listing ────────────────────────────────────────────────────────────

/**
 * Live paginated community listing. Two round trips: (1) lead_sheets
 * filtered/sorted server-side, (2) author display names from
 * `public_lead_sheet_authors`. Author-name filtering is client-side after
 * the author fetch, so it is approximate w.r.t. pagination. Errors return
 * `[]` — listing never throws.
 */
export async function listCommunityLeadSheets(
	supabase: SupabaseClient<Database>,
	filters: LeadSheetCommunityFilters = {},
	offset = 0
): Promise<CommunityLeadSheet[]> {
	let query = supabase.from('lead_sheets').select('*').is('deleted_at', null);

	if (filters.excludeUserId) {
		query = query.neq('user_id', filters.excludeUserId);
	}

	if (filters.search) {
		const term = filters.search.trim();
		if (term) {
			// PostgREST ilike with % wildcards; also strip characters that would
			// break the PostgreSQL array literal in the tags.cs.{...} clause
			// ({}, ", \) and newlines. Search is UX-casual, not a power-user query.
			const safe = term.replace(/[%_,(){}"\\\n\r]/g, ' ').trim();
			if (safe) {
				query = query.or(`title.ilike.%${safe}%,composer.ilike.%${safe}%,tags.cs.{${safe}}`);
			}
		}
	}

	if (filters.sort === 'newest') {
		query = query.order('created_at', { ascending: false });
	} else {
		query = query
			.order('favorite_count', { ascending: false })
			.order('created_at', { ascending: false });
	}

	query = query.range(offset, offset + LEAD_SHEET_PAGE_SIZE - 1);

	const { data, error } = await query;
	if (error) {
		console.warn('Failed to list community lead sheets:', error);
		return [];
	}
	const rows = data ?? [];
	if (rows.length === 0) return [];

	const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
	const { data: authors, error: authorError } = await supabase
		.from('public_lead_sheet_authors')
		.select('id, display_name, avatar_url')
		.in('id', userIds);
	if (authorError) {
		console.warn('Failed to fetch lead sheet authors:', authorError);
	}
	const authorById = new Map((authors ?? []).map((a) => [a.id, a]));

	const favorites = getLeadSheetFavoritesLocal();
	const adoptions = getLeadSheetAdoptionsLocal();

	let results: CommunityLeadSheet[] = rows.map((row) => {
		const author = authorById.get(row.user_id);
		return {
			sheet: cloudRowToLeadSheet(row),
			authorId: row.user_id,
			authorName: author?.display_name ?? null,
			authorAvatarUrl: author?.avatar_url ?? null,
			favoriteCount: row.favorite_count,
			isFavoritedByMe: favorites.has(row.id),
			isAdoptedByMe: adoptions.has(row.id)
		};
	});

	if (filters.authorSearch) {
		const q = filters.authorSearch.toLowerCase();
		results = results.filter((r) => (r.authorName ?? '').toLowerCase().includes(q));
	}

	return results;
}

// ─── Favorites ──────────────────────────────────────────────────────────

/**
 * Toggle whether the current user has favorited a lead sheet. Returns the new
 * state. Optimistically updates the local cache; reverts if the server
 * rejects. `favorite_count` is never written by the client — DB triggers own it.
 */
export async function toggleLeadSheetFavorite(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<boolean> {
	const favorites = getLeadSheetFavoritesLocal();
	const wasFavorited = favorites.has(sheetId);

	// Optimistic local write before any await.
	if (wasFavorited) favorites.delete(sheetId);
	else favorites.add(sheetId);
	saveFavoritesLocal(favorites);

	const {
		data: { user }
	} = await supabase.auth.getUser();
	if (!user) {
		// Revert — no session to persist the toggle under.
		if (wasFavorited) favorites.add(sheetId);
		else favorites.delete(sheetId);
		saveFavoritesLocal(favorites);
		return wasFavorited;
	}

	if (wasFavorited) {
		const { error } = await supabase
			.from('lead_sheet_favorites')
			.delete()
			.eq('user_id', user.id)
			.eq('sheet_id', sheetId);
		if (error) {
			console.warn('Failed to unfavorite lead sheet:', error);
			favorites.add(sheetId);
			saveFavoritesLocal(favorites);
			return true;
		}
		return false;
	}

	const { error } = await supabase
		.from('lead_sheet_favorites')
		.insert({ user_id: user.id, sheet_id: sheetId });
	if (error) {
		console.warn('Failed to favorite lead sheet:', error);
		favorites.delete(sheetId);
		saveFavoritesLocal(favorites);
		return false;
	}
	return true;
}

// ─── Adoption ───────────────────────────────────────────────────────────

/**
 * Adopt a community lead sheet into the user's library.
 *
 * Server-first (unlike toggleFavorite): the adoption row is inserted before
 * any local write, because the payload fetch must succeed for the cache to
 * be useful. A Postgres 23505 unique-violation means the server already has
 * this adoption — treated as success.
 *
 * @returns `true` if the adoption is recorded on the server (or was already),
 *          `false` if the server write failed or no auth session exists.
 */
export async function adoptLeadSheet(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<boolean> {
	const adoptions = getLeadSheetAdoptionsLocal();
	if (adoptions.has(sheetId)) return true;

	const {
		data: { user }
	} = await supabase.auth.getUser();
	if (!user) {
		console.warn('Cannot adopt lead sheet without an authenticated session');
		return false;
	}

	const { error: insertError } = await supabase
		.from('lead_sheet_adoptions')
		.insert({ user_id: user.id, sheet_id: sheetId });
	if (insertError && (insertError as { code?: string }).code !== '23505') {
		console.warn('Failed to adopt lead sheet:', insertError);
		return false;
	}

	const { data: row, error: fetchError } = await supabase
		.from('lead_sheets')
		.select('*')
		.eq('id', sheetId)
		.single();
	if (fetchError || !row) {
		// The adoption row is in place; next startup hydration picks the payload up.
		console.warn('Adopted lead sheet but failed to fetch payload:', fetchError);
	} else {
		const sheet = stripForeignAssets(cloudRowToLeadSheet(row));
		const validation = validateAdoptedLeadSheet(sheet);
		if (!validation.valid) {
			console.warn(`Adopted lead sheet ${sheetId} failed validation; not caching payload:`, validation.errors);
		} else {
			const payloads = getAdoptedLeadSheetsLocal();
			if (!payloads.some((p) => p.id === sheetId)) {
				payloads.push(sheet);
				saveAdoptedPayloadsLocal(payloads);
			}

			const { data: author } = await supabase
				.from('public_lead_sheet_authors')
				.select('id, display_name, avatar_url')
				.eq('id', row.user_id)
				.single();
			const authors = getAdoptedLeadSheetAuthorsLocal();
			authors[sheetId] = {
				authorId: row.user_id,
				authorName: author?.display_name ?? null,
				authorAvatarUrl: author?.avatar_url ?? null
			};
			saveAdoptedAuthorsLocal(authors);
		}
	}

	adoptions.add(sheetId);
	saveAdoptionsLocal(adoptions);
	return true;
}

/**
 * Return (un-adopt) a community lead sheet. Server-first: local caches are
 * only cleaned after the server delete succeeds.
 */
export async function returnLeadSheet(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<boolean> {
	const adoptions = getLeadSheetAdoptionsLocal();
	if (!adoptions.has(sheetId)) return true;

	const {
		data: { user }
	} = await supabase.auth.getUser();
	if (!user) return false;

	const { error } = await supabase
		.from('lead_sheet_adoptions')
		.delete()
		.eq('user_id', user.id)
		.eq('sheet_id', sheetId);
	if (error) {
		console.warn('Failed to return lead sheet:', error);
		return false;
	}

	adoptions.delete(sheetId);
	saveAdoptionsLocal(adoptions);
	saveAdoptedPayloadsLocal(getAdoptedLeadSheetsLocal().filter((p) => p.id !== sheetId));
	const authors = getAdoptedLeadSheetAuthorsLocal();
	delete authors[sheetId];
	saveAdoptedAuthorsLocal(authors);
	return true;
}

// ─── Startup hydration ──────────────────────────────────────────────────

/**
 * Bidirectional startup sync for lead-sheet community state:
 *   1. Pull favorite ids → localStorage (best-effort).
 *   2. Pull adoption ids → localStorage.
 *   3. For each adopted sheet, pull the latest payload → localStorage.
 *
 * Called once from `+layout.ts` during hydration. Never throws.
 *
 * Returns `true` when the ADOPTED-SHEET SET is verifiably faithful to the
 * cloud (adoption ids + payloads hydrated, or affirmatively empty).
 * Favorites/author failures stay best-effort — display-only caches with no
 * bearing on sheet-set completeness.
 */
export async function initLeadSheetCommunityFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	const gen = getScopeGeneration();
	try {
		const {
			data: { user }
		} = await supabase.auth.getUser();
		if (!user) return false;

		// 1. Favorites — best-effort.
		const { data: favRows, error: favError } = await supabase
			.from('lead_sheet_favorites')
			.select('sheet_id')
			.eq('user_id', user.id);
		if (favError) {
			console.warn('Failed to hydrate lead sheet favorites:', favError);
		} else if (gen === getScopeGeneration()) {
			saveFavoritesLocal(new Set((favRows ?? []).map((r) => r.sheet_id)));
		}

		// 2. Adoptions — authoritative for the report.
		const { data: adoptionRows, error: adoptionError } = await supabase
			.from('lead_sheet_adoptions')
			.select('sheet_id')
			.eq('user_id', user.id);
		if (adoptionError) {
			console.warn('Failed to hydrate lead sheet adoptions:', adoptionError);
			return false;
		}
		const adoptedIds = (adoptionRows ?? []).map((r) => r.sheet_id);
		if (gen !== getScopeGeneration()) return false;
		saveAdoptionsLocal(new Set(adoptedIds));

		if (adoptedIds.length === 0) {
			// Affirmatively empty — clear stale payload/author caches.
			saveAdoptedPayloadsLocal([]);
			saveAdoptedAuthorsLocal({});
			return true;
		}

		// 3. Payloads.
		const { data: sheetRows, error: sheetError } = await supabase
			.from('lead_sheets')
			.select('*')
			.in('id', adoptedIds);
		if (sheetError) {
			console.warn('Failed to fetch adopted lead sheet payloads:', sheetError);
			// Keep the payload/author caches in sync with the authoritative
			// adoption set we just wrote — drop entries for ids no longer adopted.
			if (gen === getScopeGeneration()) {
				const keep = new Set(adoptedIds);
				saveAdoptedPayloadsLocal(getAdoptedLeadSheetsLocal().filter((s) => keep.has(s.id)));
				saveAdoptedAuthorsLocal(
					Object.fromEntries(
						Object.entries(getAdoptedLeadSheetAuthorsLocal()).filter(([id]) => keep.has(id))
					)
				);
			}
			return false;
		}

		// Validate every payload; invalid ones stay in the adoption set (so the
		// user can still return them) but never enter the cache.
		const validatedRows: NonNullable<typeof sheetRows> = [];
		const validated: LeadSheet[] = [];
		for (const row of sheetRows ?? []) {
			const sheet = stripForeignAssets(cloudRowToLeadSheet(row));
			const validation = validateAdoptedLeadSheet(sheet);
			if (validation.valid) {
				validatedRows.push(row);
				validated.push(sheet);
			} else {
				console.warn(`Adopted lead sheet ${row.id} failed validation; excluded from cache:`, validation.errors);
			}
		}
		if (gen !== getScopeGeneration()) return false;
		saveAdoptedPayloadsLocal(validated);

		// 4. Authors — best-effort.
		if (validatedRows.length === 0) {
			saveAdoptedAuthorsLocal({});
			return true;
		}
		const authorIds = Array.from(new Set(validatedRows.map((r) => r.user_id)));
		const { data: authorRows, error: authorError } = await supabase
			.from('public_lead_sheet_authors')
			.select('id, display_name, avatar_url')
			.in('id', authorIds);
		if (authorError) {
			console.warn('Failed to hydrate lead sheet authors:', authorError);
			if (gen === getScopeGeneration()) {
				const keep = new Set(validatedRows.map((r) => r.id));
				saveAdoptedAuthorsLocal(
					Object.fromEntries(
						Object.entries(getAdoptedLeadSheetAuthorsLocal()).filter(([id]) => keep.has(id))
					)
				);
			}
		} else if (gen === getScopeGeneration()) {
			const byAuthorId = new Map((authorRows ?? []).map((a) => [a.id, a]));
			const authorMap: Record<string, AdoptedLeadSheetAuthor> = {};
			for (const row of validatedRows) {
				const a = byAuthorId.get(row.user_id);
				authorMap[row.id] = {
					authorId: row.user_id,
					authorName: a?.display_name ?? null,
					authorAvatarUrl: a?.avatar_url ?? null
				};
			}
			saveAdoptedAuthorsLocal(authorMap);
		}

		return true;
	} catch (error) {
		console.warn('Failed to hydrate lead sheet community state:', error);
		return false;
	}
}
