import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * F13 — anonymous → first-login adoption trust rule.
 *
 * Anonymous data lives at the BARE `mankunku:<key>` path (no `u:` prefix).
 * On first login it should follow the user into `mankunku:u:<uid>:<key>` — but
 * ONLY when THIS tab authored the anon bucket (per-tab sessionStorage trust
 * token). A different person's leftover anon data must never be adopted, and an
 * adoption must never overwrite the user's own already-present data, nor touch
 * control keys or other users' buckets.
 *
 * Exercises namespace.ts (markAnonSessionActive / hasAnonSessionTrust /
 * anonBucketNonEmpty / adoptAnonInto) and its wiring through
 * user-scope.ts reconcileActiveUser.
 */

const ROOT = 'mankunku:';
const TRUST_KEY = ROOT + '__anon-session';

// ─── Mock localStorage (bare + namespaced buckets live here) ──────────────
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

// ─── Mock sessionStorage (per-tab trust token + reload guard live here) ────
const sessionStore: Record<string, string> = {};
const sessionStorageMock = {
	getItem: vi.fn((key: string) => sessionStore[key] ?? null),
	setItem: vi.fn((key: string, value: string) => {
		sessionStore[key] = value;
	}),
	removeItem: vi.fn((key: string) => {
		delete sessionStore[key];
	}),
	clear: vi.fn(() => {
		for (const key of Object.keys(sessionStore)) delete sessionStore[key];
	}),
	get length() {
		return Object.keys(sessionStore).length;
	},
	key: vi.fn((i: number) => Object.keys(sessionStore)[i] ?? null)
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

// ─── Stub location.reload so reconcileActiveUser's scheduleReload is a no-op ─
const reloadMock = vi.fn();
Object.defineProperty(globalThis, 'location', { value: { reload: reloadMock }, writable: true });

// Neutralize BroadcastChannel so cross-tab broadcast is a no-op (and leaves no
// open handle) — user-scope's getChannel() bails when it's undefined.
Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, writable: true });

import {
	markAnonSessionActive,
	hasAnonSessionTrust,
	anonBucketNonEmpty,
	adoptAnonInto,
	setActiveUid,
	__resetNamespaceCacheForTests
} from '$lib/persistence/namespace';
import { reconcileActiveUser } from '$lib/persistence/user-scope';

beforeEach(() => {
	localStorageMock.clear();
	sessionStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
	// Baseline: this device is homed to the anon bucket (no cookie in node env,
	// so getActiveUid() would otherwise run the schema upgrade). Setting it here
	// makes getActiveUid() return 'anon' from cache — deterministic.
	setActiveUid(null);
});

describe('anon-session trust token (per-tab)', () => {
	it('is absent by default and present after markAnonSessionActive()', () => {
		expect(hasAnonSessionTrust()).toBe(false);
		markAnonSessionActive();
		expect(hasAnonSessionTrust()).toBe(true);
		// Stored under the reserved sessionStorage key, not localStorage.
		expect(sessionStore[TRUST_KEY]).toBe('1');
		expect(store[TRUST_KEY]).toBeUndefined();
	});

	it('anonBucketNonEmpty ignores control keys and other users buckets', () => {
		// Only control + foreign-user keys → still "empty".
		store[ROOT + '__active'] = '"anon"';
		store[ROOT + '__schema'] = '2';
		store[ROOT + 'u:someone:progress'] = '{"who":"someone"}';
		expect(anonBucketNonEmpty()).toBe(false);
		// A real bare key flips it to non-empty.
		store[ROOT + 'progress'] = '{"who":"anon"}';
		expect(anonBucketNonEmpty()).toBe(true);
	});
});

