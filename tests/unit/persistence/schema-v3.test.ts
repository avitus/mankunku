/**
 * Schema v3: the lead-sheet → tune storage-key rename.
 *
 * v3 renames the persisted lead-sheet localStorage keys to their tune names
 * in EVERY bucket (bare anon + each `u:<uid>:`), and rewrites the outbox
 * blob's `leadSheets` intent to `tunes`. The upgrade must be versioned: a
 * device already at schema 2 must NOT re-run the v2 body — v2 ends by
 * stamping `__active`, and with the v2 legacy marker long gone it would
 * stamp `'anon'` over a signed-in device's pointer (the regression this
 * suite pins).
 */

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
	runNamespaceUpgradeIfNeeded,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
});

const RENAMES: Array<[string, string]> = [
	['user-leadsheets', 'user-tunes'],
	['user-leadsheets-owners', 'user-tunes-owners'],
	['user-leadsheets-meta', 'user-tunes-meta'],
	['leadsheet-favorites', 'tune-favorites'],
	['leadsheet-adoptions', 'tune-adoptions'],
	['leadsheet-adopted-payloads', 'tune-adopted-payloads'],
	['leadsheet-adopted-authors', 'tune-adopted-authors']
];

/** A realistic v2-era outbox blob with a pending lead-sheet sync intent. */
function v2OutboxBlob(): string {
	return JSON.stringify({
		leadSheets: { kind: 'leadSheets', uid: 'user-x', rev: 3, attempts: 2, nextAttemptAt: 12345 },
		userLicks: { kind: 'userLicks', uid: 'user-x', rev: 1, attempts: 0, nextAttemptAt: 0 }
	});
}

