/**
 * `hydrateLickPracticeProgress` gates the three tag-writing maintenance passes
 * — `backfillPracticeTags`, `pruneIncompatibleProgressionTags` and
 * `seedProgressHistoryFromSessions` — on the cloud hydration SUCCEEDING. Each
 * writes to the lick-tags / history blobs and enqueues a whole-row push, so
 * running them over a store that failed to hydrate would sync a partial blob
 * over the intact cloud row (the 2026-07-13 incident class). Local-only mode
 * (no session) has no cloud row to clobber and always runs them.
 *
 * The signals are behavioural, read back from the real stores: a misfit
 * `prog:*` tag (the 1|1|1-bar ii-V-I on the half-bar short template) is
 * pruned or survives; a legacy `practice` override is seeded or not; a
 * standard-session log entry becomes a history point or not.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/types';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

vi.mock('$lib/persistence/sync', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/persistence/sync')>()),
	loadLickMetadataFromCloud: vi.fn()
}));

import { loadLickMetadataFromCloud } from '$lib/persistence/sync';
import { hydrateLickPracticeProgress } from '$lib/state/lick-practice.svelte';
import {
	getProgressionTags,
	loadLickProgressHistory,
	loadUserLickTags,
	toggleProgressionTag
} from '$lib/persistence/lick-practice-store';
import { saveLickPracticeSessions } from '$lib/persistence/lick-practice-sessions';
import { progressionFitsLick } from '$lib/data/progressions';
import { getLickById } from '$lib/phrases/library-loader';

// A 1|1|1-bar ii-V-I: fits the long template only, so a short-template tag
// is exactly what the prune exists to drop.
const MISFIT_LICK = 'ii-V-I-maj-001';
// Carries a legacy `practice` override and a logged standard session.
const LEGACY_LICK = 'blues-001';

const fakeClient = {} as unknown as SupabaseClient<Database>;
const fakeSession = { user: { id: 'user-1' } } as unknown as Session;

/** Seed every signal the three passes would act on. */
function seedMaintenanceInputs(): void {
	toggleProgressionTag(MISFIT_LICK, 'ii-V-I-major');
	store.set('mankunku:lick-tag-overrides', JSON.stringify({ [LEGACY_LICK]: ['practice'] }));
	saveLickPracticeSessions([
		{
			id: 'session-1',
			timestamp: 5000,
			progressionType: 'blues',
			practiceMode: 'continuous',
			report: {
				licks: [
					{
						lickId: LEGACY_LICK,
						lickName: LEGACY_LICK,
						tempo: 90,
						newTempo: 92,
						keys: [
							{ key: 'C', score: 0.9, pitchAccuracy: 0.9, rhythmAccuracy: 0.9, passed: true }
						],
						averageScore: 0.9,
						passedCount: 1
					}
				],
				overallAverage: 0.9,
				totalAttempts: 1,
				totalPassed: 1,
				elapsedMinutes: 2
			}
		}
	]);
}

function maintenanceRan(): { pruned: boolean; backfilled: boolean; seeded: boolean } {
	return {
		pruned: !getProgressionTags(MISFIT_LICK).includes('ii-V-I-major'),
		backfilled: loadUserLickTags()[LEGACY_LICK]?.includes('practice') ?? false,
		seeded: (loadLickProgressHistory()[LEGACY_LICK] ?? []).length > 0
	};
}

beforeEach(() => {
	store.clear();
	vi.mocked(loadLickMetadataFromCloud).mockReset();
	seedMaintenanceInputs();
	// Precondition for the prune signal: the short template really is a misfit.
	expect(progressionFitsLick(getLickById(MISFIT_LICK)!, 'ii-V-I-major').fits).toBe(false);
	expect(maintenanceRan()).toEqual({ pruned: false, backfilled: false, seeded: false });
});

describe('hydrateLickPracticeProgress — the cloudOk gate', () => {
	it('skips every tag-writing pass when the cloud read fails', async () => {
		vi.mocked(loadLickMetadataFromCloud).mockResolvedValue({ status: 'error' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await hydrateLickPracticeProgress(fakeClient, fakeSession);

		expect(loadLickMetadataFromCloud).toHaveBeenCalledTimes(1);
		expect(maintenanceRan()).toEqual({ pruned: false, backfilled: false, seeded: false });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('cloud hydration failed'));
		warn.mockRestore();
	});

	it('runs all three passes once the cloud read succeeds — an empty cloud row counts as success', async () => {
		vi.mocked(loadLickMetadataFromCloud).mockResolvedValue({ status: 'empty' });

		await hydrateLickPracticeProgress(fakeClient, fakeSession);

		expect(maintenanceRan()).toEqual({ pruned: true, backfilled: true, seeded: true });
		expect(loadLickProgressHistory()[LEGACY_LICK]).toEqual([{ t: 5000, bpm: 92, keys: 1 }]);
	});

	it('runs all three passes in local-only mode without touching the cloud', async () => {
		await hydrateLickPracticeProgress(fakeClient, null);

		expect(loadLickMetadataFromCloud).not.toHaveBeenCalled();
		expect(maintenanceRan()).toEqual({ pruned: true, backfilled: true, seeded: true });
	});

	it('treats a client without a session as anonymous — the session is the gate, not the client', async () => {
		await hydrateLickPracticeProgress(fakeClient, undefined);

		expect(loadLickMetadataFromCloud).not.toHaveBeenCalled();
		expect(maintenanceRan().pruned).toBe(true);
	});
});
