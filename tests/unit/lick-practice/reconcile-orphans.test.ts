import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LickPracticeProgress } from '$lib/types/lick-practice';

// ─── Mock library-loader: lets each test control which IDs are "known" ───
const knownIds = vi.hoisted(() => new Set<string>());
vi.mock('$lib/phrases/library-loader', () => ({
	getAllLicks: () => Array.from(knownIds).map((id) => ({ id }))
}));

// ─── Mock sync module: capture what would have been written to cloud ───
const mockSyncLickMetadataToCloud = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined)
);
vi.mock('$lib/persistence/sync', () => ({
	syncLickMetadataToCloud: mockSyncLickMetadataToCloud,
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue(null)
}));

// ─── Mock user-scope: lets each test simulate a mid-flight switch ───
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
	reconcileOrphanedLickMetadata,
	loadUserLickTags,
	saveUserLickTags,
	loadLickPracticeProgress,
	saveLickPracticeProgress,
	loadUnlockCounts
} from '$lib/persistence/lick-practice-store';
import { save } from '$lib/persistence/storage';

beforeEach(() => {
	localStorageMock.clear();
	vi.clearAllMocks();
	knownIds.clear();
	mockGetScopeGeneration.mockReturnValue(0);
});

const supabase = {} as Parameters<typeof reconcileOrphanedLickMetadata>[0];

describe('reconcileOrphanedLickMetadata', () => {
	it('removes tag entries whose lick IDs are not in getAllLicks()', async () => {
		knownIds.add('mine-1');
		saveUserLickTags({
			'mine-1': ['practice'],
			'foreign-avitus': ['practice']
		});

		const removed = await reconcileOrphanedLickMetadata(supabase);

		expect(removed).toBe(1);
		expect(loadUserLickTags()).toEqual({ 'mine-1': ['practice'] });
	});

	it('removes orphan practice progress entries', async () => {
		knownIds.add('mine-1');
		const progress: LickPracticeProgress = {
			'mine-1': { C: { currentTempo: 100, lastPracticedAt: 0, passCount: 0 } },
			'foreign-avitus': { C: { currentTempo: 80, lastPracticedAt: 0, passCount: 0 } }
		};
		saveLickPracticeProgress(progress);

		const removed = await reconcileOrphanedLickMetadata(supabase);

		expect(removed).toBe(1);
		const cleaned = loadLickPracticeProgress();
		expect(Object.keys(cleaned)).toEqual(['mine-1']);
	});

	it('removes orphan unlock counts', async () => {
		knownIds.add('mine-1');
		// Use save() directly: there is no exported saveUnlockCounts.
		save('lick-unlock-count', { 'mine-1': 3, 'foreign-avitus': 5 });

		const removed = await reconcileOrphanedLickMetadata(supabase);

		expect(removed).toBe(1);
		expect(loadUnlockCounts()).toEqual({ 'mine-1': 3 });
	});

	it('syncs cleaned blobs to cloud, but only for the maps that changed', async () => {
		knownIds.add('mine-1');
		saveUserLickTags({
			'mine-1': ['practice'],
			'foreign-avitus': ['practice']
		});
		// Progress map is already clean — should not appear in the cloud payload.
		saveLickPracticeProgress({
			'mine-1': { C: { currentTempo: 100, lastPracticedAt: 0, passCount: 0 } }
		});

		await reconcileOrphanedLickMetadata(supabase);

		expect(mockSyncLickMetadataToCloud).toHaveBeenCalledTimes(1);
		const [, payload] = mockSyncLickMetadataToCloud.mock.calls[0];
		expect(payload).toHaveProperty('lickTags');
		expect(payload).not.toHaveProperty('practiceProgress');
		expect(payload).not.toHaveProperty('unlockCounts');
	});

	it('is a no-op when nothing is orphaned', async () => {
		knownIds.add('mine-1');
		saveUserLickTags({ 'mine-1': ['practice'] });

		const removed = await reconcileOrphanedLickMetadata(supabase);

		expect(removed).toBe(0);
		expect(mockSyncLickMetadataToCloud).not.toHaveBeenCalled();
	});

	it('is a no-op when all stores are empty', async () => {
		const removed = await reconcileOrphanedLickMetadata(supabase);
		expect(removed).toBe(0);
		expect(mockSyncLickMetadataToCloud).not.toHaveBeenCalled();
	});

	it('aborts writeback when the scope generation changes mid-flight', async () => {
		knownIds.add('mine-1');
		saveUserLickTags({
			'mine-1': ['practice'],
			'foreign-avitus': ['practice']
		});

		// Simulate a user switch happening while the function runs:
		// getScopeGeneration returns 0 on entry, then 1 after the orphan scan.
		mockGetScopeGeneration.mockReturnValueOnce(0).mockReturnValueOnce(1);

		const removed = await reconcileOrphanedLickMetadata(supabase);

		expect(removed).toBe(0);
		expect(mockSyncLickMetadataToCloud).not.toHaveBeenCalled();
		// localStorage must NOT have been overwritten with the cleaned blob —
		// the previous user's tags would have clobbered the new user's state.
		expect(loadUserLickTags()).toEqual({
			'mine-1': ['practice'],
			'foreign-avitus': ['practice']
		});
	});

	it('totals removed counts across all three stores', async () => {
		knownIds.add('mine-1');
		saveUserLickTags({
			'mine-1': ['practice'],
			'foreign-a': ['practice'],
			'foreign-b': ['practice']
		});
		saveLickPracticeProgress({
			'foreign-c': { C: { currentTempo: 100, lastPracticedAt: 0, passCount: 0 } }
		});
		save('lick-unlock-count', { 'foreign-d': 7, 'foreign-e': 8 });

		const removed = await reconcileOrphanedLickMetadata(supabase);

		// 2 orphan tags + 1 orphan progress + 2 orphan unlocks
		expect(removed).toBe(5);
	});
});
