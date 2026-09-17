/**
 * Page-load hydration fans out to every cloud initializer at once, and each of
 * them verifies the session with `auth.getUser()` — a network round-trip to
 * the Supabase Auth server, serialized behind the client's session lock.
 * Sentry MANKUNKU-1Q flagged the burst as an N+1 API call: one production
 * pageload issued 17 `GET /auth/v1/user`, eleven of them queued together,
 * the last waiting over a second. Concurrent verifications on one client now
 * share a single request (`getUserCoalesced`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudState, mockSupabaseFromCloud } from '../helpers/cloud-sync-mocks';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((k: string) => store.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => store.set(k, v)),
	removeItem: vi.fn((k: string) => store.delete(k)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

beforeEach(() => {
	store.clear();
});

/** A cloud client whose auth check takes as long as a network round-trip. */
function clientWithSlowAuth(): { client: never; getUser: ReturnType<typeof vi.fn> } {
	const client = mockSupabaseFromCloud(createCloudState(), { auth: { userId: 'user-1' } }) as {
		auth: { getUser: () => Promise<unknown> };
	};
	const answer = client.auth.getUser;
	const getUser = vi.fn(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
		return answer();
	});
	client.auth.getUser = getUser;
	return { client: client as never, getUser };
}

describe('page-load hydration fan-out (MANKUNKU-1Q)', () => {
	it('verifies the user once for the initializers +layout.ts starts together', async () => {
		const { initUserLicksFromCloud } = await import('$lib/persistence/user-licks');
		const { initTunesFromCloud } = await import('$lib/persistence/user-tunes');
		const { initCommunityFromCloud } = await import('$lib/persistence/community');
		const { initTuneCommunityFromCloud } = await import('$lib/persistence/tune-community');
		const { loadProgressFromCloud, loadSettingsFromCloud } = await import('$lib/persistence/sync');
		const { client, getUser } = clientWithSlowAuth();

		await Promise.allSettled([
			loadProgressFromCloud(client),
			loadSettingsFromCloud(client),
			initUserLicksFromCloud(client),
			initTunesFromCloud(client),
			initCommunityFromCloud(client),
			initTuneCommunityFromCloud(client)
		]);

		expect(getUser).toHaveBeenCalledTimes(1);
	});
});
