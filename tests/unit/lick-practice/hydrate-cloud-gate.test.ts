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
import type { Score } from '$lib/types/scoring';
import type { Database } from '$lib/supabase/types';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	/** `Storage.length`, read off the backing map. */
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
import {
	hydrateLickPracticeProgress,
	lickPractice,
	startDailyPracticeSession,
	startSession,
	startSingleLickSession,
	resetSession,
	recordKeyAttempt,
	startInterLickTransition
} from '$lib/state/lick-practice.svelte';
import {
	getProgressionTags,
	loadLickProgressHistory,
	loadUserLickTags,
	toggleProgressionTag,
	saveLickPracticeProgress,
	getLickTempo,
	loadLickPracticeProgress
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

/**
 * Read the three passes' signals back from the real stores: the misfit tag
 * pruned, the legacy `practice` override seeded into the tags, the logged
 * session turned into a history point.
 */
function maintenanceRan(): { pruned: boolean; backfilled: boolean; seeded: boolean } {
	return {
		pruned: !getProgressionTags(MISFIT_LICK).includes('ii-V-I-major'),
		backfilled: loadUserLickTags()[LEGACY_LICK]?.includes('practice') ?? false,
		seeded: (loadLickProgressHistory()[LEGACY_LICK] ?? []).length > 0
	};
}

beforeEach(() => {
	store.clear();
	resetSession();
	lickPractice.progress = {};
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

describe('practice startup while cloud progress is loading', () => {
	const savedProgress = {
		[LEGACY_LICK]: { C: { currentTempo: 117, lastPracticedAt: 1000, passCount: 66 } }
	};

	it('loads cached tempo synchronously before the cloud request finishes', async () => {
		saveLickPracticeProgress(savedProgress);
		let finish!: (value: { status: 'empty' }) => void;
		vi.mocked(loadLickMetadataFromCloud).mockReturnValue(new Promise(resolve => { finish = resolve; }));
		const hydration = hydrateLickPracticeProgress(fakeClient, fakeSession);
		const tempoWhileLoading = getLickTempo(lickPractice.progress, LEGACY_LICK);
		finish({ status: 'empty' });
		await hydration;
		expect(tempoWhileLoading).toBe(117);
	});

	it.each(['daily', 'focused', 'deep'] as const)('prevents %s from starting on the 60 BPM fallback', async (mode) => {
		toggleProgressionTag(LEGACY_LICK, 'blues');
		store.set('mankunku:lick-unlock-count', JSON.stringify({ [LEGACY_LICK]: 12 }));
		lickPractice.config.progressionType = 'blues';
		let finish!: (value: Awaited<ReturnType<typeof loadLickMetadataFromCloud>>) => void;
		vi.mocked(loadLickMetadataFromCloud).mockReturnValue(new Promise(resolve => { finish = resolve; }));
		const hydration = hydrateLickPracticeProgress(fakeClient, fakeSession);
		const start = () => mode === 'daily' ? startDailyPracticeSession()
			: mode === 'focused' ? startSession() : startSingleLickSession(LEGACY_LICK);
		start();
		const phaseWhileLoading = lickPractice.phase;
		finish({ status: 'ok', data: {
			lickTags: {}, practiceProgress: savedProgress, tagOverrides: {},
			categoryOverrides: {}, unlockCounts: {}, progressHistory: {}
		}, mergeMeta: {} });
		await hydration;
		expect(phaseWhileLoading).toBe('setup');
		start();
		expect(lickPractice.phase).toBe('count-in');
		expect(lickPractice.currentTempo).toBe(mode === 'deep' ? 115 : 117);
		if (mode !== 'deep') {
			for (let i = 0; i < lickPractice.plan[0].keys.length; i++) {
				lickPractice.currentKeyIndex = i;
				recordKeyAttempt({ overall: 1, pitchAccuracy: 1, rhythmAccuracy: 1 } as Score);
			}
			startInterLickTransition();
			expect(getLickTempo(loadLickPracticeProgress(), LEGACY_LICK)).toBe(119);
		}
	});
});

it('keeps starts blocked until overlapping hydration requests have both settled', async () => {
	const completions: Array<(value: { status: 'empty' }) => void> = [];
	vi.mocked(loadLickMetadataFromCloud).mockImplementation(() => new Promise(resolve => completions.push(resolve)));
	const first = hydrateLickPracticeProgress(fakeClient, fakeSession);
	const second = hydrateLickPracticeProgress(fakeClient, fakeSession);
	completions[0]({ status: 'empty' });
	await first;
	const stillLoading = lickPractice.progressLoading;
	completions[1]({ status: 'empty' });
	await second;
	expect(stillLoading).toBe(true);
	expect(lickPractice.progressLoading).toBe(false);
});

it('releases the start gate after cloud failure and retains the local tempo', async () => {
	saveLickPracticeProgress({ [LEGACY_LICK]: { C: { currentTempo: 117, lastPracticedAt: 1000, passCount: 66 } } });
	vi.mocked(loadLickMetadataFromCloud).mockResolvedValue({ status: 'error' });
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		await hydrateLickPracticeProgress(fakeClient, fakeSession);
		expect(lickPractice.progressLoading).toBe(false);
		expect(getLickTempo(lickPractice.progress, LEGACY_LICK)).toBe(117);
	} finally {
		warn.mockRestore();
	}
});