describe('reconcileActiveUser — trust gate on first login', () => {
	it('does NOT adopt anon data when the tab lacks the trust token', () => {
		// Anon data present, but this tab never called markAnonSessionActive().
		store[ROOT + 'progress'] = '{"who":"anon"}';
		store[ROOT + 'settings'] = '{"vol":5}';
		expect(hasAnonSessionTrust()).toBe(false);

		reconcileActiveUser('user-a', false);

		// Bare anon keys untouched — NOT copied into the user's bucket.
		expect(store[ROOT + 'progress']).toBe('{"who":"anon"}');
		expect(store[ROOT + 'settings']).toBe('{"vol":5}');
		expect(store[ROOT + 'u:user-a:progress']).toBeUndefined();
		expect(store[ROOT + 'u:user-a:settings']).toBeUndefined();
	});

	it('adopts anon data into the user bucket when the tab holds the trust token', () => {
		markAnonSessionActive();
		store[ROOT + 'progress'] = '{"who":"anon"}';
		store[ROOT + 'settings'] = '{"vol":5}';
		expect(hasAnonSessionTrust()).toBe(true);
		expect(anonBucketNonEmpty()).toBe(true);

		const result = reconcileActiveUser('user-a', false);

		// Copied into the user's namespaced bucket…
		expect(store[ROOT + 'u:user-a:progress']).toBe('{"who":"anon"}');
		expect(store[ROOT + 'u:user-a:settings']).toBe('{"vol":5}');
		// …bare anon keys cleared…
		expect(store[ROOT + 'progress']).toBeUndefined();
		expect(store[ROOT + 'settings']).toBeUndefined();
		// …trust token consumed…
		expect(hasAnonSessionTrust()).toBe(false);
		// …and a reload was scheduled so the rune singletons re-read the bucket.
		expect(result.action).toBe('reload');
		expect(reloadMock).toHaveBeenCalled();
	});
});

describe('adoptAnonInto', () => {
	it('never overwrites existing destination data, but adopts keys the user lacks', () => {
		// User already has real progress; anon bucket has a colliding key + a new one.
		store[ROOT + 'u:user-a:progress'] = '{"who":"a"}';
		store[ROOT + 'progress'] = '{"who":"anon"}';
		store[ROOT + 'settings'] = '{"vol":5}';

		const copied = adoptAnonInto('user-a');

		// Collision: the user's own data wins, anon value discarded.
		expect(store[ROOT + 'u:user-a:progress']).toBe('{"who":"a"}');
		// Non-collision: adopted.
		expect(store[ROOT + 'u:user-a:settings']).toBe('{"vol":5}');
		// Only the non-colliding key counts toward the copy tally.
		expect(copied).toBe(1);
		// Bare anon keys are cleared regardless of whether they were copied.
		expect(store[ROOT + 'progress']).toBeUndefined();
		expect(store[ROOT + 'settings']).toBeUndefined();
	});

	it('never adopts or clears control keys or other users buckets', () => {
		store[ROOT + '__active'] = '"anon"';
		store[ROOT + '__schema'] = '2';
		store[ROOT + '__theme'] = 'dark';
		store[ROOT + 'u:user-b:progress'] = '{"who":"b"}';
		store[ROOT + 'progress'] = '{"who":"anon"}';

		const copied = adoptAnonInto('user-a');

		// The only adopted key is the bare anon one.
		expect(store[ROOT + 'u:user-a:progress']).toBe('{"who":"anon"}');
		expect(copied).toBe(1);
		expect(store[ROOT + 'progress']).toBeUndefined();

		// Control keys survive untouched.
		expect(store[ROOT + '__active']).toBe('"anon"');
		expect(store[ROOT + '__schema']).toBe('2');
		expect(store[ROOT + '__theme']).toBe('dark');
		// The other user's bucket is neither copied into user-a nor cleared.
		expect(store[ROOT + 'u:user-b:progress']).toBe('{"who":"b"}');
		expect(store[ROOT + 'u:user-a:u:user-b:progress']).toBeUndefined();
	});

	it('clears the trust token even when the anon bucket is empty (idempotent second call)', () => {
		markAnonSessionActive();
		expect(hasAnonSessionTrust()).toBe(true);

		const copied = adoptAnonInto('user-a');

		expect(copied).toBe(0);
		expect(hasAnonSessionTrust()).toBe(false);
	});
});
