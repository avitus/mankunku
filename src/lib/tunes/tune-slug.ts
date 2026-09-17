import type { Tune } from '$lib/types/tune';
import { getAllTunes, isCuratedTuneId } from '$lib/tunes/book-loader';
import { foldAccents, slugify } from '$lib/util/slug';

/**
 * Readable tune URLs — `/tunes/autumn-leaves/practice` in place of
 * `/tunes/sheet-1789579191100-55iq/practice`.
 *
 * The slug is an ALIAS derived from the title at read time, never a stored
 * id: `Tune.id` is the cloud primary key, two foreign keys, the PDF bucket
 * path and the IndexedDB key, so it stays exactly as minted and every id URL
 * keeps resolving (bookmarks, the PDF flow's pre-assigned id, community
 * links). A renamed title simply moves the slug.
 *
 * Duplicate titles in one book are legal (nothing enforces uniqueness), so
 * the slug is disambiguated deterministically: curated tunes first, then
 * creation order (`sheet-<ms>-…` ids sort by time) — the earliest keeps the
 * bare slug, later ones get `-2`, `-3`… A title that leaves nothing
 * sluggable (all non-Latin), or that slugifies to a static `/tunes` route
 * (`RESERVED_TUNE_SEGMENTS`), falls back to the id.
 */

/**
 * The static child routes of `/tunes`. SvelteKit ranks a static segment above
 * `[id]`, so a title that slugifies to one of these ("Editor") would link to
 * that page from everywhere and never resolve — such a tune links by its id.
 * Pinned against the route directory by `tune-slug.test.ts`.
 */
export const RESERVED_TUNE_SEGMENTS: readonly string[] = [
	'add',
	'community',
	'editor',
	'import',
	'playhead-preview'
];

function baseSlug(tune: Tune): string {
	const slug = slugify(foldAccents(tune.title));
	return slug && !RESERVED_TUNE_SEGMENTS.includes(slug) ? slug : tune.id;
}

function rank(tune: Tune): number {
	return isCuratedTuneId(tune.id) || tune.source === 'curated' ? 0 : 1;
}

/** id → slug for every tune in the book, duplicates suffixed in a stable order. */
export function tuneSlugMap(book: readonly Tune[]): Map<string, string> {
	const byBase = new Map<string, Tune[]>();
	for (const tune of book) {
		const base = baseSlug(tune);
		const group = byBase.get(base);
		if (group) group.push(tune);
		else byBase.set(base, [tune]);
	}
	const out = new Map<string, string>();
	for (const [base, group] of byBase) {
		group.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		group.forEach((tune, i) => out.set(tune.id, i === 0 ? base : `${base}-${i + 1}`));
	}
	return out;
}

/**
 * The slug a tune is linked by. Pass the same `book` the resolver will see
 * (default: the whole visible book — curated + user + adopted). A tune
 * outside the book (a transposed copy carries a suffixed id) gets its bare
 * slug, so always hand this the BASE sheet.
 */
export function tuneSlug(tune: Tune, book: readonly Tune[] = getAllTunes()): string {
	return tuneSlugMap(book).get(tune.id) ?? baseSlug(tune);
}

/** A route ref is an id first (always wins, always resolves), else a slug. */
export function resolveTuneRef(ref: string, book: readonly Tune[] = getAllTunes()): Tune | undefined {
	if (!ref) return undefined;
	const byId = book.find((t) => t.id === ref);
	if (byId) return byId;
	const slugs = tuneSlugMap(book);
	return book.find((t) => slugs.get(t.id) === ref);
}

export function tunePath(tune: Tune, book?: readonly Tune[]): string {
	return `/tunes/${tuneSlug(tune, book)}`;
}

export function tunePracticePath(tune: Tune, book?: readonly Tune[]): string {
	return `${tunePath(tune, book)}/practice`;
}
