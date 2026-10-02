/**
 * Community lead-sheet layer — favorites, adoption, and offline caching of
 * adopted sheets, mirroring `community.ts` for licks.
 *
 * Local-first pattern:
 *  - localStorage is authoritative for the UI's "is this favorited / adopted"
 *    state so rendering never waits on a round trip.
 *  - Writes go to Supabase fire-and-forget, with graceful logging on failure.
 *  - `initTuneCommunityFromCloud` hydrates the local caches (favorites,
 *    adoptions, adopted-sheet payloads, authors) from Supabase on startup.
 *  - A generation guard (via `getScopeGeneration`) discards writebacks if a
 *    user switch happened mid-flight.
 *
 * Community listing (`listCommunityTunes`) is the exception — a live
 * paginated query against Supabase rather than a local cache.
 */

import type { Tune } from '$lib/types/tune';
import { save, load } from './storage';
import { getScopeGeneration } from './user-scope';
import { cloudRowToTune } from './user-tunes';
import { validateAdoptedTune } from '$lib/tunes/adopted-tune-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';
import { getUserCoalesced } from '$lib/supabase/get-user';

/** localStorage key holding favorited lead-sheet ids. */
const FAVORITES_KEY = 'tune-favorites';

/** localStorage key holding the ids of adopted community lead sheets. */
const ADOPTIONS_KEY = 'tune-adoptions';

/**
 * localStorage key holding the Tune payloads for adopted community
 * sheets, so the library renders them offline.
 */
const ADOPTED_PAYLOADS_KEY = 'tune-adopted-payloads';

/** localStorage key holding author attribution per adopted sheet id. */
const ADOPTED_AUTHORS_KEY = 'tune-adopted-authors';

export interface AdoptedTuneAuthor {
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
}

/** Page size for `listCommunityTunes`. */
export const TUNE_PAGE_SIZE = 50;

export interface TuneCommunityFilters {
	search?: string;
	authorSearch?: string;
	sort?: 'popular' | 'newest';
	/** Omit sheets authored by this user (their own live under /tunes). */
	excludeUserId?: string;
}

export interface CommunityTune {
	sheet: Tune;
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
	favoriteCount: number;
	isFavoritedByMe: boolean;
	isAdoptedByMe: boolean;
}

// ─── Local cache helpers ────────────────────────────────────────────────

export function getTuneFavoritesLocal(): Set<string> {
	return new Set(load<string[]>(FAVORITES_KEY) ?? []);
}

export function getTuneAdoptionsLocal(): Set<string> {
	return new Set(load<string[]>(ADOPTIONS_KEY) ?? []);
}

/** Get adopted community lead sheets from the local cache. */
export function getAdoptedTunesLocal(): Tune[] {
	return load<Tune[]>(ADOPTED_PAYLOADS_KEY) ?? [];
}

export function getAdoptedTuneAuthorsLocal(): Record<string, AdoptedTuneAuthor> {
	return load<Record<string, AdoptedTuneAuthor>>(ADOPTED_AUTHORS_KEY) ?? {};
}

function saveFavoritesLocal(ids: Set<string>): void {
	save(FAVORITES_KEY, Array.from(ids));
}

function saveAdoptionsLocal(ids: Set<string>): void {
	save(ADOPTIONS_KEY, Array.from(ids));
}

function saveAdoptedPayloadsLocal(sheets: Tune[]): void {
	save(ADOPTED_PAYLOADS_KEY, sheets);
}

function saveAdoptedAuthorsLocal(authors: Record<string, AdoptedTuneAuthor>): void {
	save(ADOPTED_AUTHORS_KEY, authors);
}

/**
 * A foreign payload's pdfUrl points into the AUTHOR's private storage folder
 * — the adopter can neither download nor own it. Strip before caching.
 */
function stripForeignAssets(sheet: Tune): Tune {
	if (sheet.pdfUrl === undefined) return sheet;
	const { pdfUrl: _pdfUrl, ...rest } = sheet;
	return rest;
}

// ─── Listing ────────────────────────────────────────────────────────────

/**
 * Live paginated community listing. Two round trips: (1) tunes
 * filtered/sorted server-side, (2) author display names from
 * `public_tune_authors`. Author-name filtering is client-side after
 * the author fetch, so it is approximate w.r.t. pagination. Errors return
 * `[]` — listing never throws.
 */
