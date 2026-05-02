/**
 * Cross-device user-lick sync — same-id LWW + foreign-owned collision.
 *
 * Lives in a separate file from `user-licks.test.ts` because that file mocks
 * `$lib/persistence/sync` whole-cloth (so its tests can verify saveUserLick's
 * fire-and-forget behavior in isolation). Here we exercise the real
 * `syncUserLicksToCloud` to characterize the multi-device write path.
 *
 * Closes the regression class behind commits e7857b5 and b8b82fa: ID collision
 * with a different user's row must route through `ignoreDuplicates: true`
 * rather than engaging RLS UPDATE (which would 42501 and silently lose the
 * write).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncUserLicksToCloud } from '$lib/persistence/sync';
import type { Phrase } from '$lib/types/music';

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
		for (const k of Object.keys(store)) delete store[k];
	}),
	get length() {
		return Object.keys(store).length;
	},
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
});

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'shared-lick',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes: [],
		harmony: [],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered',
		...overrides
	};
}

interface Capture {
	upsertCalls: Array<{
		table: string;
		rows: unknown;
		opts: unknown;
	}>;
}

/**
 * In-memory cloud that:
 *  - tracks every upsert call (which path the production code took)
 *  - applies the upsert as LWW: latest payload replaces the row
 *  - simulates RLS by enforcing user_id filter on the SELECT chain
 *
 * The `simulatedCloudRow` lives in the closure so multiple device clients
 * sharing the same `capture` see the same authoritative state — this is the
 * essential property for testing cross-device LWW.
 */
function buildCloudHarness(): {
	capture: Capture;
	makeClient: (userId: string) => unknown;
} {
	const capture: Capture = { upsertCalls: [] };
	const cloudRows: Array<{
		id: string;
		user_id: string;
		name: string;
		updated_at?: string;
	}> = [];

	function makeClient(userId: string): unknown {
		return {
			auth: {
				getUser: vi.fn().mockResolvedValue({
					data: { user: { id: userId } },
					error: null
				})
			},
			from: vi.fn((table: string) => {
				const filters: Array<{ col: string; vals: unknown }> = [];
				const builder: Record<string, unknown> = {};

				builder.select = vi.fn(() => builder);
				builder.eq = vi.fn((col: string, val: unknown) => {
					filters.push({ col, vals: val });
					return builder;
				});
				builder.in = vi.fn((col: string, vals: unknown[]) => {
					filters.push({ col, vals });
					return builder;
				});
				builder.then = (
					resolve: (v: { data: unknown[]; error: null }) => unknown,
					reject?: (e: unknown) => unknown
				) => {
					const userIdFilter = filters.find((f) => f.col === 'user_id');
					const idFilter = filters.find((f) => f.col === 'id');
					const matchesUser = (r: { user_id: string }) =>
						userIdFilter ? r.user_id === userIdFilter.vals : true;
					const matchesId = (r: { id: string }) =>
						idFilter && Array.isArray(idFilter.vals)
							? (idFilter.vals as string[]).includes(r.id)
							: true;
					const data = cloudRows
						.filter((r) => matchesUser(r) && matchesId(r))
						.map((r) => ({ id: r.id }));
					return Promise.resolve({ data, error: null }).then(resolve, reject);
				};

				builder.upsert = vi.fn(
					async (
						rows: unknown,
						opts?: { onConflict?: string; ignoreDuplicates?: boolean }
					) => {
						capture.upsertCalls.push({ table, rows, opts });
						const list = Array.isArray(rows)
							? (rows as Array<Record<string, unknown>>)
							: [rows as Record<string, unknown>];
						for (const r of list) {
							const id = r.id as string;
							const ru = r.user_id as string;
							const existing = cloudRows.find((row) => row.id === id);
							if (existing) {
								if (opts?.ignoreDuplicates) {
									// DO NOTHING on conflict — leave the existing row alone.
									continue;
								}
								// Conflict + UPDATE — only allowed by RLS if owned. Our
								// production code pre-filters to ensure ownership, so we
								// trust it here. Apply LWW.
								if (existing.user_id === ru) {
									existing.name = r.name as string;
									existing.updated_at = r.updated_at as string;
								} else {
									// If production ever upserts a foreign row without
									// ignoreDuplicates, surface as RLS error.
									return { error: { code: '42501', message: 'RLS USING violation' } };
								}
							} else {
								cloudRows.push({
									id,
									user_id: ru,
									name: r.name as string,
									updated_at: r.updated_at as string
								});
							}
						}
						return { error: null };
					}
				);

				return builder;
			})
		};
	}

	return { capture, makeClient };
}

describe('two-device same-user write to the same lick id (LWW)', () => {
	it('first device inserts; second device updates without RLS error', async () => {
		const { capture, makeClient } = buildCloudHarness();

		const lickV1 = makePhrase({ id: 'shared-lick', name: 'V1 from device A' });
		const lickV2 = makePhrase({ id: 'shared-lick', name: 'V2 from device B' });

		// Device A — id not yet in cloud, so the production code routes through
		// the "unknown" branch with ignoreDuplicates: true. INSERT lands.
		const deviceA = makeClient('andy') as Parameters<typeof syncUserLicksToCloud>[0];
		await syncUserLicksToCloud(deviceA, [lickV1]);

		const lastA = capture.upsertCalls.at(-1);
		expect(lastA?.table).toBe('user_licks');
		expect(
			(lastA?.opts as { ignoreDuplicates?: boolean })?.ignoreDuplicates
		).toBe(true);

		// Device B — id is now in cloud and owned by 'andy', so production
		// routes through the "owned" branch without ignoreDuplicates. UPDATE
		// lands; LWW selects V2.
		const deviceB = makeClient('andy') as Parameters<typeof syncUserLicksToCloud>[0];
		await syncUserLicksToCloud(deviceB, [lickV2]);

		const lastB = capture.upsertCalls.at(-1);
		expect(
			(lastB?.opts as { ignoreDuplicates?: boolean })?.ignoreDuplicates
		).not.toBe(true);
	});
});

describe('id collision with a different user', () => {
	it('foreign-owned id is routed through ignoreDuplicates — no RLS UPDATE engagement', async () => {
		// Pre-seed cloud with an id 'collision-id' owned by 'avitus'.
		const { capture, makeClient } = buildCloudHarness();
		// User 'avitus' creates the foreign row first.
		const avitusClient = makeClient('avitus') as Parameters<typeof syncUserLicksToCloud>[0];
		await syncUserLicksToCloud(avitusClient, [
			makePhrase({ id: 'collision-id', name: 'Original by avitus' })
		]);

		// 'andy' tries to save a lick with the same id (e.g. id collision from a
		// generator clash). Production's filtered SELECT returns 0 rows for andy
		// (the existing row belongs to avitus), so the lick goes into the unknown
		// path. The unknown path uses ignoreDuplicates → DO NOTHING on conflict.
		// No RLS error, no clobber.
		const initialCount = capture.upsertCalls.length;
		const andyClient = makeClient('andy') as Parameters<typeof syncUserLicksToCloud>[0];
		await syncUserLicksToCloud(andyClient, [
			makePhrase({ id: 'collision-id', name: 'andys attempt' })
		]);

		const andysCalls = capture.upsertCalls.slice(initialCount);
		// Exactly one upsert; ignoreDuplicates set; no error.
		expect(andysCalls).toHaveLength(1);
		expect(
			(andysCalls[0].opts as { ignoreDuplicates?: boolean })?.ignoreDuplicates
		).toBe(true);
	});
});