describe('schema v3 — lead-sheet key rename', () => {
	it('renames every lead-sheet key in both the authed and anon buckets, byte-identical', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:__active'] = JSON.stringify('user-x');
		for (const [oldKey] of RENAMES) {
			store[`mankunku:u:user-x:${oldKey}`] = JSON.stringify({ from: `authed-${oldKey}` });
			store[`mankunku:${oldKey}`] = JSON.stringify({ from: `anon-${oldKey}` });
		}

		runNamespaceUpgradeIfNeeded();

		for (const [oldKey, newKey] of RENAMES) {
			expect(store[`mankunku:u:user-x:${newKey}`]).toBe(
				JSON.stringify({ from: `authed-${oldKey}` })
			);
			expect(store[`mankunku:${newKey}`]).toBe(JSON.stringify({ from: `anon-${oldKey}` }));
			expect(store[`mankunku:u:user-x:${oldKey}`]).toBeUndefined();
			expect(store[`mankunku:${oldKey}`]).toBeUndefined();
		}
		expect(store['mankunku:__schema']).toBe('3');
	});

	it('does NOT re-run the v2 body on a schema-2 device — __active survives', () => {
		// A signed-in device at v2: no legacy __lastUserId marker exists anymore,
		// so a re-run of the v2 body would stamp __active back to 'anon'.
		store['mankunku:__schema'] = '2';
		store['mankunku:__active'] = JSON.stringify('user-x');
		store['mankunku:u:user-x:user-leadsheets'] = JSON.stringify([{ id: 's1' }]);

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:__active']).toBe(JSON.stringify('user-x'));
		expect(store['mankunku:__schema']).toBe('3');
		expect(store['mankunku:u:user-x:user-tunes']).toBe(JSON.stringify([{ id: 's1' }]));
	});

	it('renames keys in inactive users’ buckets too', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:__active'] = JSON.stringify('user-x');
		store['mankunku:u:user-other:leadsheet-favorites'] = JSON.stringify(['s9']);

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:u:user-other:tune-favorites']).toBe(JSON.stringify(['s9']));
		expect(store['mankunku:u:user-other:leadsheet-favorites']).toBeUndefined();
	});

	it('rewrites the outbox blob: leadSheets → tunes with fields preserved', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:__active'] = JSON.stringify('user-x');
		store['mankunku:u:user-x:outbox'] = v2OutboxBlob();

		runNamespaceUpgradeIfNeeded();

		const outbox = JSON.parse(store['mankunku:u:user-x:outbox']);
		expect(outbox.leadSheets).toBeUndefined();
		expect(outbox.tunes).toEqual({
			kind: 'tunes',
			uid: 'user-x',
			rev: 3,
			attempts: 2,
			nextAttemptAt: 12345
		});
		// Unrelated intents survive untouched.
		expect(outbox.userLicks).toEqual({
			kind: 'userLicks',
			uid: 'user-x',
			rev: 1,
			attempts: 0,
			nextAttemptAt: 0
		});
	});

	it('rewrites the anon bucket outbox too', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:outbox'] = JSON.stringify({
			leadSheets: { kind: 'leadSheets', uid: 'anon', rev: 1, attempts: 0, nextAttemptAt: 0 }
		});

		runNamespaceUpgradeIfNeeded();

		const outbox = JSON.parse(store['mankunku:outbox']);
		expect(outbox.leadSheets).toBeUndefined();
		expect(outbox.tunes.kind).toBe('tunes');
	});

	it('never clobbers an existing destination (copy-if-absent), but still removes the old key', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:user-tunes'] = JSON.stringify([{ id: 'already-migrated' }]);
		store['mankunku:user-leadsheets'] = JSON.stringify([{ id: 'stale' }]);

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:user-tunes']).toBe(JSON.stringify([{ id: 'already-migrated' }]));
		expect(store['mankunku:user-leadsheets']).toBeUndefined();
	});

	it('keeps an existing tunes outbox intent over a stale leadSheets one', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:outbox'] = JSON.stringify({
			tunes: { kind: 'tunes', uid: 'anon', rev: 7, attempts: 0, nextAttemptAt: 0 },
			leadSheets: { kind: 'leadSheets', uid: 'anon', rev: 2, attempts: 1, nextAttemptAt: 9 }
		});

		runNamespaceUpgradeIfNeeded();

		const outbox = JSON.parse(store['mankunku:outbox']);
		expect(outbox.leadSheets).toBeUndefined();
		expect(outbox.tunes.rev).toBe(7);
	});

	it('leaves a garbled outbox blob untouched and still completes the upgrade', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:outbox'] = 'not json{';
		store['mankunku:user-leadsheets'] = JSON.stringify([]);

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:outbox']).toBe('not json{');
		expect(store['mankunku:user-tunes']).toBe(JSON.stringify([]));
		expect(store['mankunku:__schema']).toBe('3');
	});

	it('is idempotent — a second run is a no-op', () => {
		store['mankunku:__schema'] = '2';
		store['mankunku:__active'] = JSON.stringify('user-x');
		store['mankunku:u:user-x:user-leadsheets'] = JSON.stringify([{ id: 's1' }]);

		runNamespaceUpgradeIfNeeded();
		const snapshot = { ...store };
		runNamespaceUpgradeIfNeeded();

		expect(store).toEqual(snapshot);
	});

	it('a fresh install (no schema key) lands directly at 3 with anon active', () => {
		runNamespaceUpgradeIfNeeded();
		expect(store['mankunku:__schema']).toBe('3');
		expect(store['mankunku:__active']).toBe(JSON.stringify('anon'));
	});

	it('a v1 device runs both steps: legacy keys move into the user bucket AND get renamed', () => {
		// Pre-namespace install with a lead-sheet key and the v1 last-user marker.
		store['mankunku:user-leadsheets'] = JSON.stringify([{ id: 'legacy' }]);
		store['mankunku:settings'] = JSON.stringify({ theme: 'dark' });
		store['mankunku:__lastUserId'] = JSON.stringify('user-x');

		runNamespaceUpgradeIfNeeded();

		expect(store['mankunku:u:user-x:user-tunes']).toBe(JSON.stringify([{ id: 'legacy' }]));
		expect(store['mankunku:u:user-x:settings']).toBe(JSON.stringify({ theme: 'dark' }));
		expect(store['mankunku:u:user-x:user-leadsheets']).toBeUndefined();
		expect(store['mankunku:user-leadsheets']).toBeUndefined();
		expect(store['mankunku:__schema']).toBe('3');
		expect(store['mankunku:__active']).toBe(JSON.stringify('user-x'));
	});
});
