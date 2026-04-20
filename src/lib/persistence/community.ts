/**
 * Client API for the Community Licks feature (browse, favorite, adopt).
 *
 * Mirrors the local-first pattern used by `user-licks.ts`:
 *  - localStorage is authoritative for the UI's "is this favorited / adopted"
 *    state so rendering never waits on a round trip.
 *  - Writes go to Supabase fire-and-forget, with graceful logging on failure.
 *  - `initCommunityFromCloud` hydrates the three local caches (favorites,
 *    adoptions, adopted-lick payloads) from Supabase on app startup.
 *  - A generation guard (via `getScopeGeneration`) discards writebacks if a
 *    user switch happened mid-flight.
 *
 * Community listing (`listCommunityLicks`) is the exception — it's a live
 * query against Supabase rather than a local cache. The corpus can be large
 * and filtered many ways; caching it locally would be bigger than the rest
 * of the app's data combined.
 */

import type {
	Phrase,
	PitchClass,
	Note,
	HarmonicSegment,
	DifficultyMetadata,
	PhraseCategory
} from '$lib/types/music';
import { save, load } from './storage';
import { getScopeGeneration } from './user-scope';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

/**
 * localStorage key holding the set of lick IDs the current user has favorited.
 * Stored as an array; converted to a Set on read.
 */
const FAVORITES_KEY = 'community-favorites';

/**
 * localStorage key holding the set of lick IDs the current user has adopted.
 * Stored as an array; converted to a Set on read.
 */
const ADOPTIONS_KEY = 'community-adoptions';

/**
 * localStorage key holding the Phrase payloads for adopted licks. Populated
 * from Supabase at startup; read synchronously by the library loader so the
 * `/library` page can show adopted licks offline.
 */
const ADOPTED_PAYLOADS_KEY = 'community-adopted-payloads';

/**
 * localStorage key holding author attribution for each adopted lick id:
 *   Record<lickId, { authorId, authorName, authorAvatarUrl }>
 */
const ADOPTED_AUTHORS_KEY = 'community-adopted-authors';

/**
 * localStorage key holding the one-time acknowledgement that the user has
 * seen the privacy disclosure shown above the first-save button.
 */
const PRIVACY_ACK_KEY = 'community-privacy-ack';

export function hasAcknowledgedCommunityPrivacy(): boolean {
	return load<boolean>(PRIVACY_ACK_KEY) === true;
}

export function acknowledgeCommunityPrivacy(): void {
	save(PRIVACY_ACK_KEY, true);
}

export interface AdoptedAuthor {
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
}

/** Page size for `listCommunityLicks`. */
export const COMMUNITY_PAGE_SIZE = 50;

export interface CommunityFilters {
	search?: string;
	category?: PhraseCategory;
	maxDifficulty?: number;
	authorSearch?: string;
	sort?: 'popular' | 'newest';
}

export interface CommunityLick {
	phrase: Phrase;
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
	favoriteCount: number;
	isFavoritedByMe: boolean;
	isAdoptedByMe: boolean;
}

// ---------------------------------------------------------------------------
// Local cache helpers
// ---------------------------------------------------------------------------

export function getFavoritesLocal(): Set<string> {
	const ids = load<string[]>(FAVORITES_KEY) ?? [];
	return new Set(ids);
}

export function getAdoptionsLocal(): Set<string> {
	const ids = load<string[]>(ADOPTIONS_KEY) ?? [];
	return new Set(ids);
}

export function getAdoptedLicksLocal(): Phrase[] {
	return load<Phrase[]>(ADOPTED_PAYLOADS_KEY) ?? [];
}

export function getAdoptedAuthorsLocal(): Record<string, AdoptedAuthor> {
	return load<Record<string, AdoptedAuthor>>(ADOPTED_AUTHORS_KEY) ?? {};
}

function saveFavoritesLocal(ids: Set<string>): void {
	save(FAVORITES_KEY, Array.from(ids));
}

function saveAdoptionsLocal(ids: Set<string>): void {
	save(ADOPTIONS_KEY, Array.from(ids));
}

