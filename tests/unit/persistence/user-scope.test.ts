import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { syncUserScope, getScopeGeneration } from '$lib/persistence/user-scope';
import { saveRecording, getAllRecordingSummaries } from '$lib/persistence/audio-store';
import { expectNoMankunkuKeysExcept } from '../../helpers/storage-snapshot';

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

	it('anonymous → first login: IndexedDB recordings survive (no wipe on first sign-in)', async () => {
		// User records audio while anonymous (no `__lastUserId` marker).
		// On first sign-in, the wipe is skipped (lastUserId === null branch),
		// so the recording stays available — the user can hear what they just
		// recorded after signing in.
		const blob = new Blob([new Uint8Array(20)], { type: 'audio/webm' });
		await saveRecording('anon-session-1', blob);
		expect((await getAllRecordingSummaries()).length).toBe(1);

		// First-ever sign-in: marker absent, so syncUserScope does NOT wipe.
		const { cleared } = await syncUserScope('user-A');

		expect(cleared).toBe(false);
		// Recording from the anonymous session survives into the new user's
		// session — they can play back what they just recorded.
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

	it('only clears the supabase-api cache (deliberate scoping — locks in P2-2)', async () => {
		seedMarker('user-A');
		const deleteMock = vi.fn().mockResolvedValue(true);
		const cachesStub = { delete: deleteMock, keys: vi.fn(), open: vi.fn(), match: vi.fn(), has: vi.fn() };
		Object.defineProperty(globalThis, 'caches', { value: cachesStub, writable: true, configurable: true });

		try {
			await syncUserScope('user-B');
			// Asserts the wipe is deliberately scoped: other Workbox caches
			// (precache, fonts, images) survive a user switch — they are
			// content-addressable and not user-bound. If a future change starts
			// nuking everything, this test fails to force a deliberate decision.
			expect(deleteMock).toHaveBeenCalledTimes(1);
			expect(deleteMock).toHaveBeenCalledWith('supabase-api');
		} finally {
			delete (globalThis as { caches?: unknown }).caches;
		}
	});
});

// ─── Negative-property: nothing prefixed `mankunku:` survives a wipe ───
//
// The wipe coordinator (`clearAll` in storage.ts) iterates `mankunku:`-
// prefixed keys and removes each one. These tests pin down that property
// so a future cache key added without a corresponding clearAll path will
// fail here instead of leaking across users in production.

describe('syncUserScope — negative-property wipe', () => {
	const KNOWN_KEYS = [
		'mankunku:settings',
		'mankunku:progress',
		'mankunku:tour-state',
		'mankunku:daily-summaries',
		'mankunku:progress-meta',
		'mankunku:lick-practice-progress',
		'mankunku:user-lick-tags',
		'mankunku:lick-tag-overrides',
		'mankunku:lick-category-overrides',
		'mankunku:lick-unlock-count',
		'mankunku:user-licks',
		'mankunku:user-licks-owners',
		'mankunku:community-favorites',
		'mankunku:community-adoptions',
		'mankunku:community-adopted-payloads',
		'mankunku:community-adopted-authors',
		'mankunku:community-privacy-ack'
	];

	function seedAllKnownKeys(): void {
		for (const k of KNOWN_KEYS) {
			local._store[k] = JSON.stringify({ seeded: true });
		}
	}

	it('logout removes every mankunku: key (only __lastUserId removed, no settings remnant)', async () => {
		seedMarker('user-A');
		seedAllKnownKeys();

		await syncUserScope(null);

		// Logout: marker removed, no theme to preserve in this seed (the seed
		// `settings` blob has `{ seeded: true }` and no `theme` field).
		// Therefore NO mankunku key should remain at all.
		expectNoMankunkuKeysExcept(local, []);
		expect(local._store['mankunku:__lastUserId']).toBeUndefined();
	});

	it('user switch removes every mankunku: key except theme blob (settings has only theme)', async () => {
		seedMarker('user-A');
		seedAllKnownKeys();
		// Overwrite the seed settings with a real theme value so the wipe path
		// preserves it. Everything else still gets wiped.
		local._store['mankunku:settings'] = JSON.stringify({ theme: 'light', defaultTempo: 200 });

		await syncUserScope('user-B');

		// settings re-saved as a minimal blob containing only the theme.
		// __lastUserId now holds the new user. Nothing else from the seed remains.
		expectNoMankunkuKeysExcept(local, ['settings', '__lastUserId']);
		const restored = JSON.parse(local._store['mankunku:settings']!);
		expect(restored).toEqual({ theme: 'light' });
		expect(JSON.parse(local._store['mankunku:__lastUserId']!)).toBe('user-B');
	});

	it('theme survives a logout when present (parity with the user-switch path)', async () => {
		seedMarker('user-A');
		local._store['mankunku:settings'] = JSON.stringify({
			theme: 'light',
			defaultTempo: 120
		});

		await syncUserScope(null);

		// Same theme-preservation rule as user-switch: the wipe is the same
		// branch. This pins down the parity so a future refactor can't quietly
		// drop the theme on logout while keeping it on switch.
		const restored = JSON.parse(local._store['mankunku:settings']!) as { theme?: string };
		expect(restored.theme).toBe('light');
		expect((restored as { defaultTempo?: number }).defaultTempo).toBeUndefined();
		expect(local._store['mankunku:__lastUserId']).toBeUndefined();
	});

	it('rejects unknown future cache keys — adding a mankunku:foo without wiring clearAll fails this test', async () => {
		seedMarker('user-A');
		local._store['mankunku:foo-future-cache'] = JSON.stringify(['poison']);
		local._store['mankunku:bar-future-cache'] = JSON.stringify({ leak: true });

		await syncUserScope('user-B');

		// `clearAll` walks every mankunku-prefixed key, so even unknown future
		// keys are removed. This test is the structural barrier: if someone
		// adds a key without using the `save()` helper, this still passes
		// because clearAll uses listKeys(). But if someone special-cases a
		// new cache to skip the wipe, this fails.
		expect(local._store['mankunku:foo-future-cache']).toBeUndefined();
		expect(local._store['mankunku:bar-future-cache']).toBeUndefined();
	});
});
