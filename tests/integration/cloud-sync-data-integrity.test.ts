/**
 * Cloud sync — data integrity and failure-mode coverage.
 *
 * These tests cover what happens when the cloud returns data the client
 * didn't expect: malformed JSONB, unknown schema fields, null values where
 * the TypeScript types claim non-null, partial failures mid-sync, and local
 * storage quota errors. The goal is to pin down the app's "never crash"
 * contract — sync paths log and fall back rather than throwing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key' }
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import {
	syncProgressToCloud,
	loadProgressFromCloud,
	loadSettingsFromCloud
} from '../../src/lib/persistence/sync';
import type { UserProgress } from '../../src/lib/types/progress';

// ─── Progress fixture (minimum viable) ──────────────────────────────

function makeProgress(): UserProgress {
	return {
		adaptive: {
			currentLevel: 5,
			pitchComplexity: 4,
			rhythmComplexity: 5,
			recentScores: [0.8],
			recentPitchScores: [0.8],
			recentRhythmScores: [0.8],
			attemptsAtLevel: 1,
			attemptsSinceChange: 1,
			pitchAttemptsSinceChange: 1,
			rhythmAttemptsSinceChange: 1
		},
		sessions: [],
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
		totalPracticeTime: 0,
		streakDays: 0,
		lastPracticeDate: '2026-01-01'
	};
}

// ─── Chainable Supabase mock ────────────────────────────────────────

interface ChainResponse {
	maybeSingle?: { data: unknown; error: unknown };
	select?: { data: unknown[] | null; error: unknown };
	upsert?: { error: unknown };
	delete?: { error: unknown };
	storageUpload?: { error: unknown };
}

function chainMock(table: string, response: ChainResponse) {
	const limitFn = vi.fn().mockResolvedValue(response.select ?? { data: [], error: null });
	const orderFn = vi.fn(() => ({ limit: limitFn, data: undefined }));
	const eq2 = vi.fn(() => ({
		maybeSingle: vi.fn().mockResolvedValue(response.maybeSingle ?? { data: null, error: null }),
		order: orderFn,
		limit: limitFn,
		then: (resolve: (v: unknown) => unknown) => resolve(response.select ?? { data: [], error: null })
	}));
	const selectFn = vi.fn(() => ({
		eq: eq2,
		order: orderFn,
		limit: limitFn
	}));
	const upsertFn = vi.fn().mockResolvedValue(response.upsert ?? { error: null });
	const deleteEq = vi.fn(() => ({
		not: vi.fn().mockResolvedValue(response.delete ?? { error: null }),
		then: (resolve: (v: unknown) => unknown) => resolve(response.delete ?? { error: null })
	}));
	const deleteFn = vi.fn(() => ({ eq: deleteEq }));

	return {
		_name: table,
		select: selectFn,
		upsert: upsertFn,
		delete: deleteFn
	};
}

function supabaseWith(
	userId: string | null,
	tables: Record<string, ReturnType<typeof chainMock>>
): unknown {
	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null
			})
		},
		from: vi.fn((table: string) => tables[table] ?? chainMock(table, {})),
		storage: {
			from: vi.fn().mockReturnValue({
				upload: vi.fn().mockResolvedValue({ error: null }),
				list: vi.fn().mockResolvedValue({ data: [], error: null }),
				remove: vi.fn().mockResolvedValue({ error: null })
			})
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Malformed / missing cloud data — loadProgressFromCloud falls back safely
// ---------------------------------------------------------------------------

describe('loadProgressFromCloud — malformed cloud data', () => {
	// The single-query empty/error tri-state is pinned in
	// tests/unit/persistence/sync.test.ts; this describe covers the partial and
	// malformed shapes that file does not.
	it('reports error when session_results fetch fails even though progress loaded', async () => {
		const supabase = supabaseWith('u1', {
			user_progress: chainMock('user_progress', {
				maybeSingle: {
					data: {
						user_id: 'u1',
						adaptive_state: {},
						category_progress: {},
						key_progress: {},
						total_practice_time: 0,
						streak_days: 0,
						last_practice_date: '2026-01-01',
						updated_at: ''
					},
					error: null
				}
			}),
			session_results: chainMock('session_results', {
				select: { data: null, error: { message: 'timeout' } }
			})
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = await loadProgressFromCloud(supabase as never);
		warnSpy.mockRestore();
		// A partial pull (a sub-query errored) is reported as error, not empty.
		expect(result.status).toBe('error');
	});

	it('completes the load when adaptive_state is malformed, keeping the row', async () => {
		// The column is JSONB; a row from a forward-incompatible schema might
		// contain unexpected nesting. The loader returns what it got — the
		// contract is "pass it through and finish the load with status ok",
		// not "validate the shape". A future validator that throws on bad
		// shapes would flip this to status 'error' and fail here.
		const supabase = supabaseWith('u1', {
			user_progress: chainMock('user_progress', {
				maybeSingle: {
					data: {
						user_id: 'u1',
						adaptive_state: 'not-an-object',
						category_progress: {},
						key_progress: {},
						total_practice_time: 42,
						streak_days: 3,
						last_practice_date: '2026-01-01',
						updated_at: ''
					},
					error: null
				}
			}),
			session_results: chainMock('session_results', { select: { data: [], error: null } }),
			scale_proficiency: chainMock('scale_proficiency', { select: { data: [], error: null } }),
			key_proficiency: chainMock('key_proficiency', { select: { data: [], error: null } })
		});

		const result = await loadProgressFromCloud(supabase as never);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.data.adaptive).toBe('not-an-object');
			expect(result.data.totalPracticeTime).toBe(42);
			expect(result.data.streakDays).toBe(3);
		}
	});

	it('ignores extra unknown columns on user_progress (forward-compat)', async () => {
		const supabase = supabaseWith('u1', {
			user_progress: chainMock('user_progress', {
				maybeSingle: {
					data: {
						user_id: 'u1',
						adaptive_state: {},
						category_progress: {},
						key_progress: {},
						total_practice_time: 0,
						streak_days: 0,
						last_practice_date: '2026-01-01',
						updated_at: '',
						// Fields introduced in a newer schema that this client doesn't know about.
						future_feature_flag: true,
						experimental_metric: 99
					},
					error: null
				}
			}),
			session_results: chainMock('session_results', { select: { data: [], error: null } }),
			scale_proficiency: chainMock('scale_proficiency', { select: { data: [], error: null } }),
			key_proficiency: chainMock('key_proficiency', { select: { data: [], error: null } })
		});

		const result = await loadProgressFromCloud(supabase as never);
		expect(result.status).toBe('ok');
	});
});

// ---------------------------------------------------------------------------
// Partial sync failures — writes don't propagate errors
// ---------------------------------------------------------------------------

describe('partial sync failures', () => {
	it('progress upsert succeeds but session_results upsert fails → no throw', async () => {
		const supabase = supabaseWith('u1', {
			user_progress: chainMock('user_progress', { upsert: { error: null } }),
			session_results: chainMock('session_results', {
				upsert: { error: { message: 'session write failed' } }
			})
		});

		const progress = makeProgress();
		progress.sessions = [
			{
				id: 'session-1',
				timestamp: Date.now(),
				phraseId: 'p',
				phraseName: 'P',
				category: 'ii-V-I-major',
				key: 'C',
				tempo: 120,
				difficultyLevel: 5,
				pitchAccuracy: 0.8,
				rhythmAccuracy: 0.8,
				overall: 0.8,
				grade: 'good',
				notesHit: 7,
				notesTotal: 8,
				noteResults: []
			}
		];

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// The batch AND the per-row fallback fail here, so a session row is left
		// unsynced. The function does NOT throw (offline resilience) but returns
		// FALSE so the outbox retries rather than dequeuing a partial push.
		await expect(syncProgressToCloud(supabase as never, progress)).resolves.toBe(false);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('scale_proficiency write failure does not stop key_proficiency write', async () => {
		const keyUpsert = vi.fn().mockResolvedValue({ error: null });
		const supabase = supabaseWith('u1', {
			user_progress: chainMock('user_progress', { upsert: { error: null } }),
			scale_proficiency: chainMock('scale_proficiency', {
				upsert: { error: { message: 'RLS error' } }
			}),
			key_proficiency: Object.assign(chainMock('key_proficiency', {}), {
				upsert: keyUpsert
			})
		});

		const progress = makeProgress();
		progress.scaleProficiency = {
			major: {
				level: 15,
				recentScores: [0.8],
				attemptsAtLevel: 5,
				attemptsSinceChange: 2,
				totalAttempts: 20
			}
		};
		progress.keyProficiency = {
			C: {
				level: 10,
				recentScores: [0.9],
				attemptsAtLevel: 3,
				attemptsSinceChange: 1,
				totalAttempts: 15
			}
		};

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await syncProgressToCloud(supabase as never, progress);
		warnSpy.mockRestore();

		expect(keyUpsert).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Settings integrity — forward-compat and bad data
// ---------------------------------------------------------------------------

describe('loadSettingsFromCloud — bad inputs', () => {
	it('coerces a null backing-track volume to the default 0.6', async () => {
		const supabase = supabaseWith('u1', {
			user_settings: chainMock('user_settings', {
				maybeSingle: {
					data: {
						user_id: 'u1',
						instrument_id: 'tenor-sax',
						default_tempo: 120,
						master_volume: 0.8,
						metronome_enabled: true,
						metronome_volume: 0.6,
						backing_track_enabled: null,
						backing_instrument: null,
						backing_track_volume: null,
						swing: 0.5,
						theme: 'dark',
						onboarding_complete: true,
						tonality_override: null,
						highest_note: null
					},
					error: null
				}
			})
		});

		const result = await loadSettingsFromCloud(supabase as never);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.data.backingTrackVolume).toBe(0.6);
		expect(result.data.backingInstrument).toBe('piano');
		expect(result.data.backingTrackEnabled).toBe(true);
	});
});