function saveAdoptedPayloadsLocal(licks: Phrase[]): void {
	save(ADOPTED_PAYLOADS_KEY, licks);
}

function saveAdoptedAuthorsLocal(authors: Record<string, AdoptedAuthor>): void {
	save(ADOPTED_AUTHORS_KEY, authors);
}

// ---------------------------------------------------------------------------
// Row → Phrase mapping (shared with user-licks.ts)
// ---------------------------------------------------------------------------

type UserLickRow = Database['public']['Tables']['user_licks']['Row'];

function rowToPhrase(row: UserLickRow): Phrase {
	return {
		id: row.id,
		name: row.name,
		key: row.key as PitchClass,
		timeSignature: row.time_signature as [number, number],
		notes: row.notes as unknown as Note[],
		harmony: row.harmony as unknown as HarmonicSegment[],
		difficulty: row.difficulty as unknown as DifficultyMetadata,
		category: row.category as PhraseCategory,
		tags: row.tags ?? [],
		source: row.source
	};
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Query community licks with filters and pagination.
 *
 * Two round trips:
 *  1. Fetch `user_licks` filtered and sorted server-side.
 *  2. Fetch author display names for the distinct `user_id` values in the
 *     result set from `public_lick_authors`.
 *
 * Author-name filtering is applied client-side after the author fetch, which
 * means it's approximate w.r.t. pagination (results that match the author
 * filter may span pages). For low volumes this is acceptable; a v2 could
 * move the filter into an RPC.
 */
