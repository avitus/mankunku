import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock library-loader: each test controls the known lick set ───
const knownLicks = vi.hoisted(() => [] as { id: string; category: string }[]);
vi.mock('$lib/phrases/library-loader', () => ({
	getAllLicks: () => knownLicks,
	isCuratedLickId: (id: string) => id.startsWith('curated-')
}));

// ─── Mock sync module: capture what would have been written to cloud ───
const mockSyncLickMetadataToCloud = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined)
);
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: mockSyncLickMetadataToCloud,
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue({ status: 'empty' })
}));

// ─── Mock user-scope ────────────────────────────────────────
const mockGetScopeGeneration = vi.hoisted(() => vi.fn().mockReturnValue(0));
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: mockGetScopeGeneration
}));

// ─── Mock localStorage ────────────────────────────────────────
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
Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true
});

import {
	runLickMetadataMaintenance,
	loadUserLickTags,
	saveUserLickTags,
	getProgressionTags
} from '$lib/persistence/lick-practice-store';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	knownLicks.length = 0;
	mockGetScopeGeneration.mockReturnValue(0);
});

const supabase = {} as Parameters<typeof runLickMetadataMaintenance>[0];

const ALL_OK = { metadataOk: true, userLicksOk: true, communityOk: true };

describe('runLickMetadataMaintenance', () => {
	it('runs reconcile then backfill when every hydration succeeded', async () => {
		knownLicks.push({ id: 'user-1', category: 'blues' });
		saveUserLickTags({
			'user-1': ['practice'],
			'ghost-lick': ['practice'] // orphan — not in getAllLicks()
		});

		const result = await runLickMetadataMaintenance(supabase, ALL_OK);

		expect(result.ran).toBe(true);
		expect(result.reconciled).toBe(1);
		expect(result.backfilled).toBe(1);

		const tags = loadUserLickTags();
		expect(tags['ghost-lick']).toBeUndefined();
		expect(tags['user-1']).toContain('practice');
		expect(getProgressionTags('user-1')).toEqual(['blues']);
		expect(tags['__migrations']).toContain('prog-backfill-v1');
	});

	it.each([
		['metadata', { metadataOk: false, userLicksOk: true, communityOk: true }],
		['user-lick', { metadataOk: true, userLicksOk: false, communityOk: true }],
		['community', { metadataOk: true, userLicksOk: true, communityOk: false }]
	])(
		'skips all maintenance when %s hydration failed',
		async (_label, status) => {
			knownLicks.push({ id: 'user-1', category: 'blues' });
			saveUserLickTags({
				'user-1': ['practice'],
				'ghost-lick': ['practice']
			});

			const result = await runLickMetadataMaintenance(supabase, status);

			expect(result).toEqual({ ran: false, reconciled: 0, backfilled: 0 });
			// Nothing pruned, nothing seeded, nothing stamped, nothing synced.
			expect(loadUserLickTags()).toEqual({
				'user-1': ['practice'],
				'ghost-lick': ['practice']
			});
			expect(mockSyncLickMetadataToCloud).not.toHaveBeenCalled();
		}
	);

	it('skips the backfill when the scope generation changes during reconcile', async () => {
		knownLicks.push({ id: 'user-1', category: 'blues' });
		saveUserLickTags({
			'user-1': ['practice'],
			'ghost-lick': ['practice']
		});

		// Call order: maintenance entry, reconcile entry, reconcile
		// pre-writeback, maintenance re-check. A user switch lands between
		// reconcile and the backfill — the freshly-wiped store must not be
		// judged for migration state.
		mockGetScopeGeneration
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(1);

		const result = await runLickMetadataMaintenance(supabase, ALL_OK);

		expect(result).toEqual({ ran: true, reconciled: 1, backfilled: 0 });
		const tags = loadUserLickTags();
		expect(tags['__migrations']).toBeUndefined();
		expect(getProgressionTags('user-1')).toEqual([]);
	});

	it('a failed user-lick hydration cannot mass-prune metadata and clobber the cloud row', async () => {
		// The 2026-07-13 incident shape: user-lick hydration silently failed,
		// so getAllLicks() is missing every user-* lick. An ungated reconcile
		// would treat ALL their metadata as orphaned, prune it locally, and
		// push the emptied blobs over the (intact) cloud row.
		knownLicks.push({ id: 'curated-1', category: 'blues' }); // curated survived
		saveUserLickTags({
			'user-1': ['practice', 'prog:blues'],
			'user-2': ['practice', 'prog:ii-V-I-major'],
			'user-3': ['practice']
		});

		const result = await runLickMetadataMaintenance(supabase, {
			metadataOk: true,
			userLicksOk: false,
			communityOk: true
		});

		expect(result.ran).toBe(false);
		expect(Object.keys(loadUserLickTags())).toHaveLength(3);
		expect(mockSyncLickMetadataToCloud).not.toHaveBeenCalled();
	});
});
