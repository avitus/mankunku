import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { syncUserScope, getScopeGeneration } from '$lib/persistence/user-scope';
import { saveRecording, getAllRecordingSummaries } from '$lib/persistence/audio-store';

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

beforeEach(async () => {
	local = createStorageMock();
	session = createStorageMock();
	Object.defineProperty(globalThis, 'localStorage', { value: local, writable: true, configurable: true });
	Object.defineProperty(globalThis, 'sessionStorage', { value: session, writable: true, configurable: true });
	// Ensure IndexedDB store is empty before each test.
	const mod = await import('$lib/persistence/audio-store');
	await mod.clearAllRecordings();
});

afterAll(() => {
	if (ORIGINAL_LOCAL) Object.defineProperty(globalThis, 'localStorage', ORIGINAL_LOCAL);
	if (ORIGINAL_SESSION) Object.defineProperty(globalThis, 'sessionStorage', ORIGINAL_SESSION);
});

function seedMarker(userId: string): void {
	local._store['mankunku:__lastUserId'] = JSON.stringify(userId);
}

describe('syncUserScope', () => {
	it('first-ever call (no marker) → no clear, writes marker', async () => {
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);
		const genBefore = getScopeGeneration();

		const { cleared } = await syncUserScope('user-A');

		expect(cleared).toBe(false);
		expect(getScopeGeneration()).toBe(genBefore);
		// Local data preserved (supports anonymous → first-login migration path)
		expect(local._store['mankunku:user-licks']).toBeDefined();
		// Marker now points at the newly-authenticated user
		expect(JSON.parse(local._store['mankunku:__lastUserId']!)).toBe('user-A');
	});

	it('same user returning → no clear, marker unchanged', async () => {
		seedMarker('user-A');
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);
		const genBefore = getScopeGeneration();

		const { cleared } = await syncUserScope('user-A');

		expect(cleared).toBe(false);
		expect(getScopeGeneration()).toBe(genBefore);
		expect(local._store['mankunku:user-licks']).toBeDefined();
		expect(JSON.parse(local._store['mankunku:__lastUserId']!)).toBe('user-A');
	});

	it('user switch → clears localStorage, sessionStorage, updates marker, bumps generation', async () => {
		seedMarker('user-A');
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);
		local._store['mankunku:progress'] = JSON.stringify({ sessions: [] });
		local._store['mankunku:settings'] = JSON.stringify({ theme: 'dark', defaultTempo: 100 });
		session._store['backing-track-log'] = JSON.stringify([{ phraseId: 'p1' }]);
		const genBefore = getScopeGeneration();

		const { cleared } = await syncUserScope('user-B');

		expect(cleared).toBe(true);
		expect(getScopeGeneration()).toBe(genBefore + 1);
		// Prior user's data wiped
		expect(local._store['mankunku:user-licks']).toBeUndefined();
		expect(local._store['mankunku:progress']).toBeUndefined();
		expect(session._store['backing-track-log']).toBeUndefined();
		// Marker updated to new user
		expect(JSON.parse(local._store['mankunku:__lastUserId']!)).toBe('user-B');
	});

	it('logout (currentUserId null, marker set) → clears and removes marker', async () => {
		seedMarker('user-A');
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);
		session._store['backing-track-log'] = JSON.stringify([{ phraseId: 'p1' }]);
		const genBefore = getScopeGeneration();

		const { cleared } = await syncUserScope(null);

		expect(cleared).toBe(true);
		expect(getScopeGeneration()).toBe(genBefore + 1);
		expect(local._store['mankunku:user-licks']).toBeUndefined();
		expect(session._store['backing-track-log']).toBeUndefined();
		// Marker removed when unauthenticated
		expect(local._store['mankunku:__lastUserId']).toBeUndefined();
	});

	it('anonymous → anonymous (no marker, null user) → no-op', async () => {
		local._store['mankunku:user-licks'] = JSON.stringify([{ id: 'lick-1' }]);
		const genBefore = getScopeGeneration();

		const { cleared } = await syncUserScope(null);

		expect(cleared).toBe(false);
		expect(getScopeGeneration()).toBe(genBefore);
		expect(local._store['mankunku:user-licks']).toBeDefined();
		expect(local._store['mankunku:__lastUserId']).toBeUndefined();
	});

	it('theme survives a user switch', async () => {
		seedMarker('user-A');
		local._store['mankunku:settings'] = JSON.stringify({
			theme: 'light',
			defaultTempo: 120,
			instrumentId: 'alto-sax'
		});

		const { cleared } = await syncUserScope('user-B');

		expect(cleared).toBe(true);
		// Other settings wiped, but theme restored as a minimal settings blob
		const restored = JSON.parse(local._store['mankunku:settings']!) as { theme?: string };
		expect(restored.theme).toBe('light');
		expect((restored as { defaultTempo?: number }).defaultTempo).toBeUndefined();
	});

	it('wipes IndexedDB recordings on user switch', async () => {
		seedMarker('user-A');
		const blob = new Blob([new Uint8Array(10)], { type: 'audio/webm' });
		await saveRecording('session-A-1', blob);
		expect((await getAllRecordingSummaries()).length).toBe(1);

		await syncUserScope('user-B');

		expect((await getAllRecordingSummaries()).length).toBe(0);
	});

	it('does not wipe IndexedDB for same user', async () => {
		seedMarker('user-A');
		const blob = new Blob([new Uint8Array(10)], { type: 'audio/webm' });
		await saveRecording('session-A-1', blob);

		await syncUserScope('user-A');

		expect((await getAllRecordingSummaries()).length).toBe(1);
	});

	it('attempts caches.delete when caches API is present', async () => {
		seedMarker('user-A');
		const deleteMock = vi.fn().mockResolvedValue(true);
		const cachesStub = { delete: deleteMock, keys: vi.fn(), open: vi.fn(), match: vi.fn(), has: vi.fn() };
		Object.defineProperty(globalThis, 'caches', { value: cachesStub, writable: true, configurable: true });

		try {
			await syncUserScope('user-B');
			expect(deleteMock).toHaveBeenCalledWith('supabase-api');
		} finally {
			delete (globalThis as { caches?: unknown }).caches;
		}
	});
});
