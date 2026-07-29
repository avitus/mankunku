import { describe, it, expect, beforeEach, vi } from 'vitest';

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
