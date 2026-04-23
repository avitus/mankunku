/**
 * Client API for the Community Licks feature (browse, favorite, steal).
 *
 * Mirrors the local-first pattern used by `user-licks.ts`:
 *  - localStorage is authoritative for the UI's "is this favorited / stolen"
 *    state so rendering never waits on a round trip.
 *  - Writes go to Supabase fire-and-forget, with graceful logging on failure.
 *  - `initCommunityFromCloud` hydrates the three local caches (favorites,
 *    steals, stolen-lick payloads) from Supabase on app startup.
 *  - A generation guard (via `getScopeGeneration`) discards writebacks if a
 *    user switch happened mid-flight.
 *
 * Community listing (`listCommunityLicks`) is the exception — it's a live
 * query against Supabase rather than a local cache. The corpus can be large
 * and filtered many ways; caching it locally would be bigger than the rest
 * of the app's data combined.
 *
 * Note: the underlying DB table is still named `lick_adoptions` and the
 * localStorage keys still carry the `community-adopt*` prefix. The rename to
 * "steal" vocabulary is UI + code-identifier only; touching the table name
 * or local keys would force a migration/cache wipe for no user benefit. The
 * `validateAdoptedPhrase` import keeps its original name — that module is
 * outside the rename scope.
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
import { validateAdoptedPhrase } from '$lib/phrases/adopted-phrase-validator';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

/**
 * localStorage key holding the set of lick IDs the current user has favorited.
 * Stored as an array; converted to a Set on read.
 */
const FAVORITES_KEY = 'community-favorites';

/**
 * localStorage key holding the set of lick IDs the current user has stolen.
 * Stored as an array; converted to a Set on read.
 */
const STEALS_KEY = 'community-adoptions';

/**
 * localStorage key holding the Phrase payloads for stolen licks. Populated
 * from Supabase at startup; read synchronously by the library loader so the
 * `/library` page can show stolen licks offline.
 */
const STOLEN_PAYLOADS_KEY = 'community-adopted-payloads';

/**
 * localStorage key holding author attribution for each stolen lick id:
 *   Record<lickId, { authorId, authorName, authorAvatarUrl }>
 */
const STOLEN_AUTHORS_KEY = 'community-adopted-authors';

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

export interface StolenAuthor {
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
	/**
	 * Omit licks authored by this user from the results — used on the community
	 * browse page so you never see your own licks mixed with everyone else's.
	 * Your own licks already live under /library, and self-stealing is blocked
	 * at the DB anyway.
	 */
	excludeUserId?: string;
}

export interface CommunityLick {
	phrase: Phrase;
	authorId: string;
	authorName: string | null;
	authorAvatarUrl: string | null;
	favoriteCount: number;
	isFavoritedByMe: boolean;
	isStolenByMe: boolean;
}

// ---------------------------------------------------------------------------
// Local cache helpers
// ---------------------------------------------------------------------------

export function getFavoritesLocal(): Set<string> {
	const ids = load<string[]>(FAVORITES_KEY) ?? [];
	return new Set(ids);
}

export function getStealsLocal(): Set<string> {
	const ids = load<string[]>(STEALS_KEY) ?? [];
	return new Set(ids);
}

export function getStolenLicksLocal(): Phrase[] {
	return load<Phrase[]>(STOLEN_PAYLOADS_KEY) ?? [];
}

export function getStolenAuthorsLocal(): Record<string, StolenAuthor> {
	return load<Record<string, StolenAuthor>>(STOLEN_AUTHORS_KEY) ?? {};
}

function saveFavoritesLocal(ids: Set<string>): void {
	save(FAVORITES_KEY, Array.from(ids));
}

function saveStealsLocal(ids: Set<string>): void {
	save(STEALS_KEY, Array.from(ids));
}

function saveStolenPayloadsLocal(licks: Phrase[]): void {
	save(STOLEN_PAYLOADS_KEY, licks);
}

