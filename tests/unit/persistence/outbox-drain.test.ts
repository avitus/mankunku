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
import {
	enqueue,
	drainOutbox,
	flushOnHide,
	flushAllPendingSync,
	setOutboxClient
} from '$lib/persistence/outbox';
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

describe('outbox drain — identity, concurrency and coalescing guards', () => {
	/** Raw outbox blob under an explicit namespace prefix. */
	function rawOutbox(prefix: string): Record<string, StoredEntry> | null {
		const raw = store[`mankunku:${prefix}outbox`];
		return raw ? JSON.parse(raw) : null;
	}

	it('discards an entry stamped for a DIFFERENT uid without running its handler', async () => {
		// The queue lives in user-a's bucket but this entry was enqueued under
		// another identity (e.g. an anon-era intent adopted into the bucket by
		// adoptAnonInto). It must never be pushed under user-a's session.
		enqueue('settings');
		const map = outbox();
		map.settings.uid = 'someone-else';
		store['mankunku:u:user-a:outbox'] = JSON.stringify(map);

		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).not.toHaveBeenCalled();
		expect(outbox()).toEqual({});
	});

	it('keeps an entry that was re-enqueued DURING its push (rev bumped) instead of deleting the fresher intent', async () => {
		// A second local edit lands while the first push is in flight: the push
		// carried the OLD state, so the intent must survive the drain and run
		// again — deleting it would let local and cloud silently diverge.
		vi.mocked(flushSettingsToCloud).mockImplementation(async () => {
			enqueue('settings');
		});

		enqueue('settings');
		expect(outbox().settings.rev).toBe(1);

		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);
		expect(map.settings.rev).toBe(2);
		expect(map.settings.attempts).toBe(0);
	});

	it('abandons the drain when the account switches mid-push: the entry stays in the ORIGINAL bucket and nothing lands in the new one', async () => {
		vi.mocked(flushSettingsToCloud).mockImplementation(async () => {
			setActiveUid('user-b'); // reconcileActiveUser re-homed the realm mid-flight
		});

		enqueue('settings');
		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		// user-a's queued intent is untouched (it drains later under user-a)…
		expect(Object.keys(rawOutbox('u:user-a:') ?? {})).toEqual(['settings']);
		// …and the drain wrote nothing into user-b's namespace.
		expect(rawOutbox('u:user-b:')).toBeNull();
	});

	it('treats an unknown kind as handled and removes it (the v3 schema upgrade relies on this)', async () => {
		// namespace.ts rewrites a persisted `leadSheets` intent to `tunes` at
		// upgrade time precisely BECAUSE the drain deletes kinds it does not
		// know; pin the deletion so the rewrite stays load-bearing.
		enqueue('settings');
		const map = outbox() as Record<string, StoredEntry>;
		map.bogus = { ...map.settings, kind: 'bogus' };
		store['mankunku:u:user-a:outbox'] = JSON.stringify(map);

		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		expect(outbox()).toEqual({});
	});

	it('is re-entrant-safe: a second drain while one is in flight is a no-op', async () => {
		// The first push parks inside its handler until released. The drain
		// reaches the handler through getUser() AND runKind's dynamic import, so
		// wait for the handler itself rather than a fixed number of microtasks.
		// Any later call resolves at once, so a broken guard fails on the call
		// count below instead of hanging the test.
		let release!: () => void;
		let markEntered!: () => void;
		const entered = new Promise<void>((resolve) => { markEntered = resolve; });
		vi.mocked(flushSettingsToCloud).mockImplementationOnce(
			() => new Promise<void>((resolve) => { release = resolve; markEntered(); })
		);
		enqueue('settings');

		const first = drainOutbox(authedAs('user-a'));
		await entered;
		await drainOutbox(authedAs('user-a'));

		// One push for one intent — the concurrent drain did not double-send.
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);

		release();
		await first;
		expect(outbox()).toEqual({});
	});
});

describe('outbox — flush entry points', () => {
	it('flushAllPendingSync is a no-op until a client is registered, then drains with it', async () => {
		enqueue('settings');

		await flushAllPendingSync();
		expect(flushSettingsToCloud).not.toHaveBeenCalled();
		expect(Object.keys(outbox())).toEqual(['settings']);

		const sb = authedAs('user-a');
		setOutboxClient(sb);
		await flushAllPendingSync();
		expect(flushSettingsToCloud).toHaveBeenCalledWith(sb);
		expect(outbox()).toEqual({});
	});

	it('flushOnHide drains against the client it is handed', async () => {
		enqueue('progress');
		const sb = authedAs('user-a');
		await flushOnHide(sb);
		expect(flushProgressToCloud).toHaveBeenCalledWith(sb);
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

describe('outbox drain — ordering, failure isolation and self-scheduled retries', () => {
	/** A client verified as user-a, with its getUser spy exposed: the drain calls
	 *  getUser synchronously on entry, so the spy marks the instant a drain starts. */
	function client(): { sb: never; getUser: ReturnType<typeof vi.fn> } {
		const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-a' } } });
		return { sb: { auth: { getUser } } as never, getUser };
	}

	it('drains one kind at a time in first-enqueued order: a switch during the first push leaves the later kind unpushed and queued', async () => {
		// settings is enqueued BEFORE progress (the reverse of alphabetical order)
		// and its push re-homes the realm. A drain that ran kinds concurrently, or
		// in any order other than enqueue order, would push progress under the
		// session that just stopped being the active one.
		vi.mocked(flushSettingsToCloud).mockImplementation(async () => {
			setActiveUid('user-b');
		});
		enqueue('settings');
		enqueue('progress');

		await drainOutbox(authedAs('user-a'));

		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		expect(flushProgressToCloud).not.toHaveBeenCalled();
		const userA = JSON.parse(store['mankunku:u:user-a:outbox']) as Record<string, StoredEntry>;
		expect(Object.keys(userA)).toEqual(['settings', 'progress']);
	});

	it('a failing kind does not block the kinds queued after it', async () => {
		vi.mocked(flushSettingsToCloud).mockRejectedValue(new Error('push failed'));
		enqueue('settings');
		enqueue('progress');

		await drainOutbox(authedAs('user-a'));

		expect(flushProgressToCloud).toHaveBeenCalledTimes(1);
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);
		expect(map.settings.attempts).toBe(1);
	});

	it('schedules its own retry: a backed-off entry drains again when its backoff expires, with no new enqueue', async () => {
		const { sb, getUser } = client();
		setOutboxClient(sb);
		vi.mocked(flushSettingsToCloud)
			.mockRejectedValueOnce(new Error('transient'))
			.mockResolvedValue(undefined);
		enqueue('settings');

		await drainOutbox(sb); // fails → backoff(1) = 2000 ms, follow-up scheduled
		expect(getUser).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1999);
		expect(getUser).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(getUser).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(outbox()).toEqual({}));
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(2);
	});

	it('enqueue debounces: a burst of edits drains ONCE, 600 ms after the LAST enqueue', async () => {
		const { sb, getUser } = client();
		setOutboxClient(sb);

		enqueue('settings');
		await vi.advanceTimersByTimeAsync(400);
		enqueue('settings'); // restarts the window rather than riding the first timer
		await vi.advanceTimersByTimeAsync(599);
		expect(getUser).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(getUser).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(outbox()).toEqual({}));
		expect(flushSettingsToCloud).toHaveBeenCalledTimes(1);
		expect(flushSettingsToCloud).toHaveBeenCalledWith(sb);
	});
});
