import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock the state-module flush handlers that runKind dynamically imports ─────
// vi.mock is hoisted; the real modules are runes .svelte.ts state singletons with
// import-time side effects, so we replace them wholesale. Both the static imports
// below and runKind's `await import(...)` resolve to these same vi.fn()s.
vi.mock('$lib/state/settings.svelte', () => ({
	flushSettingsToCloud: vi.fn()
}));
vi.mock('$lib/state/progress.svelte', () => ({
	flushProgressToCloud: vi.fn()
}));

// ─── Mock localStorage (community.test.ts pattern) ────────────────────────────
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

import { setActiveUid, __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import { enqueue, drainOutbox } from '$lib/persistence/outbox';
import { load } from '$lib/persistence/storage';
import { flushSettingsToCloud } from '$lib/state/settings.svelte';
import { flushProgressToCloud } from '$lib/state/progress.svelte';

/** A fixed base time so backoff timestamps are deterministic. */
const BASE = 1_700_000_000_000;

/** Read the raw namespaced outbox map exactly as the module persists it. */
type StoredEntry = { kind: string; uid: string; rev: number; attempts: number; nextAttemptAt: number };
function outbox(): Record<string, StoredEntry> {
	return load<Record<string, StoredEntry>>('outbox') ?? {};
}

/** A supabase client whose verified user matches the active namespace (user-a). */
function authedAs(uid: string = 'user-a'): never {
	return {
		auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: uid } } }) }
	} as never;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(BASE);
	localStorageMock.clear();
	vi.clearAllMocks();
	// Handlers succeed by default; individual tests opt into rejection.
	vi.mocked(flushSettingsToCloud).mockResolvedValue(undefined);
	vi.mocked(flushProgressToCloud).mockResolvedValue(undefined);
	// Resolve the active namespace to the authenticated user so the outbox keys
	// live under mankunku:u:user-a: and the drain identity gate passes.
	__resetNamespaceCacheForTests();
	setActiveUid('user-a');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('outbox drain — success path', () => {
	it('invokes the kind handler and removes the entry on success', async () => {
		enqueue('settings');
		expect(Object.keys(outbox())).toEqual(['settings']);

		const sb = authedAs('user-a');
		await drainOutbox(sb);

		// The handler ran, receiving the very client passed to drainOutbox …
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		expect(flushSettingsToCloud).toHaveBeenCalledWith(sb);
		// … and the entry was dequeued.
		expect(outbox()).toEqual({});
	});

	it('drains multiple kinds, dequeuing each as its handler succeeds', async () => {
		enqueue('settings');
		enqueue('progress');
		expect(Object.keys(outbox()).sort()).toEqual(['progress', 'settings']);

		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		expect(flushProgressToCloud).toHaveBeenCalledTimes(1);
		expect(outbox()).toEqual({});
	});
});

describe('outbox drain — failure / retry / backoff', () => {
	it('retains a failed entry with attempts incremented and a future backoff timestamp', async () => {
		vi.mocked(flushSettingsToCloud).mockRejectedValue(new Error('push failed'));

		enqueue('settings');
		const t0 = Date.now();
		await drainOutbox(authedAs('user-a'));

		// The handler was attempted but the entry was NOT dropped.
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);

		const entry = map.settings;
		// attempts bumped 0 → 1, backoff(1) = min(60_000, 1000 * 2**1) = 2000ms.
		expect(entry.attempts).toBe(1);
		expect(entry.nextAttemptAt).toBe(t0 + 2000);
		expect(entry.nextAttemptAt).toBeGreaterThan(t0);
	});

	it('does not re-invoke the handler for an entry still inside its backoff window', async () => {
		vi.mocked(flushSettingsToCloud).mockRejectedValue(new Error('push failed'));

		enqueue('settings');
		await drainOutbox(authedAs('user-a')); // 1st attempt fails → nextAttemptAt = now + 2000
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);

		// Drain again immediately (well before the 2000ms backoff elapses).
		await drainOutbox(authedAs('user-a'));

		// The backed-off entry is skipped — no second handler call, attempts unchanged.
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);
		expect(map.settings.attempts).toBe(1);
	});

	it('retries and dequeues the entry once the backoff window has elapsed', async () => {
		// Fail the first attempt, then succeed on the retry.
		vi.mocked(flushSettingsToCloud)
			.mockRejectedValueOnce(new Error('transient'))
			.mockResolvedValue(undefined);

		enqueue('settings');
		await drainOutbox(authedAs('user-a')); // fails → retained, backoff = now + 2000
		expect(Object.keys(outbox())).toEqual(['settings']);
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);

		// Advance past the backoff window, then drain again.
		vi.setSystemTime(BASE + 3000);
		await drainOutbox(authedAs('user-a'));

		// The retry fired and the now-successful entry was dequeued.
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(2);
		expect(outbox()).toEqual({});
	});

	it('coalesces across a failed drain: a single entry persists, never duplicated', async () => {
		vi.mocked(flushSettingsToCloud).mockRejectedValue(new Error('push failed'));

		// Rapid edits coalesce to one pending entry before the drain …
		enqueue('settings');
		enqueue('settings');
		enqueue('settings');
		expect(Object.keys(outbox())).toEqual(['settings']);

		await drainOutbox(authedAs('user-a'));

		// … and the failed drain leaves exactly one entry (retained, not duplicated).
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);
		expect(map.settings.attempts).toBe(1);
	});
});
