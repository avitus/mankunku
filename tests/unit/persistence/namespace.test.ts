import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock localStorage ────────────────────────────────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		store[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete store[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(store)) delete store[key];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

import {
	getActiveUid,
	getActiveUidOrNull,
	setActiveUid,
	runNamespaceUpgradeIfNeeded,
	clearNamespace,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';
import { save, load } from '$lib/persistence/storage';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
});

describe('namespace resolution', () => {
	it('defaults to the anon bucket when nothing is set', () => {
		expect(getActiveUid()).toBe('anon');
		expect(getActiveUidOrNull()).toBeNull();
	});

	it('resolves from the __active pointer', () => {
		save('__does-not-matter', 0); // ensure store initialised
		setActiveUid('user-a');
		__resetNamespaceCacheForTests();
		expect(getActiveUid()).toBe('user-a');
		expect(getActiveUidOrNull()).toBe('user-a');
	});

	it('namespaces writes per user', () => {
		setActiveUid('user-a');
		save('progress', { n: 1 });
		expect(store['mankunku:u:user-a:progress']).toBe(JSON.stringify({ n: 1 }));
	});

	it('isolates two users on the same browser (no leakage)', () => {
		setActiveUid('user-a');
		save('progress', { who: 'a' });
		setActiveUid('user-b');
		// user-b sees nothing of user-a's
		expect(load('progress')).toBeNull();
		save('progress', { who: 'b' });
		// switching back reveals user-a's data intact (never wiped)
		setActiveUid('user-a');
		expect(load('progress')).toEqual({ who: 'a' });
	});
});

describe('one-time namespace upgrade', () => {
	it('moves legacy keys into the last user bucket and stamps the schema', () => {
		// Simulate a pre-namespace install.
		store['mankunku:progress'] = JSON.stringify({ legacy: true });
		store['mankunku:settings'] = JSON.stringify({ theme: 'light' });
		store['mankunku:__lastUserId'] = JSON.stringify('user-x');

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:u:user-x:progress']).toBe(JSON.stringify({ legacy: true }));
		expect(store['mankunku:u:user-x:settings']).toBe(JSON.stringify({ theme: 'light' }));
		// legacy keys and the old marker are gone
		expect(store['mankunku:progress']).toBeUndefined();
		expect(store['mankunku:__lastUserId']).toBeUndefined();
		expect(store['mankunku:__schema']).toBe('3');
		expect(store['mankunku:__active']).toBe(JSON.stringify('user-x'));
	});

	it('leaves legacy keys at the bare (anon) path when no last-user marker exists', () => {
		store['mankunku:user-licks'] = JSON.stringify([{ id: 'x' }]);
		runNamespaceUpgradeIfNeeded();
		// Anon stays at the bare legacy path — no move, backward compatible.
		expect(store['mankunku:user-licks']).toBe(JSON.stringify([{ id: 'x' }]));
		expect(store['mankunku:__schema']).toBe('3');
	});

	it('is idempotent once the schema is stamped', () => {
		store['mankunku:progress'] = JSON.stringify({ v: 1 });
		store['mankunku:__lastUserId'] = JSON.stringify('user-x');
		runNamespaceUpgradeIfNeeded();
		// A stray legacy key written after the upgrade is NOT re-migrated.
		store['mankunku:progress'] = JSON.stringify({ v: 2 });
		runNamespaceUpgradeIfNeeded();
		expect(store['mankunku:progress']).toBe(JSON.stringify({ v: 2 }));
		expect(store['mankunku:u:user-x:progress']).toBe(JSON.stringify({ v: 1 }));
	});
});

describe('active-uid resolution from the Supabase auth cookie (the synchronous fast path)', () => {
	// Resolution order is cookie uid › __active pointer › anon. The cookie read
	// is what lets the module-eval $state singletons home to the right bucket
	// on the very first load after login without a self-correcting reload.
	const b64url = (s: string): string =>
		Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const jwt = (sub: string): string =>
		`${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub, aud: 'authenticated' }))}.${b64url('sig')}`;

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads `sub` out of the access-token JWT in a plain sb-<ref>-auth-token cookie', () => {
		setActiveUid('stale-pointer');
		__resetNamespaceCacheForTests();
		vi.stubGlobal('document', {
			cookie: `theme=dark; sb-abc123-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt('user-jwt'), refresh_token: 'r' }))}`
		});

		// The cookie wins over the __active pointer from the previous reconcile.
		expect(getActiveUid()).toBe('user-jwt');
	});

	it('reassembles a chunked base64- cookie (.0, .1 …) before extracting the JWT', () => {
		__resetNamespaceCacheForTests();
		const blob = 'base64-' + Buffer.from(JSON.stringify({ access_token: jwt('user-chunked'), refresh_token: 'r' })).toString('base64');
		const mid = Math.floor(blob.length / 2);
		// Chunks deliberately listed out of order — the parser sorts by index.
		vi.stubGlobal('document', {
			cookie: `sb-abc123-auth-token.1=${encodeURIComponent(blob.slice(mid))}; sb-abc123-auth-token.0=${encodeURIComponent(blob.slice(0, mid))}`
		});

		expect(getActiveUid()).toBe('user-chunked');
	});

	it('falls back to a plain session object carrying user.id when no JWT is present', () => {
		__resetNamespaceCacheForTests();
		vi.stubGlobal('document', {
			cookie: `sb-abc123-auth-token=${encodeURIComponent(JSON.stringify({ user: { id: 'user-plain' } }))}`
		});
		expect(getActiveUid()).toBe('user-plain');
	});

	it('ignores a garbled cookie and falls back to the __active pointer, then anon', () => {
		// A real device has already run the schema upgrade (storage.ts does it at
		// import) before any pointer exists; on an un-upgraded store the v2 step
		// would re-stamp __active from the legacy marker and mask the fallback.
		runNamespaceUpgradeIfNeeded();
		setActiveUid('user-pointer');
		__resetNamespaceCacheForTests();
		vi.stubGlobal('document', { cookie: 'sb-abc123-auth-token=%E0%A4%A; other=1' });
		expect(getActiveUid()).toBe('user-pointer');

		__resetNamespaceCacheForTests();
		vi.stubGlobal('document', { cookie: 'sb-abc123-auth-token=not-a-session' });
		delete store['mankunku:__active'];
		expect(getActiveUid()).toBe('anon');
	});

	it('never resolves from an unrelated cookie', () => {
		__resetNamespaceCacheForTests();
		vi.stubGlobal('document', {
			cookie: `other-auth-token=${encodeURIComponent(JSON.stringify({ access_token: jwt('not-ours') }))}`
		});
		expect(getActiveUid()).toBe('anon');
	});
});

describe('clearNamespace', () => {
	it('erases only the target user bucket', () => {
		setActiveUid('user-a');
		save('progress', { a: 1 });
		setActiveUid('user-b');
		save('progress', { b: 1 });

		clearNamespace('user-a');

		expect(store['mankunku:u:user-a:progress']).toBeUndefined();
		expect(store['mankunku:u:user-b:progress']).toBe(JSON.stringify({ b: 1 }));
		// control keys survive
		expect(store['mankunku:__active']).toBeDefined();
	});
});
