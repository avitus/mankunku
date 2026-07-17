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

import { setActiveUid, __resetNamespaceCacheForTests } from '$lib/persistence/namespace';
import { enqueue, drainOutbox } from '$lib/persistence/outbox';
import { load } from '$lib/persistence/storage';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	__resetNamespaceCacheForTests();
	setActiveUid('user-a');
	__resetNamespaceCacheForTests();
	setActiveUid('user-a');
});

function outbox(): Record<string, unknown> {
	return load<Record<string, unknown>>('outbox') ?? {};
}

describe('outbox', () => {
	it('coalesces repeated enqueues of the same kind into one entry', () => {
		enqueue('settings');
		enqueue('settings');
		enqueue('settings');
		const map = outbox();
		expect(Object.keys(map)).toEqual(['settings']);
	});

	it('stamps entries with the enqueuing uid', () => {
		enqueue('progress');
		const map = outbox() as Record<string, { uid: string }>;
		expect(map.progress.uid).toBe('user-a');
	});

	it('does NOT drain (or drop) entries when the authenticated user differs from the active namespace', async () => {
		enqueue('settings');
		// A supabase client whose verified user is someone ELSE.
		const upsert = vi.fn().mockResolvedValue({ error: null });
		const mismatched = {
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-b' } } }) },
			from: vi.fn(() => ({ upsert }))
		} as never;

		await drainOutbox(mismatched);

		// Entry is preserved (drains later under the correct identity) and nothing
		// was pushed — a queued write can never land in the wrong account.
		expect(Object.keys(outbox())).toEqual(['settings']);
		expect(upsert).not.toHaveBeenCalled();
	});

	it('aborts the whole drain when auth is unavailable', async () => {
		enqueue('progress');
		const unavailable = {
			auth: { getUser: vi.fn().mockRejectedValue(new Error('offline')) },
			from: vi.fn()
		} as never;
		await drainOutbox(unavailable);
		expect(Object.keys(outbox())).toEqual(['progress']); // still queued
	});
});
