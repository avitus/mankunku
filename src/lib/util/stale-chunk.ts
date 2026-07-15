/**
 * Stale-chunk recovery logic (Sentry MANKUNKU-8).
 *
 * After a deploy, an open tab's cached HTML / precached app shell may reference
 * content-hashed chunk filenames the server no longer has. SvelteKit surfaces
 * the failed `import()` as "error loading dynamically imported module". This
 * module holds the pure decision logic shared by `hooks.client.ts`
 * (`beforeSend` report gating + `handleError` reload) and the proactive
 * `beforeNavigate` guard in the root layout, so the behaviour is unit-tested in
 * isolation from Sentry init and the DOM.
 *
 * The reload attempt is keyed by the FAILING CHUNK URL rather than a single
 * per-session boolean. A boolean latch stayed set for the tab's lifetime after
 * the first episode, so a second distinct stale chunk (e.g. the tab spanned two
 * deploys) was both reported to Sentry as "reload didn't help" AND never
 * auto-reloaded. Per-chunk keying gives each distinct episode its own single
 * reload attempt.
 */

/** Minimal subset of the Web Storage API — lets tests pass a fake store. */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** sessionStorage key holding the URL of the chunk we last tried to reload for. */
export const STALE_CHUNK_RELOAD_KEY = 'stale-chunk-reload-url';

const STALE_CHUNK_ERROR_PATTERN =
	/error loading dynamically imported module|Failed to fetch dynamically imported module/i;

/** True when the message is SvelteKit's stale dynamic-import failure. */
export function isStaleChunkErrorMessage(msg: string): boolean {
	return STALE_CHUNK_ERROR_PATTERN.test(msg);
}

/**
 * Stable per-episode key for a stale-chunk error: the failing module URL when
 * present, else the trimmed message. Distinct chunks yield distinct keys so
 * each gets its own one-shot reload.
 */
export function staleChunkKey(msg: string): string {
	const match = msg.match(/https?:\/\/\S+/);
	return match ? match[0] : msg.trim();
}

/**
 * `beforeSend` decision: should this stale-chunk error be DROPPED from Sentry?
 *
 * Drop the first occurrence for a given chunk — the reload that runs right
 * after is expected to fix it. Keep (report) it once a reload for THIS chunk was
 * already attempted and it still failed, because that is the actionable case.
 * Returns false for non-stale errors (they should be reported normally).
 */
export function shouldDropStaleChunkReport(msg: string, store: KeyValueStore): boolean {
	if (!isStaleChunkErrorMessage(msg)) return false;
	return store.getItem(STALE_CHUNK_RELOAD_KEY) !== staleChunkKey(msg);
}

/**
 * `handleError` decision: should the caller reload the page? Records the attempt
 * against the chunk URL. If a reload for THIS exact chunk was already attempted
 * and it is still failing, clears the record and returns false so we don't loop.
 */
export function shouldReloadForStaleChunk(msg: string, store: KeyValueStore): boolean {
	if (!isStaleChunkErrorMessage(msg)) return false;
	const key = staleChunkKey(msg);
	if (store.getItem(STALE_CHUNK_RELOAD_KEY) === key) {
		// Already reloaded once for this chunk and it's still missing — don't loop.
		store.removeItem(STALE_CHUNK_RELOAD_KEY);
		return false;
	}
	store.setItem(STALE_CHUNK_RELOAD_KEY, key);
	return true;
}

/**
 * Proactive `beforeNavigate` guard: when a new deployment is live
 * (`updatedCurrent`, driven by `kit.version.pollInterval`), do a full-page load
 * of the navigation target so a fresh HTML + manifest are fetched before any
 * lazy `import()` can 404. Skips full-page unloads (already a fresh load) and
 * navigations with no resolvable client target (e.g. external/hash).
 */
export function shouldHardReloadOnNavigation(
	nav: { to: { url: URL } | null; willUnload: boolean },
	updatedCurrent: boolean
): boolean {
	return updatedCurrent && !nav.willUnload && nav.to != null;
}