export async function listCommunityLicks(
	supabase: SupabaseClient<Database>,
	filters: CommunityFilters = {},
	offset = 0
): Promise<CommunityLick[]> {
	let query = supabase.from('user_licks').select('*');

	if (filters.category) {
		query = query.eq('category', filters.category);
	}

	if (filters.search) {
		const term = filters.search.trim();
		if (term) {
			// PostgREST ilike with % wildcards; also strip characters that
			// would break the PostgreSQL array literal in the tags.cs.{...}
			// clause ({}, ", \) and newlines. Search is UX-casual, not a
			// power-user query, so dropping these is fine.
			const safe = term.replace(/[%_,(){}"\\\n\r]/g, ' ').trim();
			if (safe) {
				query = query.or(`name.ilike.%${safe}%,tags.cs.{${safe}}`);
			}
		}
	}

	if (filters.maxDifficulty !== undefined) {
		// difficulty is JSONB. `->>` returns text, so a bare `lte` would
		// compare lexicographically ('5' > '10'); cast to int for numeric
		// comparison. Note: PostgREST filter columns accept this cast syntax.
		query = query.lte(
			"(difficulty->>'level')::int",
			filters.maxDifficulty
		);
	}

	const sort = filters.sort ?? 'popular';
	if (sort === 'popular') {
		query = query
			.order('favorite_count', { ascending: false })
			.order('created_at', { ascending: false });
	} else {
		query = query.order('created_at', { ascending: false });
	}

	query = query.range(offset, offset + COMMUNITY_PAGE_SIZE - 1);

	const { data: licks, error } = await query;
	if (error) {
		console.warn('Failed to list community licks:', error);
		return [];
	}

	if (!licks || licks.length === 0) return [];

	const userIds = Array.from(new Set(licks.map((l) => l.user_id)));
	const { data: authors, error: authorError } = await supabase
		.from('public_lick_authors')
		.select('id, display_name, avatar_url')
		.in('id', userIds);

	if (authorError) {
		console.warn('Failed to fetch lick authors:', authorError);
	}

	const authorById = new Map(
		(authors ?? []).map((a) => [a.id, a])
	);

	const favorites = getFavoritesLocal();
	const adoptions = getAdoptionsLocal();

	let results: CommunityLick[] = licks.map((row) => {
		const author = authorById.get(row.user_id);
		return {
			phrase: rowToPhrase(row),
			authorId: row.user_id,
			authorName: author?.display_name ?? null,
			authorAvatarUrl: author?.avatar_url ?? null,
			favoriteCount: row.favorite_count ?? 0,
			isFavoritedByMe: favorites.has(row.id),
			isAdoptedByMe: adoptions.has(row.id)
		};
	});

	// Author-search filter applied client-side after hydration.
	if (filters.authorSearch) {
		const q = filters.authorSearch.toLowerCase();
		results = results.filter((r) =>
			(r.authorName ?? '').toLowerCase().includes(q)
		);
	}

	return results;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/**
 * Toggle whether the current user has favorited a lick. Returns the new state.
 * Optimistically updates local cache; reverts if the server rejects.
 */
export async function toggleFavorite(
	supabase: SupabaseClient<Database>,
	lickId: string
): Promise<boolean> {
	const favorites = getFavoritesLocal();
	const wasFavorited = favorites.has(lickId);

	// Optimistic local toggle
	if (wasFavorited) favorites.delete(lickId);
	else favorites.add(lickId);
	saveFavoritesLocal(favorites);

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) {
		// Revert — no session, no write.
		if (wasFavorited) favorites.add(lickId);
		else favorites.delete(lickId);
		saveFavoritesLocal(favorites);
		return wasFavorited;
	}

	if (wasFavorited) {
		const { error } = await supabase
			.from('lick_favorites')
			.delete()
			.eq('user_id', user.id)
			.eq('lick_id', lickId);
		if (error) {
			console.warn('Failed to unfavorite:', error);
			favorites.add(lickId); // revert
			saveFavoritesLocal(favorites);
			return true;
		}
		return false;
	} else {
		const { error } = await supabase
			.from('lick_favorites')
			.insert({ user_id: user.id, lick_id: lickId });
		if (error) {
			console.warn('Failed to favorite:', error);
			favorites.delete(lickId); // revert
			saveFavoritesLocal(favorites);
			return false;
		}
		return true;
	}
}

// ---------------------------------------------------------------------------
// Adoptions
// ---------------------------------------------------------------------------

/**
 * Adopt a lick. Inserts an adoption row and caches the lick's payload locally
 * so it renders in the library offline.
 *
 * @returns `true` if the adoption is recorded on the server (or was already),
 *          `false` if the server write failed or no auth session is available.
 *          Callers performing optimistic UI updates must revert on `false`.
 */
export async function adoptLick(
	supabase: SupabaseClient<Database>,
	lickId: string
): Promise<boolean> {
	const adoptions = getAdoptionsLocal();
	if (adoptions.has(lickId)) return true;

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) {
		console.warn('Cannot adopt lick without auth session');
		return false;
	}

	const { error: insertError } = await supabase
		.from('lick_adoptions')
		.insert({ user_id: user.id, lick_id: lickId });
	if (insertError) {
		console.warn('Failed to adopt lick:', insertError);
		return false;
	}

	// Fetch the lick payload so the library has it cached locally.
	const { data: lickRow, error: lickError } = await supabase
		.from('user_licks')
		.select('*')
		.eq('id', lickId)
		.single();

	if (lickError || !lickRow) {
		console.warn('Adopted lick but failed to fetch payload:', lickError);
		// The adoption row is in place; next startup hydration will pick it up.
	} else {
		const payloads = getAdoptedLicksLocal();
		if (!payloads.some((p) => p.id === lickId)) {
			payloads.push(rowToPhrase(lickRow));
			saveAdoptedPayloadsLocal(payloads);
		}

		// Cache author attribution for the library's "by <author>" badge.
		const { data: author } = await supabase
			.from('public_lick_authors')
			.select('id, display_name, avatar_url')
			.eq('id', lickRow.user_id)
			.single();

		const authors = getAdoptedAuthorsLocal();
		authors[lickId] = {
			authorId: lickRow.user_id,
			authorName: author?.display_name ?? null,
			authorAvatarUrl: author?.avatar_url ?? null
		};
		saveAdoptedAuthorsLocal(authors);
	}

	adoptions.add(lickId);
	saveAdoptionsLocal(adoptions);
	return true;
}

/**
 * Unadopt a lick. Removes the adoption row and the locally cached payload.
 *
 * @returns `true` if the adoption is gone from the server (or wasn't there),
 *          `false` if the server delete failed or no auth session is available.
 *          Callers performing optimistic UI updates must revert on `false`.
 */
export async function unadoptLick(
	supabase: SupabaseClient<Database>,
	lickId: string
): Promise<boolean> {
	const adoptions = getAdoptionsLocal();
	if (!adoptions.has(lickId)) return true;

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return false;

	const { error } = await supabase
		.from('lick_adoptions')
		.delete()
		.eq('user_id', user.id)
		.eq('lick_id', lickId);
	if (error) {
		console.warn('Failed to unadopt lick:', error);
		return false;
	}

	adoptions.delete(lickId);
	saveAdoptionsLocal(adoptions);

	const payloads = getAdoptedLicksLocal().filter((p) => p.id !== lickId);
	saveAdoptedPayloadsLocal(payloads);

	const authors = getAdoptedAuthorsLocal();
	delete authors[lickId];
	saveAdoptedAuthorsLocal(authors);
	return true;
}

// ---------------------------------------------------------------------------
// Startup hydration
// ---------------------------------------------------------------------------

/**
 * Bidirectional startup sync for community state:
 *   1. Pull favorite IDs → localStorage.
 *   2. Pull adoption IDs → localStorage.
 *   3. For each adopted lick, pull the latest lick payload → localStorage.
 *
 * Called once from `+layout.ts` during hydration. Never throws.
 */
export async function initCommunityFromCloud(
	supabase: SupabaseClient<Database>
): Promise<void> {
	const gen = getScopeGeneration();
	try {
		const { data: { user } } = await supabase.auth.getUser();
		if (!user) return;
		if (gen !== getScopeGeneration()) return;

		// Favorites
		const { data: favoriteRows, error: favError } = await supabase
			.from('lick_favorites')
			.select('lick_id')
			.eq('user_id', user.id);
		if (favError) {
			console.warn('Failed to fetch favorites:', favError);
		} else if (favoriteRows && gen === getScopeGeneration()) {
			const ids = new Set(favoriteRows.map((r) => r.lick_id));
			saveFavoritesLocal(ids);
		}

		// Adoptions + their lick payloads
		const { data: adoptionRows, error: adoptError } = await supabase
			.from('lick_adoptions')
			.select('lick_id')
			.eq('user_id', user.id);
		if (adoptError) {
			console.warn('Failed to fetch adoptions:', adoptError);
			return;
		}
		if (!adoptionRows || gen !== getScopeGeneration()) return;

		const adoptedIds = adoptionRows.map((r) => r.lick_id);
		saveAdoptionsLocal(new Set(adoptedIds));

		if (adoptedIds.length === 0) {
			saveAdoptedPayloadsLocal([]);
			saveAdoptedAuthorsLocal({});
			return;
		}

		const { data: lickRows, error: lickError } = await supabase
			.from('user_licks')
			.select('*')
			.in('id', adoptedIds);
		if (lickError) {
			console.warn('Failed to fetch adopted lick payloads:', lickError);
			return;
		}
		if (gen !== getScopeGeneration()) return;

		const payloads: Phrase[] = (lickRows ?? []).map(rowToPhrase);
		saveAdoptedPayloadsLocal(payloads);

		// Hydrate author attribution for each adopted lick.
		const authorIds = Array.from(new Set((lickRows ?? []).map((r) => r.user_id)));
		if (authorIds.length > 0) {
			const { data: authorRows, error: authorError } = await supabase
				.from('public_lick_authors')
				.select('id, display_name, avatar_url')
				.in('id', authorIds);
			if (authorError) {
				console.warn('Failed to fetch adopted-lick authors:', authorError);
			} else if (gen === getScopeGeneration()) {
				const byAuthorId = new Map(
					(authorRows ?? []).map((a) => [a.id, a])
				);
				const authorMap: Record<string, AdoptedAuthor> = {};
				for (const row of lickRows ?? []) {
					const a = byAuthorId.get(row.user_id);
					authorMap[row.id] = {
						authorId: row.user_id,
						authorName: a?.display_name ?? null,
						authorAvatarUrl: a?.avatar_url ?? null
					};
				}
				saveAdoptedAuthorsLocal(authorMap);
			}
		}
	} catch (err) {
		console.warn('Failed to hydrate community state from cloud:', err);
	}
}
