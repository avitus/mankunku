/**
 * Active-user reconciliation + per-user storage namespacing.
 *
 * The old "wipe the previous user's data on account switch" model is gone (it
 * caused the 2026-07-13 data-loss incident). Storage is now per-user-namespaced
 * (`mankunku:u:<uid>:<key>`), so switching accounts re-homes to a different
 * bucket and reloads — it never destroys the prior user's data.
 *
 * These tests cover the new surface:
 *   - `reconcileActiveUser(serverUid, degraded)` — none / reload decisions and
 *     the scope-generation counter, including the degraded-null regression guard.
 *   - `namespace.ts` — active-uid resolution.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
	reconcileActiveUser,
	getScopeGeneration,
	getLastUserId,
	wipeUserData
} from '$lib/persistence/user-scope';
import {
	getActiveUid,
	getActiveUidOrNull,
	setActiveUid,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';

type MockStorage = Storage & { _store: Record<string, string> };

const ORIGINAL_LOCAL = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const ORIGINAL_SESSION = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

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

let local: MockStorage;
let session: MockStorage;
let reloadMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	local = createStorageMock();
	session = createStorageMock();
	Object.defineProperty(globalThis, 'localStorage', { value: local, writable: true, configurable: true });
	Object.defineProperty(globalThis, 'sessionStorage', { value: session, writable: true, configurable: true });
	// reconcileActiveUser calls location.reload() on a real switch; stub it.
	reloadMock = vi.fn();
	vi.stubGlobal('location', { reload: reloadMock });
	// Re-resolve the active namespace from scratch for each test.
	__resetNamespaceCacheForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(() => {
	if (ORIGINAL_LOCAL) Object.defineProperty(globalThis, 'localStorage', ORIGINAL_LOCAL);
	if (ORIGINAL_SESSION) Object.defineProperty(globalThis, 'sessionStorage', ORIGINAL_SESSION);
});

describe('reconcileActiveUser', () => {
	it('server user equals the active uid → no-op, no reload, generation unchanged', () => {
		setActiveUid('user-A');
		const genBefore = getScopeGeneration();

		const result = reconcileActiveUser('user-A', false);

		expect(result.action).toBe('none');
		expect(getScopeGeneration()).toBe(genBefore);
		expect(getActiveUid()).toBe('user-A');
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('a real switch (server uid differs) → reload, re-homes namespace, bumps generation', () => {
		setActiveUid('user-A');
		const genBefore = getScopeGeneration();

		const result = reconcileActiveUser('user-B', false);

		expect(result.action).toBe('reload');
		expect(getScopeGeneration()).toBe(genBefore + 1);
		// Namespace re-homed to the new user (no wipe of user-A's bucket).
		expect(getActiveUid()).toBe('user-B');
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it('degraded null user → NO change (the 2026-07-13 regression guard)', () => {
		// A transient auth outage yields a null user WITHOUT a genuine sign-out.
		// Treating that as a switch is exactly what destroyed local-first data;
		// reconcile must do nothing.
		setActiveUid('user-A');
		const genBefore = getScopeGeneration();

		const result = reconcileActiveUser(null, true);

		expect(result.action).toBe('none');
		expect(getScopeGeneration()).toBe(genBefore);
		expect(getActiveUid()).toBe('user-A');
		expect(reloadMock).not.toHaveBeenCalled();
	});

	it('genuine sign-out (null, not degraded) → re-homes to the anon bucket + reload', () => {
		setActiveUid('user-A');
		const genBefore = getScopeGeneration();

		const result = reconcileActiveUser(null, false);

		expect(result.action).toBe('reload');
		expect(getScopeGeneration()).toBe(genBefore + 1);
		// Re-homed to anon; user-A's own bucket is untouched (survives re-login).
		expect(getActiveUidOrNull()).toBeNull();
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});
});

describe('wipeUserData', () => {
	it('erases the active user bucket, invalidates in-flight writebacks, and re-homes to anon', async () => {
		setActiveUid('user-A');
		local.setItem('mankunku:u:user-A:progress', '{"a":1}');
		local.setItem('mankunku:u:user-B:progress', '{"b":1}');
		const genBefore = getScopeGeneration();

		await wipeUserData('user-A');

		// Generation bumps BEFORE the wipe so a straggling sync cannot re-persist
		// the deleted state (or copy it into the anon bucket).
		expect(getScopeGeneration()).toBe(genBefore + 1);
		expect(local.getItem('mankunku:u:user-A:progress')).toBeNull();
		expect(local.getItem('mankunku:u:user-B:progress')).toBe('{"b":1}');
		expect(getActiveUidOrNull()).toBeNull();
	});

	it('wiping an INACTIVE user leaves the realm homed where it was and does not bump the generation', async () => {
		setActiveUid('user-A');
		local.setItem('mankunku:u:user-A:progress', '{"a":1}');
		local.setItem('mankunku:u:user-B:progress', '{"b":1}');
		const genBefore = getScopeGeneration();

		await wipeUserData('user-B');

		expect(getScopeGeneration()).toBe(genBefore);
		expect(getActiveUid()).toBe('user-A');
		expect(local.getItem('mankunku:u:user-A:progress')).toBe('{"a":1}');
		expect(local.getItem('mankunku:u:user-B:progress')).toBeNull();
	});
});

describe('initCrossTabSync', () => {
	type Listener = (ev: unknown) => void;

	interface FakeChannel {
		listeners: Map<string, Set<Listener>>;
		addEventListener: (type: string, fn: Listener) => void;
		removeEventListener: (type: string, fn: Listener) => void;
		postMessage: (data: unknown) => void;
		emit: (type: string, ev: unknown) => void;
	}

	function makeFakeChannel(): FakeChannel {
		const listeners = new Map<string, Set<Listener>>();
		return {
			listeners,
			addEventListener: (type, fn) => {
				if (!listeners.has(type)) listeners.set(type, new Set());
				listeners.get(type)!.add(fn);
			},
			removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
			postMessage: () => {},
			emit: (type, ev) => {
				for (const fn of listeners.get(type) ?? []) fn(ev);
			}
		};
	}

	/** Fresh module instances so the memoised BroadcastChannel is per-test. */
	async function freshModules(channel: FakeChannel, windowListeners: Map<string, Listener>) {
		vi.stubGlobal('BroadcastChannel', function () {
			return channel;
		});
		vi.stubGlobal('window', {
			addEventListener: (type: string, fn: Listener) => windowListeners.set(type, fn),
			removeEventListener: (type: string) => windowListeners.delete(type)
		});
		vi.resetModules();
		const ns = await import('$lib/persistence/namespace');
		const us = await import('$lib/persistence/user-scope');
		return { ns, us };
	}

	it('reloads when another tab announces a DIFFERENT uid, and ignores an announcement of the current one', async () => {
		const channel = makeFakeChannel();
		const windowListeners = new Map<string, Listener>();
		const { ns, us } = await freshModules(channel, windowListeners);
		ns.setActiveUid('user-A');

		const teardown = us.initCrossTabSync();

		channel.emit('message', { data: { type: 'user-changed', uid: 'user-A' } });
		expect(reloadMock).not.toHaveBeenCalled();

		channel.emit('message', { data: { type: 'user-changed', uid: 'user-B' } });
		expect(reloadMock).toHaveBeenCalledTimes(1);

		teardown();
		expect(channel.listeners.get('message')?.size ?? 0).toBe(0);
		expect(windowListeners.has('storage')).toBe(false);
	});

	it('reloads on a storage event that moves the __active pointer to another uid', async () => {
		const channel = makeFakeChannel();
		const windowListeners = new Map<string, Listener>();
		const { ns, us } = await freshModules(channel, windowListeners);
		ns.setActiveUid('user-A');
		us.initCrossTabSync();

		const onStorage = windowListeners.get('storage')!;
		onStorage({ key: 'mankunku:u:user-A:progress', newValue: '{}' }); // ordinary data write
		onStorage({ key: 'mankunku:__active', newValue: JSON.stringify('user-A') }); // same uid
		expect(reloadMock).not.toHaveBeenCalled();

		onStorage({ key: 'mankunku:__active', newValue: JSON.stringify('user-B') });
		expect(reloadMock).toHaveBeenCalledTimes(1);
	});

	it('guards against a reload loop: the same target is reloaded once per tab-session', async () => {
		const channel = makeFakeChannel();
		const { ns, us } = await freshModules(channel, new Map());
		ns.setActiveUid('user-A');
		us.initCrossTabSync();

		channel.emit('message', { data: { type: 'user-changed', uid: 'user-B' } });
		channel.emit('message', { data: { type: 'user-changed', uid: 'user-B' } });
		expect(reloadMock).toHaveBeenCalledTimes(1);
		expect(session.getItem('mankunku:reload-target')).toBe('user-B');
	});
});

describe('getLastUserId', () => {
	it('reflects the active uid, and is null in the anonymous bucket', () => {
		setActiveUid('user-A');
		expect(getLastUserId()).toBe('user-A');

		setActiveUid(null); // → anon
		expect(getLastUserId()).toBeNull();
	});
});
