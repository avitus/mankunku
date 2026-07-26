import { describe, it, expect } from 'vitest';
import {
	isStaleChunkErrorMessage,
	isRecoverableNavErrorMessage,
	staleChunkKey,
	shouldDropStaleChunkReport,
	navRecoveryAction,
	shouldHardReloadOnNavigation,
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
});

describe('shouldHardReloadOnNavigation (proactive version guard)', () => {
	const to = { url: new URL('https://mankunkujazz.com/ear-training') };

	it('hard-reloads when a new deploy is live and the nav has a client target', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: false }, true)).toBe(true);
	});

	it('does nothing when no new version is available', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: false }, false)).toBe(false);
	});

	it('skips full-page unloads (the browser already does a fresh load)', () => {
		expect(shouldHardReloadOnNavigation({ to, willUnload: true }, true)).toBe(false);
	});

	it('skips navigations with no resolvable target', () => {
		expect(shouldHardReloadOnNavigation({ to: null, willUnload: false }, true)).toBe(false);
	});
});
