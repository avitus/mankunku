/**
 * `reconcileBeforeHydration` (user-scope.ts) — the page-load reconcile that
 * hooks.client.ts `init` runs before SvelteKit imports any route node.
 *
 * Its contract with SvelteKit's `start()`, which awaits `init`:
 *  - when a reload is due, the switch is persisted AT ONCE, the reload itself
 *    waits for the document to settle (so it aborts nothing), and the returned
 *    promise stays pending — hydration never begins in the realm the reload is
 *    replacing (the old decision in +layout.ts reloaded mid-hydration and
 *    aborted node imports);
 *  - every other outcome lets boot proceed — including the loop guard
 *    declining the reload and a reconcile or reload that throws, where staying
 *    parked would hang the page forever.
 * The reconcile decisions themselves are `reconcileActiveUser`'s, unchanged;
 * these tests pin the verdict plumbing and the park/proceed split around them,
 * plus the `reloading` flag and injectable reload effect that split relies on.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { reconcileActiveUser, reconcileBeforeHydration } from '$lib/persistence/user-scope';
import {
	getActiveUid,
	setActiveUid,
	markAnonSessionActive,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';

type MockStorage = Storage & { _store: Record<string, string> };

const ORIGINAL_LOCAL = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const ORIGINAL_SESSION = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const RELOAD_GUARD = 'mankunku:reload-target';

function createStorageMock(): MockStorage {
	const store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			for (const k of Object.keys(store)) delete store[k];
		},
		get length() {
			return Object.keys(store).length;
		},
		key: (i: number) => Object.keys(store)[i] ?? null,
		_store: store
	};
}

/** True when `p` settles (either way) within a few macrotasks. */
async function settles(p: Promise<unknown>): Promise<boolean> {
	const pending = Symbol('pending');
	const winner = await Promise.race([
		p.then(
			() => 'settled',
			() => 'settled'
		),
		new Promise<symbol>((resolve) => setTimeout(() => resolve(pending), 20))
	]);
	return winner !== pending;
}

