import { describe, it, expect } from 'vitest';
import {
	isStaleChunkErrorMessage,
	isRecoverableNavErrorMessage,
	staleChunkKey,
	shouldDropStaleChunkReport,
	navRecoveryAction,
	resolveNavRecovery,
	shouldAttemptNavRecovery,
	clearNavRecoveryLatch,
	shouldHardReloadOnNavigation,
	STALE_CHUNK_RELOAD_KEY,
	type KeyValueStore
} from '$lib/util/stale-chunk';

/** In-memory stand-in for sessionStorage. */
function makeStore(initial: Record<string, string> = {}): KeyValueStore & {
	data: Record<string, string>;
} {
	const data: Record<string, string> = { ...initial };
	return {
		data,
		getItem: (k) => (k in data ? data[k] : null),
		setItem: (k, v) => {
			data[k] = v;
		},
		removeItem: (k) => {
			delete data[k];
		}
	};
}

const URL_A =
	'error loading dynamically imported module: https://mankunkujazz.com/_app/immutable/nodes/16.6HsInCNV.js';
const URL_B =
	'error loading dynamically imported module: https://mankunkujazz.com/_app/immutable/nodes/11.CfIrvmt8.js';
const FETCH_VARIANT =
	'Failed to fetch dynamically imported module: https://mankunkujazz.com/_app/immutable/chunks/abc123.js';

describe('isStaleChunkErrorMessage', () => {
	it('matches both SvelteKit stale-chunk phrasings', () => {
		expect(isStaleChunkErrorMessage(URL_A)).toBe(true);
		expect(isStaleChunkErrorMessage(FETCH_VARIANT)).toBe(true);
	});

	it("matches WebKit's stale-import phrasing (Safari/iOS)", () => {
		expect(isStaleChunkErrorMessage('Importing a module script failed.')).toBe(true);
		expect(
			isRecoverableNavErrorMessage('TypeError: Importing a module script failed.')
		).toBe(true);
	});

	it('ignores unrelated errors', () => {
		expect(isStaleChunkErrorMessage('TypeError: x is not a function')).toBe(false);
		expect(isStaleChunkErrorMessage('')).toBe(false);
	});
});

describe('staleChunkKey', () => {
	it('keys off the failing module URL so distinct chunks get distinct keys', () => {
		expect(staleChunkKey(URL_A)).toBe(
			'https://mankunkujazz.com/_app/immutable/nodes/16.6HsInCNV.js'
		);
		expect(staleChunkKey(URL_A)).not.toBe(staleChunkKey(URL_B));
	});

	it('falls back to the trimmed message when no URL is present', () => {
		expect(staleChunkKey('  error loading dynamically imported module  ')).toBe(
			'error loading dynamically imported module'
		);
	});
});

describe('isRecoverableNavErrorMessage (nav-scope superset)', () => {
	it('matches both stale-chunk phrasings', () => {
		expect(isRecoverableNavErrorMessage(URL_A)).toBe(true);
		expect(isRecoverableNavErrorMessage(FETCH_VARIANT)).toBe(true);
	});

	it('matches the Firefox nav fetch failure (Sentry MANKUNKU-10)', () => {
		expect(
			isRecoverableNavErrorMessage('NetworkError when attempting to fetch resource.')
		).toBe(true);
	});

	it('matches bare WebKit/Chromium fetch failures, anchored to the whole message', () => {
		expect(isRecoverableNavErrorMessage('Load failed')).toBe(true);
		expect(isRecoverableNavErrorMessage('Failed to fetch')).toBe(true);
		expect(isRecoverableNavErrorMessage('TypeError: Failed to fetch')).toBe(true);
		// Anchoring: app-level messages that merely CONTAIN the phrase stay out.
		expect(isRecoverableNavErrorMessage('Failed to fetch the user profile')).toBe(false);
		expect(isRecoverableNavErrorMessage('Sample Load failed for tenor-sax')).toBe(false);
	});

	it('ignores unrelated errors', () => {
		expect(isRecoverableNavErrorMessage('TypeError: x is not a function')).toBe(false);
		expect(isRecoverableNavErrorMessage('')).toBe(false);
	});
});