export async function listCommunityTunes(
	supabase: SupabaseClient<Database>,
	filters: TuneCommunityFilters = {},
	offset = 0
): Promise<CommunityTune[]> {
	let query = supabase.from('tunes').select('*').is('deleted_at', null);

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

	query = query.range(offset, offset + TUNE_PAGE_SIZE - 1);

	const { data, error } = await query;
	if (error) {
		console.warn('Failed to list community lead sheets:', error);
		return [];
	}
	const rows = data ?? [];
	if (rows.length === 0) return [];

	const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
	const { data: authors, error: authorError } = await supabase
		.from('public_tune_authors')
		.select('id, display_name, avatar_url')
		.in('id', userIds);
	if (authorError) {
		console.warn('Failed to fetch lead sheet authors:', authorError);
	}
	const authorById = new Map((authors ?? []).map((a) => [a.id, a]));

	const favorites = getTuneFavoritesLocal();
	const adoptions = getTuneAdoptionsLocal();

	let results: CommunityTune[] = rows.map((row) => {
		const author = authorById.get(row.user_id);
		return {
			sheet: cloudRowToTune(row),
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

/** A shared tune fetched for viewing, with its author's display name. */
export interface SharedTune extends AdoptedTuneAuthor {
	sheet: Tune;
}

/**
 * One shared tune by id, for the detail page: the community card links
 * `/tunes/<id>`, and the route otherwise resolves only the viewer's own book
 * (curated + own + adopted), so a tune they have not adopted was "not found".
 * Validated like an adopted payload (it reaches the ABC engraver) and
 * stripped of the author's private PDF. Caches nothing — viewing is not
 * adopting. Null when the row is missing, deleted, unreadable or invalid;
 * never throws.
 */
export async function fetchCommunityTune(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<SharedTune | null> {
	try {
		const { data: row, error } = await supabase
			.from('tunes')
			.select('*')
			.eq('id', sheetId)
			.is('deleted_at', null)
			.maybeSingle();
		if (error || !row) {
			if (error) console.warn('Failed to fetch shared tune:', error);
			return null;
		}
		const sheet = stripForeignAssets(cloudRowToTune(row));
		const validation = validateAdoptedTune(sheet);
		if (!validation.valid) {
			console.warn(`Shared tune ${sheetId} failed validation:`, validation.errors);
			return null;
		}
		const { data: author } = await supabase
			.from('public_tune_authors')
			.select('id, display_name, avatar_url')
			.eq('id', row.user_id)
			.maybeSingle();
		return {
			sheet,
			authorId: row.user_id,
			authorName: author?.display_name ?? null,
			authorAvatarUrl: author?.avatar_url ?? null
		};
	} catch (err) {
		console.warn('Failed to fetch shared tune:', err);
		return null;
	}
}

// ─── Favorites ──────────────────────────────────────────────────────────

/**
 * Toggle whether the current user has favorited a lead sheet. Returns the new
 * state. Optimistically updates the local cache; reverts if the server
 * rejects. `favorite_count` is never written by the client — DB triggers own it.
 */
export async function toggleTuneFavorite(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<boolean> {
	const favorites = getTuneFavoritesLocal();
	const wasFavorited = favorites.has(sheetId);

	// Optimistic local write before any await.
	if (wasFavorited) favorites.delete(sheetId);
	else favorites.add(sheetId);
	saveFavoritesLocal(favorites);

	const {
		data: { user }
	} = await getUserCoalesced(supabase);
	if (!user) {
		// Revert — no session to persist the toggle under.
		if (wasFavorited) favorites.add(sheetId);
		else favorites.delete(sheetId);
		saveFavoritesLocal(favorites);
		return wasFavorited;
	}

	if (wasFavorited) {
		const { error } = await supabase
			.from('tune_favorites')
			.delete()
			.eq('user_id', user.id)
			.eq('tune_id', sheetId);
		if (error) {
			console.warn('Failed to unfavorite lead sheet:', error);
			favorites.add(sheetId);
			saveFavoritesLocal(favorites);
			return true;
		}
		return false;
	}

	const { error } = await supabase
		.from('tune_favorites')
		.insert({ user_id: user.id, tune_id: sheetId });
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
 * any local write. If the payload fetch fails, the detail page can supply
 * the shared sheet already being viewed; it is revalidated before caching.
 * A Postgres 23505 unique-violation means the server already has this
 * adoption — treated as success.
 *
 * @returns `true` if the adoption is recorded on the server (or was already),
 *          `false` if the server write failed, auth is absent or the user changed.
 */
export async function adoptTune(
	supabase: SupabaseClient<Database>,
	sheetId: string,
	viewed?: SharedTune
): Promise<boolean> {
	const gen = getScopeGeneration();
	const adoptions = getTuneAdoptionsLocal();
	if (adoptions.has(sheetId) && getAdoptedTunesLocal().some((sheet) => sheet.id === sheetId)) {
		return true;
	}

	const {
		data: { user }
	} = await getUserCoalesced(supabase);
	if (gen !== getScopeGeneration()) return false;
	if (!user) {
		console.warn('Cannot adopt lead sheet without an authenticated session');
		return false;
	}

	const { error: insertError } = await supabase
		.from('tune_adoptions')
		.insert({ user_id: user.id, tune_id: sheetId });
	if (gen !== getScopeGeneration()) return false;
	if (insertError && (insertError as { code?: string }).code !== '23505') {
		console.warn('Failed to adopt lead sheet:', insertError);
		return false;
	}

	const { data: row, error: fetchError } = await supabase
		.from('tunes')
		.select('*')
		.eq('id', sheetId)
		.single();
	if (gen !== getScopeGeneration()) return false;
	const fetched = !fetchError && row;
	const candidate = fetched ? cloudRowToTune(row) : viewed?.sheet;
	if (fetchError || !row) {
		// Prefer the in-hand shared sheet; otherwise startup hydration retries.
		console.warn('Adopted tune but failed to fetch payload:', fetchError);
	}
	if (candidate && candidate.id === sheetId) {
		const sheet = stripForeignAssets(candidate);
		const validation = validateAdoptedTune(sheet);
		if (!validation.valid) {
			console.warn(`Adopted lead sheet ${sheetId} failed validation; not caching payload:`, validation.errors);
		} else {
			// Prefer the server-fresh payload; the validated viewed copy is a
			// fallback. Replace divergent caches after a partially-failed return.
			const payloads = getAdoptedTunesLocal();
			const existingIdx = payloads.findIndex((p) => p.id === sheetId);
			if (existingIdx === -1) payloads.push(sheet);
			else payloads[existingIdx] = sheet;
			saveAdoptedPayloadsLocal(payloads);

			const { data: author } = fetched
				? await supabase
					.from('public_tune_authors')
					.select('id, display_name, avatar_url')
					.eq('id', row.user_id)
					.single()
				: { data: null };
			if (gen !== getScopeGeneration()) return false;
			const authors = getAdoptedTuneAuthorsLocal();
			authors[sheetId] = {
				authorId: fetched ? row.user_id : viewed!.authorId,
				authorName: fetched ? author?.display_name ?? null : viewed!.authorName,
				authorAvatarUrl: fetched ? author?.avatar_url ?? null : viewed!.authorAvatarUrl
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
export async function returnTune(
	supabase: SupabaseClient<Database>,
	sheetId: string
): Promise<boolean> {
	const adoptions = getTuneAdoptionsLocal();
	if (!adoptions.has(sheetId)) return true;

	const {
		data: { user }
	} = await getUserCoalesced(supabase);
	if (!user) return false;

	const { error } = await supabase
		.from('tune_adoptions')
		.delete()
		.eq('user_id', user.id)
		.eq('tune_id', sheetId);
	if (error) {
		console.warn('Failed to return lead sheet:', error);
		return false;
	}

	adoptions.delete(sheetId);
	saveAdoptionsLocal(adoptions);
	saveAdoptedPayloadsLocal(getAdoptedTunesLocal().filter((p) => p.id !== sheetId));
	const authors = getAdoptedTuneAuthorsLocal();
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
export async function initTuneCommunityFromCloud(
	supabase: SupabaseClient<Database>
): Promise<boolean> {
	const gen = getScopeGeneration();
	try {
		const {
			data: { user }
		} = await getUserCoalesced(supabase);
		if (!user) return false;

		// 1. Favorites — best-effort.
		const { data: favRows, error: favError } = await supabase
			.from('tune_favorites')
			.select('tune_id')
			.eq('user_id', user.id);
		if (favError) {
			console.warn('Failed to hydrate lead sheet favorites:', favError);
		} else if (gen === getScopeGeneration()) {
			saveFavoritesLocal(new Set((favRows ?? []).map((r) => r.tune_id)));
		}

		// 2. Adoptions — authoritative for the report.
		const { data: adoptionRows, error: adoptionError } = await supabase
			.from('tune_adoptions')
			.select('tune_id')
			.eq('user_id', user.id);
		if (adoptionError) {
			console.warn('Failed to hydrate lead sheet adoptions:', adoptionError);
			return false;
		}
		const adoptedIds = (adoptionRows ?? []).map((r) => r.tune_id);
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
			.from('tunes')
			.select('*')
			.in('id', adoptedIds);
		if (sheetError) {
			console.warn('Failed to fetch adopted lead sheet payloads:', sheetError);
			// Keep the payload/author caches in sync with the authoritative
			// adoption set we just wrote — drop entries for ids no longer adopted.
			if (gen === getScopeGeneration()) {
				const keep = new Set(adoptedIds);
				saveAdoptedPayloadsLocal(getAdoptedTunesLocal().filter((s) => keep.has(s.id)));
				saveAdoptedAuthorsLocal(
					Object.fromEntries(
						Object.entries(getAdoptedTuneAuthorsLocal()).filter(([id]) => keep.has(id))
					)
				);
			}
			return false;
		}

		// Validate every payload; invalid ones stay in the adoption set (so the
		// user can still return them) but never enter the cache.
		const validatedRows: NonNullable<typeof sheetRows> = [];
		const validated: Tune[] = [];
		for (const row of sheetRows ?? []) {
			const sheet = stripForeignAssets(cloudRowToTune(row));
			const validation = validateAdoptedTune(sheet);
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
			.from('public_tune_authors')
			.select('id, display_name, avatar_url')
			.in('id', authorIds);
		if (authorError) {
			console.warn('Failed to hydrate lead sheet authors:', authorError);
			if (gen === getScopeGeneration()) {
				const keep = new Set(validatedRows.map((r) => r.id));
				saveAdoptedAuthorsLocal(
					Object.fromEntries(
						Object.entries(getAdoptedTuneAuthorsLocal()).filter(([id]) => keep.has(id))
					)
				);
			}
		} else if (gen === getScopeGeneration()) {
			const byAuthorId = new Map((authorRows ?? []).map((a) => [a.id, a]));
			const authorMap: Record<string, AdoptedTuneAuthor> = {};
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