/** Let queued microtasks (the deferred reload chain) run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let local: MockStorage;
let session: MockStorage;
let reloadMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	local = createStorageMock();
	session = createStorageMock();
	Object.defineProperty(globalThis, 'localStorage', { value: local, writable: true, configurable: true });
	Object.defineProperty(globalThis, 'sessionStorage', { value: session, writable: true, configurable: true });
	reloadMock = vi.fn();
	vi.stubGlobal('location', { reload: reloadMock });
	// No real channel: the cross-tab broadcast is a no-op and leaves no handle.
	vi.stubGlobal('BroadcastChannel', undefined);
	__resetNamespaceCacheForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(() => {
	if (ORIGINAL_LOCAL) Object.defineProperty(globalThis, 'localStorage', ORIGINAL_LOCAL);
	if (ORIGINAL_SESSION) Object.defineProperty(globalThis, 'sessionStorage', ORIGINAL_SESSION);
});

describe('reconcileBeforeHydration — boot proceeds', () => {
	it('with no verdict on the page: touches nothing (the root layout reconciles instead)', () => {
		setActiveUid('user-A');
		const before = { ...local._store };
		const whenSettled = vi.fn(() => Promise.resolve());

		expect(reconcileBeforeHydration(null, whenSettled)).toBeUndefined();

		expect(local._store).toEqual(before);
		expect(whenSettled).not.toHaveBeenCalled();
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('when the verdict matches the active namespace, clearing a settled reload guard', () => {
		setActiveUid('user-A');
		session.setItem(RELOAD_GUARD, 'user-A'); // the reload that brought us here
		const whenSettled = vi.fn(() => Promise.resolve());

		expect(reconcileBeforeHydration({ uid: 'user-A', degraded: false }, whenSettled)).toBeUndefined();

		expect(getActiveUid()).toBe('user-A');
		expect(session.getItem(RELOAD_GUARD)).toBeNull();
		// A no-op boot doesn't even start waiting on the document.
		expect(whenSettled).not.toHaveBeenCalled();
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('on a degraded null verdict: nobody is moved (the 2026-07-13 guard)', async () => {
		setActiveUid('user-A');

		expect(reconcileBeforeHydration({ uid: null, degraded: true })).toBeUndefined();

		await flush();
		expect(getActiveUid()).toBe('user-A');
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('when the loop guard declines the reload: re-homed, not parked', async () => {
		// A reload for this very target already happened in this tab-session and
		// the realm STILL disagrees. Parking here would hang the page forever;
		// the namespace is re-homed before any state module has read storage, so
		// hydrating in this realm is correct.
		setActiveUid('user-A');
		session.setItem(RELOAD_GUARD, 'user-B');

		expect(reconcileBeforeHydration({ uid: 'user-B', degraded: false })).toBeUndefined();

		await flush();
		expect(reloadMock).not.toHaveBeenCalled();
		expect(getActiveUid()).toBe('user-B');
	});

	it('when the page cannot reload at all', () => {
		setActiveUid('user-A');
		vi.stubGlobal('location', undefined);

		expect(reconcileBeforeHydration({ uid: 'user-B', degraded: false })).toBeUndefined();
	});

	it('when the reconcile throws: boot never hangs on it', () => {
		setActiveUid('user-A');
		const whenSettled = (): Promise<void> => {
			throw new Error('settle probe blew up');
		};

		expect(reconcileBeforeHydration({ uid: 'user-B', degraded: false }, whenSettled)).toBeUndefined();
	});

	it('when the deferred reload itself fails: the park is released', async () => {
		// location.reload() can throw (e.g. a sandboxed frame's SecurityError).
		// Staying parked would leave the page un-hydrated forever.
		setActiveUid('user-A');
		vi.stubGlobal('location', {
			reload: () => {
				throw new DOMException('reload blocked', 'SecurityError');
			}
		});

		const parked = reconcileBeforeHydration({ uid: 'user-B', degraded: false });

		expect(parked).toBeInstanceOf(Promise);
		expect(await settles(parked!)).toBe(true);
		expect(getActiveUid()).toBe('user-B');
	});
});

describe('reconcileBeforeHydration — parked while the reload lands', () => {
	it('persists the switch at once, reloads only once the document settles, and never settles', async () => {
		setActiveUid('user-A');
		let settle: () => void = () => {};
		const whenSettled = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));

		const parked = reconcileBeforeHydration({ uid: 'user-B', degraded: false }, whenSettled);

		// The switch is durable before any waiting: pointer, guard.
		expect(parked).toBeInstanceOf(Promise);
		expect(getActiveUid()).toBe('user-B');
		expect(local.getItem('mankunku:__active')).toBe(JSON.stringify('user-B'));
		expect(session.getItem(RELOAD_GUARD)).toBe('user-B');

		// The reload waits for the document…
		await flush();
		expect(whenSettled).toHaveBeenCalledTimes(1);
		expect(reloadMock).not.toHaveBeenCalled();

		// …then fires exactly once, and boot stays parked.
		settle();
		await flush();
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(await settles(parked!)).toBe(false);
	});

	it('still reloads when the settle probe rejects', async () => {
		setActiveUid('user-A');

		const parked = reconcileBeforeHydration({ uid: 'user-B', degraded: false }, () =>
			Promise.reject(new Error('probe failed'))
		);

		await flush();
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(await settles(parked!)).toBe(false);
	});

	it('a genuine sign-out re-homes to the anon bucket without wiping the user’s', async () => {
		setActiveUid('user-A');
		local.setItem('mankunku:u:user-A:user-licks', '[{"id":"mine"}]');

		const parked = reconcileBeforeHydration({ uid: null, degraded: false });

		expect(await settles(parked!)).toBe(false);
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(getActiveUid()).toBe('anon');
		expect(local.getItem('mankunku:u:user-A:user-licks')).toBe('[{"id":"mine"}]');
	});

	it('a first login adopts this tab’s own anon data, then parks', async () => {
		setActiveUid(null); // anon
		markAnonSessionActive(); // this tab authored the anon bucket
		local.setItem('mankunku:user-licks', '[{"id":"offline"}]');

		const parked = reconcileBeforeHydration({ uid: 'user-A', degraded: false });

		expect(await settles(parked!)).toBe(false);
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(local.getItem('mankunku:u:user-A:user-licks')).toBe('[{"id":"offline"}]');
		expect(local.getItem('mankunku:user-licks')).toBeNull();
		expect(getActiveUid()).toBe('user-A');
	});
});

describe('reconcileActiveUser — reloading + the reload effect', () => {
	it('reports reloading only when the reload was issued, immediately by default', () => {
		setActiveUid('user-A');
		expect(reconcileActiveUser('user-A', false)).toEqual({ action: 'none', reloading: false });
		expect(reconcileActiveUser(null, true)).toEqual({ action: 'none', reloading: false });

		expect(reconcileActiveUser('user-B', false)).toEqual({ action: 'reload', reloading: true });
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it('hands the reload to an injected effect instead of calling location.reload()', () => {
		setActiveUid('user-A');
		const reload = vi.fn();

		expect(reconcileActiveUser('user-B', false, { reload })).toEqual({ action: 'reload', reloading: true });

		expect(reload).toHaveBeenCalledTimes(1);
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('reports a reload the loop guard declined as not reloading — action still reports the switch', () => {
		setActiveUid('user-A');
		session.setItem(RELOAD_GUARD, 'anon');
		const reload = vi.fn();

		expect(reconcileActiveUser(null, false, { reload })).toEqual({ action: 'reload', reloading: false });
		expect(reload).not.toHaveBeenCalled();
		expect(reloadMock).not.toHaveBeenCalled();
		expect(getActiveUid()).toBe('anon');
	});
});
