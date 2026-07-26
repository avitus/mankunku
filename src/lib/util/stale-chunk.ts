/**
 * Stale-chunk recovery logic (Sentry MANKUNKU-8).
 *
 * After a deploy, an open tab's cached HTML / precached app shell may reference
 * content-hashed chunk filenames the server no longer has. SvelteKit surfaces
 * the failed `import()` as "error loading dynamically imported module"; a nav
 * click that races the deploy's server-restart window instead surfaces a
 * generic fetch failure ("NetworkError when attempting to fetch resource.",
 * "Load failed", "Failed to fetch"). Either way the navigation dies and the
 * prior screen stays rendered. This module holds the pure decision logic
 * shared by `hooks.client.ts` (`beforeSend` report gating + `handleError`
 * recovery navigation) and the proactive `beforeNavigate` guard in the root
 * layout, so the behaviour is unit-tested in isolation from Sentry init and
 * the DOM.
 *
 * The recovery attempt is keyed by the FAILING CHUNK URL rather than a single
 * per-session boolean. A boolean latch stayed set for the tab's lifetime after
 * the first episode, so a second distinct stale chunk (e.g. the tab spanned two
 * deploys) was both reported to Sentry as "reload didn't help" AND never
 * auto-recovered. Per-chunk keying gives each distinct episode its own single
 * recovery attempt.
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

/**
 * Generic navigation-fetch failures (no module URL in the message). Seen when
 * a nav click races a deploy's PM2 restart window or a flaky network: Firefox
 * throws "NetworkError when attempting to fetch resource." (Sentry
 * MANKUNKU-10), WebKit a bare "Load failed", Chromium a bare "Failed to
 * fetch". The bare phrasings are anchored to the WHOLE message so app-level
 * errors that merely contain the phrase don't trigger navigation recovery.
 */
const NAV_FETCH_ERROR_PATTERN =
	/NetworkError when attempting to fetch resource|^(TypeError: )?(Load failed|Failed to fetch)\.?$/i;

/** True when the message is SvelteKit's stale dynamic-import failure. */
export function isStaleChunkErrorMessage(msg: string): boolean {
	return STALE_CHUNK_ERROR_PATTERN.test(msg);
}

/**
 * True for any error message that indicates a client-side NAVIGATION died on
 * a fetch — a stale chunk import or a generic network failure. Only
 * meaningful inside `handleError` (nav/load scope); do NOT use it to filter
 * arbitrary app errors, where the bare phrasings are too generic.
 */
export function isRecoverableNavErrorMessage(msg: string): boolean {
	return STALE_CHUNK_ERROR_PATTERN.test(msg) || NAV_FETCH_ERROR_PATTERN.test(msg.trim());
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
 * Drop the first occurrence for a given chunk — the recovery navigation that
 * runs right after is expected to fix it. Keep (report) it once a recovery for
 * THIS chunk was already attempted and it still failed, because that is the
 * actionable case. Returns false for non-stale errors (they should be reported
 * normally) — deliberately NARROWER than `isRecoverableNavErrorMessage`:
 * generic fetch failures (MANKUNKU-10's NetworkError class) get recovery but
 * stay visible in Sentry, since they signal deploy-window downtime.
 */
export function shouldDropStaleChunkReport(msg: string, store: KeyValueStore): boolean {
	if (!isStaleChunkErrorMessage(msg)) return false;
	return store.getItem(STALE_CHUNK_RELOAD_KEY) !== staleChunkKey(msg);
}

/** What `handleError` should do to recover a failed client-side navigation. */
export type NavRecovery =
	| { kind: 'navigate'; href: string }
	| { kind: 'reload' }
	| { kind: 'none' };

/**
 * `handleError` decision: how should the caller recover a navigation that
 * died on a fetch? A full-page load of the TARGET the user clicked toward is
 * the universal fix — a fresh HTML shell + manifest from the server land the
 * user where they intended (a bare `location.reload()` here would re-render
 * the PRIOR page, because SvelteKit commits the URL only after loads
 * resolve — the click would appear to do nothing; see Sentry MANKUNKU-8/-10).
 *
 * Records the attempt against the failing chunk URL (or the message when no
 * URL is present). If a recovery for THIS exact key was already attempted and
 * it is still failing, clears the record and returns 'none' so we don't loop.
 */
export function navRecoveryAction(
	msg: string,
	store: KeyValueStore,
	targetHref: string | null | undefined
): NavRecovery {
	if (!isRecoverableNavErrorMessage(msg)) return { kind: 'none' };
	const key = staleChunkKey(msg);
	if (store.getItem(STALE_CHUNK_RELOAD_KEY) === key) {
		// Already attempted recovery for this key and it's still failing — don't loop.
		store.removeItem(STALE_CHUNK_RELOAD_KEY);
		return { kind: 'none' };
	}
	store.setItem(STALE_CHUNK_RELOAD_KEY, key);
	return targetHref ? { kind: 'navigate', href: targetHref } : { kind: 'reload' };
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