describe('navRecoveryAction (dispatch order: beforeSend then handler)', () => {
	const TARGET = 'https://mankunkujazz.com/progress';

	it('first occurrence of a chunk: drop the report, then NAVIGATE TO THE TARGET (not reload)', () => {
		const store = makeStore();
		// beforeSend runs first
		expect(shouldDropStaleChunkReport(URL_A, store)).toBe(true);
		// handler runs next — the user clicked TOWARD somewhere; recovery must land there
		expect(navRecoveryAction(URL_A, store, TARGET)).toEqual({
			kind: 'navigate',
			href: TARGET
		});
		// the attempt is recorded against this chunk's URL
		expect(store.data['stale-chunk-reload-url']).toBe(staleChunkKey(URL_A));
	});

	it('falls back to a reload when no navigation target is known', () => {
		const store = makeStore();
		expect(navRecoveryAction(URL_A, store, null)).toEqual({ kind: 'reload' });
		expect(store.data['stale-chunk-reload-url']).toBe(staleChunkKey(URL_A));
	});

	it('immediate second failure of the SAME chunk: report it, do not loop', () => {
		const store = makeStore();
		// first dispatch: drop + navigate
		shouldDropStaleChunkReport(URL_A, store);
		navRecoveryAction(URL_A, store, TARGET);
		// recovery did not help — same chunk fails again
		expect(shouldDropStaleChunkReport(URL_A, store)).toBe(false); // report (actionable)
		expect(navRecoveryAction(URL_A, store, TARGET)).toEqual({ kind: 'none' }); // no loop
		// the record is cleared so a later distinct episode starts fresh
		expect(store.data['stale-chunk-reload-url']).toBeUndefined();
	});

	it('REGRESSION: a DIFFERENT chunk after an earlier recovered one still gets dropped + recovered', () => {
		// Reproduces the per-session-latch bug: the first chunk recovered, so the
		// store still holds URL_A. Under the old boolean latch a later distinct
		// chunk (URL_B) was reported to Sentry AND never auto-recovered.
		const store = makeStore({ 'stale-chunk-reload-url': staleChunkKey(URL_A) });
		expect(shouldDropStaleChunkReport(URL_B, store)).toBe(true); // NOT reported
		expect(navRecoveryAction(URL_B, store, TARGET)).toEqual({
			kind: 'navigate',
			href: TARGET
		}); // recovery IS attempted
		expect(store.data['stale-chunk-reload-url']).toBe(staleChunkKey(URL_B));
	});

	it('recovers nav fetch failures (no URL in message) keyed by the message text', () => {
		const store = makeStore();
		const msg = 'NetworkError when attempting to fetch resource.';
		expect(navRecoveryAction(msg, store, TARGET)).toEqual({
			kind: 'navigate',
			href: TARGET
		});
		expect(store.data['stale-chunk-reload-url']).toBe(msg);
		// ...but beforeSend still REPORTS these (only stale-chunk firsts are dropped,
		// so the deploy-window NetworkError class stays visible in Sentry).
		expect(shouldDropStaleChunkReport(msg, makeStore())).toBe(false);
	});

	it('non-recoverable errors are neither dropped nor acted on', () => {
		const store = makeStore();
		const msg = 'TypeError: cannot read properties of undefined';
		expect(shouldDropStaleChunkReport(msg, store)).toBe(false);
		expect(navRecoveryAction(msg, store, TARGET)).toEqual({ kind: 'none' });
		expect(store.data['stale-chunk-reload-url']).toBeUndefined();
	});

	it('clearNavRecoveryLatch resets the latch so the next episode recovers again', () => {
		const store = makeStore();
		navRecoveryAction('NetworkError when attempting to fetch resource.', store, TARGET);
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBeDefined();
		// A later successful client-side navigation proves the tab is healthy —
		// the latch must reset so the NEXT deploy-window episode (same message
		// key, days later) recovers instead of dead-ending on the error page.
		clearNavRecoveryLatch(store);
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBeUndefined();
		expect(
			navRecoveryAction('NetworkError when attempting to fetch resource.', store, TARGET)
		).toEqual({ kind: 'navigate', href: TARGET });
	});
});