function saveStolenAuthorsLocal(authors: Record<string, StolenAuthor>): void {
	save(STOLEN_AUTHORS_KEY, authors);
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

	if (filters.excludeUserId) {
		query = query.neq('user_id', filters.excludeUserId);
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
	const steals = getStealsLocal();

	let results: CommunityLick[] = licks.map((row) => {
		const author = authorById.get(row.user_id);
		return {
			phrase: rowToPhrase(row),
			authorId: row.user_id,
			authorName: author?.display_name ?? null,
			authorAvatarUrl: author?.avatar_url ?? null,
			favoriteCount: row.favorite_count ?? 0,
			isFavoritedByMe: favorites.has(row.id),
			isStolenByMe: steals.has(row.id)
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
// Steals
// ---------------------------------------------------------------------------

/**
 * Steal a lick. Inserts an adoption row (underlying `lick_adoptions` table;
 * terminology only — "steal" is the user-facing verb) and caches the lick's
 * payload locally so it renders in the library offline.
 *
 * @returns `true` if the steal is recorded on the server (or was already),
 *          `false` if the server write failed or no auth session is available.
 *          Callers performing optimistic UI updates must revert on `false`.
 */
export async function stealLick(
	supabase: SupabaseClient<Database>,
	lickId: string
): Promise<boolean> {
	const steals = getStealsLocal();
	if (steals.has(lickId)) return true;

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) {
		console.warn('Cannot steal lick without auth session');
		return false;
	}

	const { error: insertError } = await supabase
		.from('lick_adoptions')
		.insert({ user_id: user.id, lick_id: lickId });
	if (insertError) {
		console.warn('Failed to steal lick:', insertError);
		return false;
	}

	// Fetch the lick payload so the library has it cached locally.
	const { data: lickRow, error: lickError } = await supabase
		.from('user_licks')
		.select('*')
		.eq('id', lickId)
		.single();

	if (lickError || !lickRow) {
		console.warn('Stole lick but failed to fetch payload:', lickError);
		// The steal row is in place; next startup hydration will pick it up.
	} else {
		const phrase = rowToPhrase(lickRow);
		const validation = validateAdoptedPhrase(phrase);
		if (!validation.valid) {
			// Server row is malformed — record the steal intent but keep the
			// local payload cache clean. The library UI will show "stolen" but
			// the lick won't appear in the practice pipeline until the author
			// fixes the source row.
			console.warn(
				`Stolen lick ${lickId} failed validation; skipping local cache:`,
				validation.errors
			);
		} else {
			const payloads = getStolenLicksLocal();
			if (!payloads.some((p) => p.id === lickId)) {
				payloads.push(phrase);
				saveStolenPayloadsLocal(payloads);
			}

			// Cache author attribution for the library's "by <author>" badge.
			const { data: author } = await supabase
				.from('public_lick_authors')
				.select('id, display_name, avatar_url')
				.eq('id', lickRow.user_id)
				.single();

			const authors = getStolenAuthorsLocal();
			authors[lickId] = {
				authorId: lickRow.user_id,
				authorName: author?.display_name ?? null,
				authorAvatarUrl: author?.avatar_url ?? null
			};
			saveStolenAuthorsLocal(authors);
		}
	}

	steals.add(lickId);
	saveStealsLocal(steals);
	return true;
}

/**
 * Return a stolen lick (undo the steal). Removes the adoption row and the
 * locally cached payload.
 *
 * @returns `true` if the steal is gone from the server (or wasn't there),
 *          `false` if the server delete failed or no auth session is available.
 *          Callers performing optimistic UI updates must revert on `false`.
 */
export async function returnLick(
	supabase: SupabaseClient<Database>,
	lickId: string
): Promise<boolean> {
	const steals = getStealsLocal();
	if (!steals.has(lickId)) return true;

	const { data: { user } } = await supabase.auth.getUser();
	if (!user) return false;

	const { error } = await supabase
		.from('lick_adoptions')
		.delete()
		.eq('user_id', user.id)
		.eq('lick_id', lickId);
	if (error) {
		console.warn('Failed to return lick:', error);
		return false;
	}

	steals.delete(lickId);
	saveStealsLocal(steals);

	const payloads = getStolenLicksLocal().filter((p) => p.id !== lickId);
	saveStolenPayloadsLocal(payloads);

	const authors = getStolenAuthorsLocal();
	delete authors[lickId];
	saveStolenAuthorsLocal(authors);
	return true;
}

// ---------------------------------------------------------------------------
// Startup hydration
// ---------------------------------------------------------------------------

/**
 * Bidirectional startup sync for community state:
 *   1. Pull favorite IDs → localStorage.
 *   2. Pull steal IDs → localStorage.
 *   3. For each stolen lick, pull the latest lick payload → localStorage.
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

		// Steals + their lick payloads
		const { data: stealRows, error: stealError } = await supabase
			.from('lick_adoptions')
			.select('lick_id')
			.eq('user_id', user.id);
		if (stealError) {
			console.warn('Failed to fetch steals:', stealError);
			return;
		}
		if (!stealRows || gen !== getScopeGeneration()) return;

		const stolenIds = stealRows.map((r) => r.lick_id);
		saveStealsLocal(new Set(stolenIds));

		if (stolenIds.length === 0) {
			saveStolenPayloadsLocal([]);
			saveStolenAuthorsLocal({});
			return;
		}

		const { data: lickRows, error: lickError } = await supabase
			.from('user_licks')
			.select('*')
			.in('id', stolenIds);
		if (lickError) {
			console.warn('Failed to fetch stolen lick payloads:', lickError);
			return;
		}
		if (gen !== getScopeGeneration()) return;

		// Filter out malformed payloads so the practice pipeline only sees
		// trustworthy data. Invalid steals remain in the steal set above
		// so the user can still return them; they just don't render.
		const payloads: Phrase[] = (lickRows ?? [])
			.map(rowToPhrase)
			.filter((phrase) => {
				const result = validateAdoptedPhrase(phrase);
				if (!result.valid) {
					console.warn(
						`Stolen lick ${phrase.id} failed validation; excluding from cache:`,
						result.errors
					);
				}
				return result.valid;
			});
		saveStolenPayloadsLocal(payloads);

		// Hydrate author attribution — restricted to validated licks so the
		// author map mirrors what actually landed in `payloads`. When no
		// validated payloads remain, explicitly clear the author cache so
		// stale entries from prior sessions don't linger.
		const validatedIds = new Set(payloads.map((p) => p.id));
		const validatedRows = (lickRows ?? []).filter((r) => validatedIds.has(r.id));
		const authorIds = Array.from(new Set(validatedRows.map((r) => r.user_id)));
		if (authorIds.length === 0) {
			if (gen === getScopeGeneration()) {
				saveStolenAuthorsLocal({});
			}
		} else {
			const { data: authorRows, error: authorError } = await supabase
				.from('public_lick_authors')
				.select('id, display_name, avatar_url')
				.in('id', authorIds);
			if (authorError) {
				console.warn('Failed to fetch stolen-lick authors:', authorError);
			} else if (gen === getScopeGeneration()) {
				const byAuthorId = new Map(
					(authorRows ?? []).map((a) => [a.id, a])
				);
				const authorMap: Record<string, StolenAuthor> = {};
				for (const row of validatedRows) {
					const a = byAuthorId.get(row.user_id);
					authorMap[row.id] = {
						authorId: row.user_id,
						authorName: a?.display_name ?? null,
						authorAvatarUrl: a?.avatar_url ?? null
					};
				}
				saveStolenAuthorsLocal(authorMap);
			}
		}
	} catch (err) {
		console.warn('Failed to hydrate community state from cloud:', err);
	}
}
