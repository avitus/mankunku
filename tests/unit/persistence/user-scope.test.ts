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
 *   - `namespace.ts` — active-uid resolution, the one-time legacy key upgrade,
 *     and per-user bucket clearing.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
	reconcileActiveUser,
	getScopeGeneration,
	getLastUserId
} from '$lib/persistence/user-scope';
import {
	getActiveUid,
	getActiveUidOrNull,
	setActiveUid,
	runNamespaceUpgradeIfNeeded,
	clearNamespace,
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

describe('getLastUserId', () => {
	it('reflects the active uid, and is null in the anonymous bucket', () => {
		setActiveUid('user-A');
		expect(getLastUserId()).toBe('user-A');

		setActiveUid(null); // → anon
		expect(getLastUserId()).toBeNull();
	});
});

describe('namespace — active uid resolution', () => {
	it('setActiveUid round-trips through getActiveUid / getActiveUidOrNull', () => {
		setActiveUid('user-X');
		expect(getActiveUid()).toBe('user-X');
		expect(getActiveUidOrNull()).toBe('user-X');

		setActiveUid(null);
		expect(getActiveUid()).toBe('anon');
		expect(getActiveUidOrNull()).toBeNull();
	});
});

describe('namespace — one-time legacy key upgrade', () => {
	it('moves a legacy mankunku:<key> into mankunku:u:<lastUserId>:<key>', () => {
		// Pre-namespace layout: an un-namespaced data key plus the legacy
		// __lastUserId marker that names the bucket to migrate into.
		local._store['mankunku:__lastUserId'] = JSON.stringify('user-A');
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);

		runNamespaceUpgradeIfNeeded();

		// Value re-homed into user-A's namespaced bucket, legacy key removed.
		expect(local._store['mankunku:u:user-A:user-licks']).toBe(JSON.stringify([{ id: 'lick-1' }]));
		expect(local._store['mankunku:user-licks']).toBeUndefined();
		// Upgrade stamps the schema marker and the active pointer, and clears the
		// legacy marker so it can never re-run against stale state.
		expect(local._store['mankunku:__schema']).toBe('3');
		expect(JSON.parse(local._store['mankunku:__active']!)).toBe('user-A');
		expect(local._store['mankunku:__lastUserId']).toBeUndefined();
	});
});

describe('namespace — clearNamespace', () => {
	it('erases only the target user’s bucket, leaving other users untouched', () => {
		local._store['mankunku:u:user-A:progress'] = JSON.stringify({ sessions: [] });
		local._store['mankunku:u:user-A:user-licks'] = JSON.stringify([{ id: 'a' }]);
		local._store['mankunku:u:user-B:progress'] = JSON.stringify({ sessions: [1] });

		clearNamespace('user-A');

		expect(local._store['mankunku:u:user-A:progress']).toBeUndefined();
		expect(local._store['mankunku:u:user-A:user-licks']).toBeUndefined();
		// User B's isolated bucket survives.
		expect(local._store['mankunku:u:user-B:progress']).toBeDefined();
	});
});