describe('resolveNavRecovery (probe-gated recovery)', () => {
	const TARGET = 'https://mankunkujazz.com/progress';
	const CURRENT = 'https://mankunkujazz.com/settings';

	it('returns the recovery action and keeps the latch when the server is reachable', async () => {
		const store = makeStore();
		const action = await resolveNavRecovery(URL_A, store, TARGET, CURRENT, async () => true);
		expect(action).toEqual({ kind: 'navigate', href: TARGET });
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBe(staleChunkKey(URL_A));
	});

	it('probes the CURRENT page for reload recoveries (no nav target known)', async () => {
		const store = makeStore();
		const probed: string[] = [];
		const action = await resolveNavRecovery(URL_A, store, null, CURRENT, async (href) => {
			probed.push(href);
			return true;
		});
		expect(action).toEqual({ kind: 'reload' });
		expect(probed).toEqual([CURRENT]);
	});

	it('REGRESSION: rolls the latch back when the probe aborts the recovery', async () => {
		// navRecoveryAction latches the attempt key as a side effect BEFORE the
		// reachability probe runs. If the probe then aborts the recovery, keeping
		// the latch would (a) swallow the next occurrence of the same key without
		// ever having recovered, and (b) make beforeSend report it as "recovery
		// didn't help" when no recovery ever ran.
		const store = makeStore();
		const aborted = await resolveNavRecovery(URL_A, store, TARGET, CURRENT, async () => false);
		expect(aborted).toEqual({ kind: 'none' });
		// nothing was recovered, so the attempt must not stay latched…
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBeUndefined();
		// …the same episode still gets its one recovery once the server is back…
		const retry = await resolveNavRecovery(URL_A, store, TARGET, CURRENT, async () => true);
		expect(retry).toEqual({ kind: 'navigate', href: TARGET });
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBe(staleChunkKey(URL_A));
	});

	it('after an aborted recovery, beforeSend still drops the next occurrence', async () => {
		const store = makeStore();
		await resolveNavRecovery(URL_A, store, TARGET, CURRENT, async () => false);
		// The next occurrence is a FIRST real attempt, not "recovery didn't help".
		expect(shouldDropStaleChunkReport(URL_A, store)).toBe(true);
	});

	it('never probes for non-recoverable errors', async () => {
		const store = makeStore();
		const probed: string[] = [];
		const action = await resolveNavRecovery(
			'TypeError: x is not a function',
			store,
			TARGET,
			CURRENT,
			async (href) => {
				probed.push(href);
				return true;
			}
		);
		expect(action).toEqual({ kind: 'none' });
		expect(probed).toEqual([]);
		expect(store.data[STALE_CHUNK_RELOAD_KEY]).toBeUndefined();
	});
});

describe('shouldAttemptNavRecovery (gate: real navigations only, never preloads)', () => {
	const TARGET = 'https://mankunkujazz.com/progress';
	const CURRENT = 'https://mankunkujazz.com/settings';

	it('proceeds toward the target when the failed URL matches the in-flight navigation', () => {
		expect(shouldAttemptNavRecovery(TARGET, TARGET, CURRENT)).toEqual({
			proceed: true,
			targetHref: TARGET
		});
	});

	it('does NOT act on hover/touch preload failures (no navigation in flight)', () => {
		// data-sveltekit-preload-data="hover": kit runs loads for a hovered link
		// and routes their failures through handleError with event.url = the
		// PRELOAD target. Recovering would force-navigate to a page the user
		// never clicked.
		expect(shouldAttemptNavRecovery(null, TARGET, CURRENT)).toEqual({ proceed: false });
	});

	it('does NOT act when a preload fails while a different navigation is in flight', () => {
		expect(
			shouldAttemptNavRecovery('https://mankunkujazz.com/docs', TARGET, CURRENT)
		).toEqual({ proceed: false });
	});

	it('falls back to reloading the current page for initial-load failures', () => {
		// No navigation in flight and the failing event URL IS the current page:
		// the initial load/hydration itself died (e.g. deploy raced the page
		// load). A reload fetches a fresh shell — the pre-existing behavior.
		expect(shouldAttemptNavRecovery(null, CURRENT, CURRENT)).toEqual({
			proceed: true,
			targetHref: null
		});
	});

	it('does nothing when the event URL is unknown', () => {
		expect(shouldAttemptNavRecovery(null, null, CURRENT)).toEqual({ proceed: false });
	});
});

describe('shouldHardReloadOnNavigation (proactive version guard)', () => {
	const to = { url: new URL('https://mankunkujazz.com/ear-training') };

	it('hard-reloads when a new deploy is live and the nav has a client target', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: false, type: 'link' }, true)).toBe(
			true
		);
		expect(shouldHardReloadOnNavigation({ to, willUnload: false, type: 'goto' }, true)).toBe(
			true
		);
	});

	it('does nothing when no new version is available', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: false, type: 'link' }, false)).toBe(
			false
		);
	});

	it('skips full-page unloads (the browser already does a fresh load)', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: true, type: 'leave' }, true)).toBe(
			false
		);
	});

	it('skips navigations with no resolvable target', () => {
		expect(
			shouldHardReloadOnNavigation({ to: null, willUnload: false, type: 'link' }, true)
		).toBe(false);
	});

	it('skips back/forward (popstate) navigations — cancel() queues a history.go() that races the document load', () => {
		expect(
			shouldHardReloadOnNavigation({ to, willUnload: false, type: 'popstate' }, true)
		).toBe(false);
	});
});
