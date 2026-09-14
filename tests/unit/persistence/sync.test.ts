/**
 * Sync Orchestrator Unit Tests
 *
 * Comprehensive tests for `src/lib/persistence/sync.ts`.
 * Covers all 5 non-storage sync functions:
 *   • syncProgressToCloud
 *   • loadProgressFromCloud
 *   • syncSettingsToCloud
 *   • loadSettingsFromCloud
 *   • syncUserLicksToCloud
 *
 * Every Supabase client interaction is fully mocked — no network calls.
 * Tests validate: field mapping (camelCase ↔ snake_case), auth checks,
 * error resilience, the 200-session cap, and JSONB serialization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	syncProgressToCloud,
	loadProgressFromCloud,
	syncSettingsToCloud,
	loadSettingsFromCloud,
	syncUserLicksToCloud,
	syncDailySummaryToCloud,
	syncAllDailySummariesToCloud,
	loadDailySummariesFromCloud,
	deleteDailySummariesFromCloud,
	syncTourStateToCloud,
	loadTourStateFromCloud,
	clearTourStateInCloud,
	upsertLickMetadataRow,
	loadLickMetadataFromCloud,
	syncTrickStateToCloud,
	loadTrickStateFromCloud,
	deleteAllRecordingsFromCloud
} from '$lib/persistence/sync';
import type {
	UserProgress,
	SessionResult,
	ScaleProficiency,
	KeyProficiency,
	AdaptiveState,
	CategoryProgress,
	DailySummary
} from '$lib/types/progress';
import type { Phrase } from '$lib/types/music';
import { MAX_SESSIONS } from '$lib/persistence/limits';

// ═════════════════════════════════════════════════════════════════════
//  Mock Supabase Client Factory
// ═════════════════════════════════════════════════════════════════════

/**
 * Creates a fully chainable mock Supabase client.
 *
 * Each `from(tableName)` call produces an independent query builder so
 * that chained operations on different tables don't interfere.
 *
 * The query builder is **thenable** (has a `.then` method) so that
 * patterns like `await supabase.from('t').select('*').eq('c', v)` work
 * without an explicit terminal method.
 *
 * A *shared* `upsertFn` is used across all builders so that tests can
 * inspect every upsert call via `mock._upsertFn.mock.calls`.
 */
function createMockSupabase(overrides: {
	user?: { id: string } | null;
	upsertResult?: { error: unknown };
	selectResult?: { data: unknown; error: unknown };
	tableResults?: Record<string, { data: unknown; error: unknown }>;
} = {}) {
	const user = overrides.user !== undefined ? overrides.user : { id: 'test-user-id' };
	const upsertResult = overrides.upsertResult ?? { data: null, error: null };
	const defaultSelectResult = overrides.selectResult ?? { data: null, error: null };

	// Shared upsert mock — every builder delegates here so we can track
	// all upsert calls across all tables in a single place.
	const upsertFn = vi.fn().mockResolvedValue(upsertResult);

	const fromFn = vi.fn((tableName: string) => {
		// Resolve the expected result for this table: per-table override
		// takes precedence, then the global selectResult override, then
		// the default { data: null, error: null }.
		const result = overrides.tableResults?.[tableName] ?? defaultSelectResult;

		// Build a query-builder-like object that supports full chaining.
		const builder: Record<string, any> = {};
		builder.select = vi.fn(() => builder);
		builder.eq = vi.fn(() => builder);
		builder.in = vi.fn(() => builder);
		builder.order = vi.fn(() => builder);
		builder.limit = vi.fn(() => builder);
		builder.single = vi.fn().mockResolvedValue(result);
		builder.maybeSingle = vi.fn().mockResolvedValue(result);
		builder.upsert = upsertFn;
		builder.not = vi.fn(() => builder);
		builder.delete = vi.fn(() => builder);

		// Make the builder itself thenable so `await ...eq(...)` resolves
		// to the per-table result without requiring a terminal method.
		builder.then = (resolve: any, reject: any) =>
			Promise.resolve(result).then(resolve, reject);

		return builder;
	});

	return {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user } })
		},
		from: fromFn,
		storage: {
			from: vi.fn().mockReturnValue({
				upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
				download: vi.fn().mockResolvedValue({ data: null, error: null })
			})
		},
		_fromFn: fromFn,
		_upsertFn: upsertFn
	};
}

// ═════════════════════════════════════════════════════════════════════
//  Test Fixtures
// ═════════════════════════════════════════════════════════════════════

const TEST_ADAPTIVE_STATE: AdaptiveState = {
	currentLevel: 15,
	pitchComplexity: 12,
	rhythmComplexity: 8,
	recentScores: [75, 80, 85],
	recentPitchScores: [80, 85, 90],
	recentRhythmScores: [70, 75, 80],
	attemptsAtLevel: 5,
	attemptsSinceChange: 3,
	pitchAttemptsSinceChange: 3,
	rhythmAttemptsSinceChange: 3
};

const TEST_SESSION: SessionResult = {
	id: 'session-001',
	timestamp: Date.now(),
	phraseId: 'blues-001',
	phraseName: 'Blues Call',
	category: 'blues' as any,
	key: 'C' as any,
	scaleType: undefined,
	tempo: 120,
	difficultyLevel: 15,
	pitchAccuracy: 0.85,
	rhythmAccuracy: 0.78,
	overall: 0.82,
	grade: 'good' as any,
	notesHit: 5,
	notesTotal: 6,
	noteResults: [],
	timing: undefined
};

const TEST_PROGRESS: UserProgress = {
	adaptive: TEST_ADAPTIVE_STATE,
	sessions: [TEST_SESSION],
	categoryProgress: {
		blues: {
			category: 'blues' as any,
			attemptsTotal: 10,
			averageScore: 0.75,
			bestScore: 0.92,
			lastAttempt: Date.now()
		}
	},
	keyProgress: {
		C: { attempts: 5, averageScore: 0.8 }
	} as any,
	scaleProficiency: {
		'blues.minor': {
			level: 25,
			recentScores: [0.70, 0.75, 0.80],
			attemptsAtLevel: 8,
			attemptsSinceChange: 3,
			totalAttempts: 20
		} as ScaleProficiency
	} as any,
	keyProficiency: {
		C: {
			level: 30,
			recentScores: [0.80, 0.85],
			attemptsAtLevel: 6,
			attemptsSinceChange: 2,
			totalAttempts: 15
		} as KeyProficiency
	} as any,
	lickProgress: {},
	totalPracticeTime: 3600,
	streakDays: 5,
	lastPracticeDate: '2024-01-15'
};

const TEST_SETTINGS = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	masterVolume: 0.8,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	backingTrackEnabled: false,
	backingInstrument: 'piano',
	backingTrackVolume: 0.5,
	swing: 0.5,
	theme: 'dark',
	onboardingComplete: false,
	tonalityOverride: null,
	highestNote: null,
	backingStyle: 'swing',
	bleedFilterEnabled: false
};

const TEST_LICK: Phrase = {
	id: 'user-1234-abcd',
	name: 'My Blues Lick',
	key: 'C' as any,
	timeSignature: [4, 4] as [number, number],
	notes: [
		{
			pitch: 60,
			duration: [1, 4] as [number, number],
			offset: [0, 1] as [number, number]
		}
	],
	harmony: [],
	difficulty: { level: 10, pitchComplexity: 5, rhythmComplexity: 3, lengthBars: 1 },
	category: 'user' as any,
	tags: ['blues'],
	source: 'user-recorded'
};

// ═════════════════════════════════════════════════════════════════════
//  syncProgressToCloud
// ═════════════════════════════════════════════════════════════════════

describe('syncProgressToCloud', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('upserts progress to user_progress table with correct field mapping', async () => {
		const mock = createMockSupabase();

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		expect(mock._fromFn).toHaveBeenCalledWith('user_progress');

		// Verify the upsert payload uses snake_case column names
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'test-user-id',
				adaptive_state: TEST_PROGRESS.adaptive,
				category_progress: TEST_PROGRESS.categoryProgress,
				key_progress: TEST_PROGRESS.keyProgress,
				total_practice_time: 3600,
				streak_days: 5,
				last_practice_date: '2024-01-15'
			}),
			expect.objectContaining({ onConflict: 'user_id' })
		);
	});

	it('upserts session results to session_results table', async () => {
		const mock = createMockSupabase();

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		expect(mock._fromFn).toHaveBeenCalledWith('session_results');

		// Verify at least one upsert call includes the session row data
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					user_id: 'test-user-id',
					phrase_id: 'blues-001',
					phrase_name: 'Blues Call',
					difficulty_level: 15,
					pitch_accuracy: 0.85,
					rhythm_accuracy: 0.78,
					notes_hit: 5,
					notes_total: 6
				})
			]),
			expect.objectContaining({ onConflict: 'id' })
		);
	});

	it('returns early when user is not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		// No database operation should occur
		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('catches errors and logs warning, does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			upsertResult: { error: { message: 'Database unavailable' } }
		});

		// New contract: syncProgressToCloud returns a boolean (false on a caught
		// error) instead of void. Still never throws.
		await expect(
			syncProgressToCloud(mock as any, TEST_PROGRESS)
		).resolves.toBe(false);

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('only syncs the latest MAX_SESSIONS sessions', async () => {
		const mock = createMockSupabase();

		// Build progress with 250 sessions
		const manySessions: SessionResult[] = Array.from({ length: 250 }, (_, i) => ({
			...TEST_SESSION,
			id: `session-${i}`,
			timestamp: Date.now() - i * 1000
		}));
		const bigProgress: UserProgress = {
			...TEST_PROGRESS,
			sessions: manySessions
		};

		await syncProgressToCloud(mock as any, bigProgress);

		// Find the upsert call whose first argument is an array of
		// session-shaped objects (i.e. has `phrase_id`).
		const sessionUpsertCalls = mock._upsertFn.mock.calls.filter(
			(call: any[]) =>
				Array.isArray(call[0]) && call[0].length > 0 && call[0][0]?.phrase_id
		);

		expect(sessionUpsertCalls.length).toBeGreaterThan(0);
		// Was `toBeLessThanOrEqual(200)` against a cap of 100 — it passed no
		// matter what the cap did. Pinned to the shared constant instead.
		expect(sessionUpsertCalls[0][0].length).toBe(MAX_SESSIONS);
	});

	it('upserts scale proficiency entries', async () => {
		const mock = createMockSupabase();

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		expect(mock._fromFn).toHaveBeenCalledWith('scale_proficiency');

		// Verify the scale row shape
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					user_id: 'test-user-id',
					scale_id: 'blues.minor',
					level: 25,
					recent_scores: [70, 75, 80],
					attempts_at_level: 8,
					attempts_since_change: 3,
					total_attempts: 20
				})
			]),
			expect.objectContaining({ onConflict: 'user_id,scale_id' })
		);
	});

	it('upserts key proficiency entries', async () => {
		const mock = createMockSupabase();

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		expect(mock._fromFn).toHaveBeenCalledWith('key_proficiency');

		// Verify the key row shape
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					user_id: 'test-user-id',
					key: 'C',
					level: 30,
					recent_scores: [80, 85],
					attempts_at_level: 6,
					attempts_since_change: 2,
					total_attempts: 15
				})
			]),
			expect.objectContaining({ onConflict: 'user_id,key' })
		);
	});

	it('handles empty sessions and proficiency maps', async () => {
		const mock = createMockSupabase();
		const emptyProgress: UserProgress = {
			...TEST_PROGRESS,
			sessions: [],
			scaleProficiency: {} as any,
			keyProficiency: {} as any
		};

		// New contract: a clean sync resolves to true (was void).
		await expect(
			syncProgressToCloud(mock as any, emptyProgress)
		).resolves.toBe(true);

		// user_progress should still be upserted
		expect(mock._fromFn).toHaveBeenCalledWith('user_progress');
	});

	it('includes updated_at timestamp in the progress row', async () => {
		const mock = createMockSupabase();

		await syncProgressToCloud(mock as any, TEST_PROGRESS);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({
				updated_at: expect.any(String)
			}),
			expect.objectContaining({ onConflict: 'user_id' })
		);
	});

	it('falls back to per-row session upserts when the batch fails, and reports success when every row lands', async () => {
		// One poisoned id (a legacy global-id collision with another user's row)
		// fails the WHOLE batch with 42501. The fallback must retry each row on
		// its own so one bad row cannot freeze session sync — and when the
		// per-row pass succeeds, the outbox may dequeue (true).
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		const sessions = [
			{ ...TEST_SESSION, id: 'session-a' },
			{ ...TEST_SESSION, id: 'session-b' },
			{ ...TEST_SESSION, id: 'session-c' }
		];
		mock._upsertFn.mockImplementation(async (rows: unknown) =>
			Array.isArray(rows) && rows.length > 1 && (rows[0] as { phrase_id?: string }).phrase_id
				? { error: { code: '42501', message: 'row-level security' } }
				: { data: null, error: null }
		);

		await expect(
			syncProgressToCloud(mock as any, { ...TEST_PROGRESS, sessions })
		).resolves.toBe(true);

		const perRow = mock._upsertFn.mock.calls.filter(
			(call: any[]) => !Array.isArray(call[0]) && call[0]?.phrase_id
		);
		expect(perRow.map((call: any[]) => call[0].id)).toEqual(['session-a', 'session-b', 'session-c']);
		for (const call of perRow) expect(call[1]).toEqual({ onConflict: 'id' });
		warnSpy.mockRestore();
	});
});

// ═════════════════════════════════════════════════════════════════════
//  loadProgressFromCloud
// ═════════════════════════════════════════════════════════════════════

describe('loadProgressFromCloud', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches progress and maps snake_case to camelCase', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_progress: {
					data: {
						user_id: 'test-user-id',
						adaptive_state: TEST_ADAPTIVE_STATE,
						category_progress: TEST_PROGRESS.categoryProgress,
						key_progress: TEST_PROGRESS.keyProgress,
						total_practice_time: 3600,
						streak_days: 5,
						last_practice_date: '2024-01-15',
						updated_at: '2024-01-15T12:00:00Z'
					},
					error: null
				},
				session_results: {
					data: [
						{
							id: 'session-001',
							user_id: 'test-user-id',
							phrase_id: 'blues-001',
							phrase_name: 'Blues Call',
							category: 'blues',
							key: 'C',
							scale_type: null,
							tempo: 120,
							difficulty_level: 15,
							pitch_accuracy: 0.85,
							rhythm_accuracy: 0.78,
							overall: 0.82,
							grade: 'good',
							notes_hit: 5,
							notes_total: 6,
							note_results: [],
							timing: null,
							timestamp: Date.now()
						}
					],
					error: null
				},
				scale_proficiency: {
					data: [
						{
							user_id: 'test-user-id',
							scale_id: 'blues.minor',
							level: 25,
							recent_scores: [70, 75, 80],
							attempts_at_level: 8,
							attempts_since_change: 3,
							total_attempts: 20
						}
					],
					error: null
				},
				key_proficiency: {
					data: [
						{
							user_id: 'test-user-id',
							key: 'C',
							level: 30,
							recent_scores: [80, 85],
							attempts_at_level: 6,
							attempts_since_change: 2,
							total_attempts: 15
						}
					],
					error: null
				}
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			const data = result.data;
			// Aggregate progress fields
			expect(data.totalPracticeTime).toBe(3600);
			expect(data.streakDays).toBe(5);
			expect(data.lastPracticeDate).toBe('2024-01-15');
			expect(data.adaptive).toEqual(TEST_ADAPTIVE_STATE);
			expect(data.categoryProgress).toEqual(TEST_PROGRESS.categoryProgress);
			expect(data.keyProgress).toEqual(TEST_PROGRESS.keyProgress);

			// Session results mapped from snake_case
			expect(data.sessions).toHaveLength(1);
			expect(data.sessions[0].phraseId).toBe('blues-001');
			expect(data.sessions[0].phraseName).toBe('Blues Call');
			expect(data.sessions[0].pitchAccuracy).toBe(0.85);
			expect(data.sessions[0].rhythmAccuracy).toBe(0.78);
			expect(data.sessions[0].notesHit).toBe(5);
			expect(data.sessions[0].notesTotal).toBe(6);
			expect(data.sessions[0].difficultyLevel).toBe(15);

			// Scale proficiency mapped from snake_case
			const bluesMinor = (data.scaleProficiency as Record<string, ScaleProficiency | undefined>)?.['blues.minor'];
			expect(bluesMinor).toBeDefined();
			if (bluesMinor) {
				expect(bluesMinor.level).toBe(25);
				expect(bluesMinor.recentScores).toEqual([0.70, 0.75, 0.80]);
				expect(bluesMinor.attemptsAtLevel).toBe(8);
				expect(bluesMinor.attemptsSinceChange).toBe(3);
				expect(bluesMinor.totalAttempts).toBe(20);
			}

			// Key proficiency mapped from snake_case
			const cKey = (data.keyProficiency as Record<string, KeyProficiency | undefined>)?.['C'];
			expect(cKey).toBeDefined();
			if (cKey) {
				expect(cKey.level).toBe(30);
				expect(cKey.recentScores).toEqual([0.80, 0.85]);
				expect(cKey.attemptsAtLevel).toBe(6);
				expect(cKey.attemptsSinceChange).toBe(2);
				expect(cKey.totalAttempts).toBe(15);
			}
		}
	});

	it('reports error when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		const result = await loadProgressFromCloud(mock as any);

		// Unauthenticated → 'error' (cloud truth unknown), and no query is issued.
		expect(result.status).toBe('error');
		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('reports error on database error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: {
				user_progress: { data: null, error: { message: 'Table not found' } }
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		expect(result.status).toBe('error');
		warnSpy.mockRestore();
	});

	it('reports empty when no progress row exists', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_progress: { data: null, error: null }
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		// No row (data:null,error:null) is an affirmative empty, not an error.
		expect(result.status).toBe('empty');
	});

	it('returns progress with empty sessions when session_results table is empty', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_progress: {
					data: {
						user_id: 'test-user-id',
						adaptive_state: TEST_ADAPTIVE_STATE,
						category_progress: {},
						key_progress: {},
						total_practice_time: 0,
						streak_days: 0,
						last_practice_date: '',
						updated_at: '2024-01-15T12:00:00Z'
					},
					error: null
				},
				session_results: { data: [], error: null },
				scale_proficiency: { data: [], error: null },
				key_proficiency: { data: [], error: null }
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.data.sessions).toEqual([]);
			expect(result.data.scaleProficiency).toEqual({});
			expect(result.data.keyProficiency).toEqual({});
		}
	});
});

// ═════════════════════════════════════════════════════════════════════
//  syncSettingsToCloud
// ═════════════════════════════════════════════════════════════════════

describe('syncSettingsToCloud', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('upserts settings to user_settings with snake_case mapping', async () => {
		const mock = createMockSupabase();

		await syncSettingsToCloud(mock as any, TEST_SETTINGS);

		expect(mock._fromFn).toHaveBeenCalledWith('user_settings');
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({
				user_id: 'test-user-id',
				instrument_id: 'tenor-sax',
				default_tempo: 100,
				master_volume: 0.8,
				metronome_enabled: true,
				metronome_volume: 0.7,
				backing_track_enabled: false,
				backing_instrument: 'piano',
				backing_track_volume: 0.5,
				swing: 0.5,
				theme: 'dark',
				onboarding_complete: false
			}),
			expect.objectContaining({ onConflict: 'user_id' })
		);
	});

	it('returns early when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		await syncSettingsToCloud(mock as any, TEST_SETTINGS);

		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('catches errors and does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			upsertResult: { error: { message: 'Permission denied' } }
		});

		// New contract: syncSettingsToCloud returns false on a caught error
		// (was void). Still never throws.
		await expect(
			syncSettingsToCloud(mock as any, TEST_SETTINGS)
		).resolves.toBe(false);

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('maps tonalityOverride null to tonality_override null', async () => {
		const mock = createMockSupabase();

		await syncSettingsToCloud(mock as any, { ...TEST_SETTINGS, tonalityOverride: null });

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({ tonality_override: null }),
			expect.any(Object)
		);
	});

	it('maps highestNote null to highest_note null', async () => {
		const mock = createMockSupabase();

		await syncSettingsToCloud(mock as any, { ...TEST_SETTINGS, highestNote: null });

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({ highest_note: null }),
			expect.any(Object)
		);
	});

	it('maps highestNote number to highest_note number', async () => {
		const mock = createMockSupabase();

		await syncSettingsToCloud(mock as any, { ...TEST_SETTINGS, highestNote: 72 });

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({ highest_note: 72 }),
			expect.any(Object)
		);
	});
});

// ═════════════════════════════════════════════════════════════════════
//  loadSettingsFromCloud
// ═════════════════════════════════════════════════════════════════════

describe('loadSettingsFromCloud', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches settings and maps snake_case to camelCase', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: {
						user_id: 'test-user-id',
						instrument_id: 'alto-sax',
						default_tempo: 110,
						master_volume: 0.9,
						metronome_enabled: false,
						metronome_volume: 0.6,
						backing_track_enabled: true,
						backing_instrument: 'bass',
						backing_track_volume: 0.7,
						swing: 0.6,
						theme: 'light',
						onboarding_complete: true,
						tonality_override: null,
						highest_note: null,
						updated_at: '2024-01-15T12:00:00Z'
					},
					error: null
				}
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			const data = result.data;
			expect(data.instrumentId).toBe('alto-sax');
			expect(data.defaultTempo).toBe(110);
			expect(data.masterVolume).toBe(0.9);
			expect(data.metronomeEnabled).toBe(false);
			expect(data.metronomeVolume).toBe(0.6);
			expect(data.backingTrackEnabled).toBe(true);
			expect(data.backingInstrument).toBe('bass');
			expect(data.backingTrackVolume).toBe(0.7);
			expect(data.swing).toBe(0.6);
			expect(data.theme).toBe('light');
			expect(data.onboardingComplete).toBe(true);
			expect(data.tonalityOverride).toBeNull();
			expect(data.highestNote).toBeNull();
		}
	});

	it('maps highest_note number to highestNote', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: {
						user_id: 'test-user-id',
						instrument_id: 'tenor-sax',
						default_tempo: 100,
						master_volume: 0.8,
						metronome_enabled: true,
						metronome_volume: 0.7,
						swing: 0.5,
						theme: 'dark',
						onboarding_complete: false,
						tonality_override: null,
						highest_note: 72,
						updated_at: '2024-01-15T12:00:00Z'
					},
					error: null
				}
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') expect(result.data.highestNote).toBe(72);
	});

	it('reports error when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		const result = await loadSettingsFromCloud(mock as any);

		// Unauthenticated → 'error' (cloud truth unknown), not 'empty'.
		expect(result.status).toBe('error');
		// …and it bails before querying user_settings (mirrors the progress test).
		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('reports empty when no settings found in DB', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: { data: null, error: null }
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		// No row (data:null,error:null) is an affirmative empty, not an error.
		expect(result.status).toBe('empty');
	});

	it('reports error on query failure', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: {
				user_settings: { data: null, error: { message: 'RLS violation' } }
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result.status).toBe('error');
		warnSpy.mockRestore();
	});
});

// ═════════════════════════════════════════════════════════════════════
//  syncUserLicksToCloud
// ═════════════════════════════════════════════════════════════════════

describe('syncUserLicksToCloud', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('upserts user licks to user_licks table with snake_case mapping', async () => {
		const mock = createMockSupabase();

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(mock._fromFn).toHaveBeenCalledWith('user_licks');
		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'user-1234-abcd',
					user_id: 'test-user-id',
					name: 'My Blues Lick',
					key: 'C',
					category: 'user',
					source: 'user-recorded',
					tags: ['blues']
				})
			]),
			expect.objectContaining({ onConflict: 'id' })
		);
	});

	it('maps complex fields to JSONB-compatible format', async () => {
		const mock = createMockSupabase();

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					time_signature: [4, 4],
					notes: TEST_LICK.notes,
					harmony: TEST_LICK.harmony,
					difficulty: TEST_LICK.difficulty
				})
			]),
			expect.any(Object)
		);
	});

	it('returns early when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('catches errors and does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			upsertResult: { error: { message: 'Table locked' } }
		});

		await expect(
			syncUserLicksToCloud(mock as any, [TEST_LICK])
		).resolves.toBeUndefined();

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('sets audio_url to null for each lick', async () => {
		const mock = createMockSupabase();

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					audio_url: null
				})
			]),
			expect.any(Object)
		);
	});

	it('writes the mode column (null when the lick never stated one)', async () => {
		const mock = createMockSupabase();

		await syncUserLicksToCloud(mock as any, [TEST_LICK, { ...TEST_LICK, id: 'minor-lick', mode: 'minor' }]);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ id: TEST_LICK.id, mode: null }),
				expect.objectContaining({ id: 'minor-lick', mode: 'minor' })
			]),
			expect.any(Object)
		);
	});

	it('includes updated_at timestamp in each lick row', async () => {
		const mock = createMockSupabase();

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					updated_at: expect.any(String)
				})
			]),
			expect.any(Object)
		);
	});

	it('scopes the ownership probe to the current user_id', async () => {
		// Migration 00013 opened SELECT on user_licks to any authenticated user
		// for community browse. The owned/unknown classification must filter
		// by user_id explicitly — otherwise a local id colliding with another
		// user's cloud row would be misclassified as "owned" and trigger an
		// RLS 42501 on the ON CONFLICT DO UPDATE path.
		const eqCalls: Array<[string, unknown]> = [];
		const inCalls: Array<[string, unknown]> = [];

		const upsertFn = vi.fn().mockResolvedValue({ data: null, error: null });
		const fromFn = vi.fn(() => {
			const builder: Record<string, any> = {};
			builder.select = vi.fn(() => builder);
			builder.eq = vi.fn((col: string, val: unknown) => {
				eqCalls.push([col, val]);
				return builder;
			});
			builder.in = vi.fn((col: string, val: unknown) => {
				inCalls.push([col, val]);
				return builder;
			});
			builder.upsert = upsertFn;
			builder.then = (resolve: any, reject: any) =>
				Promise.resolve({ data: [], error: null }).then(resolve, reject);
			return builder;
		});

		const mock = {
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }) },
			from: fromFn
		};

		await syncUserLicksToCloud(mock as any, [TEST_LICK]);

		expect(eqCalls).toContainEqual(['user_id', 'test-user-id']);
		expect(inCalls).toContainEqual(['id', ['user-1234-abcd']]);
	});
});

// ═════════════════════════════════════════════════════════════════════
//  Daily-summary sync tests
// ═════════════════════════════════════════════════════════════════════

const TEST_SUMMARY: DailySummary = {
	date: '2026-04-30',
	sessionCount: 5,
	earTrainingSessions: 3,
	lickPracticeSessions: 2,
	practiceMinutes: 10,
	avgOverall: 0.81,
	avgPitch: 0.82,
	avgRhythm: 0.80,
	bestScore: 0.95,
	notesTotal: 40,
	notesHit: 33,
	grades: { perfect: 1, great: 1, good: 2, fair: 1, tryAgain: 0 },
	categories: { 'ii-V-I-major': 3, 'blues': 2 },
	pitchComplexity: 14,
	rhythmComplexity: 12
};

describe('syncDailySummaryToCloud', () => {
	it('upserts a single row keyed on (user_id, date) with the right payload', async () => {
		const mock = createMockSupabase();
		await syncDailySummaryToCloud(mock as any, TEST_SUMMARY);

		expect(mock._fromFn).toHaveBeenCalledWith('daily_summaries');
		expect(mock._upsertFn).toHaveBeenCalledTimes(1);
		const [row, opts] = mock._upsertFn.mock.calls[0];
		expect(opts).toEqual({ onConflict: 'user_id,date', defaultToNull: false });
		expect(row.user_id).toBe('test-user-id');
		expect(row.date).toBe('2026-04-30');
		expect(row.session_count).toBe(5);
		expect(row.ear_training_sessions).toBe(3);
		expect(row.lick_practice_sessions).toBe(2);
		expect(row.pitch_complexity).toBe(14);
		expect(row.rhythm_complexity).toBe(12);
	});

	it('omits absent snapshot columns so the upsert cannot null another device’s values', async () => {
		// Snapshot fields aren't derivable — absent means "this device never
		// knew", not "cleared". A null here would ride the (user_id,date)
		// conflict update and erase the stored snapshot (the 2026-07-13
		// incident class, push-side edition).
		const mock = createMockSupabase();
		const lickOnly: DailySummary = {
			...TEST_SUMMARY,
			pitchComplexity: undefined,
			rhythmComplexity: undefined
		};
		await syncDailySummaryToCloud(mock as any, lickOnly);
		const [row] = mock._upsertFn.mock.calls[0];
		expect(row).not.toHaveProperty('pitch_complexity');
		expect(row).not.toHaveProperty('rhythm_complexity');
		expect(row).not.toHaveProperty('tonal_mastery');
		expect(row).not.toHaveProperty('scale_levels');
	});

	it('encodes the per-scale level snapshot (a forgotten mapper column would erase it on the next pull)', async () => {
		const mock = createMockSupabase();
		await syncDailySummaryToCloud(mock as any, {
			...TEST_SUMMARY,
			scaleLevels: { major: 14, dorian: 3 }
		});
		const [row] = mock._upsertFn.mock.calls[0];
		expect(row.scale_levels).toEqual({ major: 14, dorian: 3 });
	});

	it('skips when unauthenticated', async () => {
		const mock = createMockSupabase({ user: null });
		await syncDailySummaryToCloud(mock as any, TEST_SUMMARY);
		expect(mock._upsertFn).not.toHaveBeenCalled();
	});

	it('falls back ear_training_sessions to sessionCount when the split is missing', async () => {
		// Pre-split summary saved by an older client
		const mock = createMockSupabase();
		const preSplit: DailySummary = {
			...TEST_SUMMARY,
			earTrainingSessions: undefined,
			lickPracticeSessions: undefined
		};
		await syncDailySummaryToCloud(mock as any, preSplit);
		const [row] = mock._upsertFn.mock.calls[0];
		// Should not push undefined into NOT NULL columns.
		expect(row.ear_training_sessions).toBe(preSplit.sessionCount);
		expect(row.lick_practice_sessions).toBe(0);
	});
});

describe('syncAllDailySummariesToCloud', () => {
	it('bulk-upserts every summary in one call', async () => {
		const mock = createMockSupabase();
		const day2 = { ...TEST_SUMMARY, date: '2026-04-29' };
		await syncAllDailySummariesToCloud(mock as any, [TEST_SUMMARY, day2]);
		expect(mock._upsertFn).toHaveBeenCalledTimes(1);
		const [rows, opts] = mock._upsertFn.mock.calls[0];
		expect(Array.isArray(rows)).toBe(true);
		expect(rows).toHaveLength(2);
		expect(opts).toEqual({ onConflict: 'user_id,date', defaultToNull: false });
	});

	it('splits mixed-shape batches so a row without snapshots cannot null another day’s (two-device flush)', async () => {
		// supabase-js unions the keys of a bulk payload: batching a
		// snapshot-less day with a snapshot-bearing one would re-introduce
		// nulls (or DEFAULTs) for the missing keys on the conflict update.
		// Rows must go up grouped by identical key shape.
		const mock = createMockSupabase();
		const withSnapshot: DailySummary = {
			...TEST_SUMMARY,
			date: '2026-04-28',
			scaleLevels: { major: 14 },
			tonalMastery: 6.5
		};
		const withoutSnapshot: DailySummary = {
			...TEST_SUMMARY,
			date: '2026-04-29',
			pitchComplexity: undefined,
			rhythmComplexity: undefined
		};
		await syncAllDailySummariesToCloud(mock as any, [withSnapshot, withoutSnapshot]);

		expect(mock._upsertFn).toHaveBeenCalledTimes(2);
		const batches = mock._upsertFn.mock.calls.map(([rows]) => rows);
		const flat = batches.flat();
		expect(flat).toHaveLength(2);
		const snapRow = flat.find((r: { date: string }) => r.date === '2026-04-28');
		const bareRow = flat.find((r: { date: string }) => r.date === '2026-04-29');
		expect(snapRow.scale_levels).toEqual({ major: 14 });
		expect(snapRow.tonal_mastery).toBe(6.5);
		expect(bareRow).not.toHaveProperty('scale_levels');
		expect(bareRow).not.toHaveProperty('pitch_complexity');
		// The two shapes never share a batch.
		for (const rows of batches) {
			const shapes = new Set(rows.map((r: object) => Object.keys(r).sort().join()));
			expect(shapes.size).toBe(1);
		}
	});

	it('is a no-op on empty input', async () => {
		const mock = createMockSupabase();
		await syncAllDailySummariesToCloud(mock as any, []);
		expect(mock._upsertFn).not.toHaveBeenCalled();
	});

	it('skips when unauthenticated even with summaries to push', async () => {
		const mock = createMockSupabase({ user: null });
		await syncAllDailySummariesToCloud(mock as any, [TEST_SUMMARY]);
		expect(mock._upsertFn).not.toHaveBeenCalled();
	});
});

describe('loadDailySummariesFromCloud', () => {
	it('maps snake_case columns back to DailySummary camelCase fields', async () => {
		const cloudRow = {
			date: '2026-04-30',
			session_count: 5,
			ear_training_sessions: 3,
			lick_practice_sessions: 2,
			practice_minutes: 10,
			avg_overall: 0.81,
			avg_pitch: 0.82,
			avg_rhythm: 0.80,
			best_score: 0.95,
			notes_total: 40,
			notes_hit: 33,
			grades: { perfect: 1, great: 1, good: 2, fair: 1, tryAgain: 0 },
			categories: { 'ii-V-I-major': 3, blues: 2 },
			pitch_complexity: 14,
			rhythm_complexity: 12
		};
		const mock = createMockSupabase({
			tableResults: { daily_summaries: { data: [cloudRow], error: null } }
		});
		const out = await loadDailySummariesFromCloud(mock as any);
		expect(out).not.toBeNull();
		expect(out).toHaveLength(1);
		const s = out![0];
		expect(s.date).toBe('2026-04-30');
		expect(s.sessionCount).toBe(5);
		expect(s.earTrainingSessions).toBe(3);
		expect(s.lickPracticeSessions).toBe(2);
		expect(s.pitchComplexity).toBe(14);
		expect(s.rhythmComplexity).toBe(12);
	});

	it('decodes null pitch/rhythm complexity columns as undefined', async () => {
		const cloudRow = {
			date: '2026-04-30',
			session_count: 1,
			ear_training_sessions: 0,
			lick_practice_sessions: 1,
			practice_minutes: 2,
			avg_overall: 0.7,
			avg_pitch: 0.7,
			avg_rhythm: 0.7,
			best_score: 0.7,
			notes_total: 8,
			notes_hit: 6,
			grades: { perfect: 0, great: 0, good: 1, fair: 0, tryAgain: 0 },
			categories: { 'ii-V-I-major': 1 },
			pitch_complexity: null,
			rhythm_complexity: null
		};
		const mock = createMockSupabase({
			tableResults: { daily_summaries: { data: [cloudRow], error: null } }
		});
		const out = await loadDailySummariesFromCloud(mock as any);
		expect(out![0].pitchComplexity).toBeUndefined();
		expect(out![0].rhythmComplexity).toBeUndefined();
		expect(out![0].scaleLevels).toBeUndefined();
	});

	it('round-trips the per-scale level snapshot through the row mappers', async () => {
		const mock = createMockSupabase();
		await syncDailySummaryToCloud(mock as any, {
			...TEST_SUMMARY,
			scaleLevels: { major: 14 }
		});
		const [pushed] = mock._upsertFn.mock.calls[0];

		const readMock = createMockSupabase({
			tableResults: { daily_summaries: { data: [pushed], error: null } }
		});
		const out = await loadDailySummariesFromCloud(readMock as any);
		expect(out![0].scaleLevels).toEqual({ major: 14 });
	});

	it('returns null when unauthenticated', async () => {
		const mock = createMockSupabase({ user: null });
		const out = await loadDailySummariesFromCloud(mock as any);
		expect(out).toBeNull();
	});

	it('returns null (not []) on a query error — history flush must defer, never push over an unread cloud', async () => {
		// history.svelte.ts's flushDailySummariesToCloud throws on null so the
		// outbox retries; an [] here would read as "cloud is empty" and push the
		// local set as authoritative (the 2026-07-13 class).
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: { daily_summaries: { data: null, error: { message: 'timeout' } } }
		});
		expect(await loadDailySummariesFromCloud(mock as any)).toBeNull();
		warnSpy.mockRestore();
	});

	it('returns [] when the read succeeds with no rows (an affirmatively empty account)', async () => {
		const mock = createMockSupabase({
			tableResults: { daily_summaries: { data: [], error: null } }
		});
		expect(await loadDailySummariesFromCloud(mock as any)).toEqual([]);
	});
});

// ═════════════════════════════════════════════════════════════════════
//  Lick-metadata row (the durable-outbox write path + tri-state read)
// ═════════════════════════════════════════════════════════════════════

const TEST_LICK_METADATA = {
	lickTags: { 'lick-1': ['practice', 'prog:blues'] },
	practiceProgress: { 'lick-1': { C: { currentTempo: 120, lastPracticedAt: 5, passCount: 1 } } },
	tagOverrides: {},
	categoryOverrides: {},
	unlockCounts: { 'lick-1': 3 },
	progressHistory: {}
};

describe('upsertLickMetadataRow', () => {
	it('writes every blob plus merge_meta keyed on user_id', async () => {
		const mock = createMockSupabase();
		await upsertLickMetadataRow(mock as any, TEST_LICK_METADATA as any, { tags: { 'lick-1': 99 } });

		expect(mock._fromFn).toHaveBeenCalledWith('user_lick_metadata');
		const [row, opts] = mock._upsertFn.mock.calls[0];
		expect(opts).toEqual({ onConflict: 'user_id' });
		expect(row).toMatchObject({
			user_id: 'test-user-id',
			lick_tags: TEST_LICK_METADATA.lickTags,
			practice_progress: TEST_LICK_METADATA.practiceProgress,
			unlock_counts: TEST_LICK_METADATA.unlockCounts,
			merge_meta: { tags: { 'lick-1': 99 } }
		});
	});

	it('THROWS when unauthenticated so the outbox keeps the intent (never a silent no-op)', async () => {
		const mock = createMockSupabase({ user: null });
		await expect(
			upsertLickMetadataRow(mock as any, TEST_LICK_METADATA as any, {})
		).rejects.toThrow(/not authenticated/);
		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('THROWS on an upsert error so the outbox backs off and retries', async () => {
		const mock = createMockSupabase({ upsertResult: { error: { message: 'RLS violation' } } });
		await expect(
			upsertLickMetadataRow(mock as any, TEST_LICK_METADATA as any, {})
		).rejects.toThrow(/RLS violation/);
	});
});

describe('loadLickMetadataFromCloud', () => {
	it('coalesces null legacy columns (pre-00015 rows) to empty blobs instead of failing the load', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_lick_metadata: {
					data: {
						user_id: 'test-user-id',
						lick_tags: { a: ['practice'] },
						practice_progress: null,
						tag_overrides: null,
						category_overrides: null,
						unlock_counts: null,
						progress_history: null,
						merge_meta: null
					},
					error: null
				}
			}
		});
		const result = await loadLickMetadataFromCloud(mock as any);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.data).toEqual({
			lickTags: { a: ['practice'] },
			practiceProgress: {},
			tagOverrides: {},
			categoryOverrides: {},
			unlockCounts: {},
			progressHistory: {}
		});
		expect(result.mergeMeta).toEqual({});
	});

	it('reports empty on no row, and error on a query failure or unverifiable auth', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const empty = createMockSupabase({
			tableResults: { user_lick_metadata: { data: null, error: null } }
		});
		expect((await loadLickMetadataFromCloud(empty as any)).status).toBe('empty');

		const failed = createMockSupabase({
			tableResults: { user_lick_metadata: { data: null, error: { message: 'down' } } }
		});
		expect((await loadLickMetadataFromCloud(failed as any)).status).toBe('error');

		const unauth = createMockSupabase({ user: null });
		expect((await loadLickMetadataFromCloud(unauth as any)).status).toBe('error');
		expect(unauth._fromFn).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

// ═════════════════════════════════════════════════════════════════════
//  Trick-state column (the durable-outbox write path + tri-state read)
// ═════════════════════════════════════════════════════════════════════

const TEST_TRICK_STATE = {
	selectedVariants: ['enclosures:type=major'],
	selectedUpdatedAt: 10,
	migrations: ['enclosure-type-v1'],
	progress: { 'enclosures:type=major': { C: { currentTempo: 66, lastPracticedAt: 3, passCount: 1 } } },
	unlockCounts: { 'enclosures:type=major': 2 },
	history: { 'enclosures:type=major': [{ t: 1, bpm: 60, keys: 1 }] }
};

describe('syncTrickStateToCloud', () => {
	it('writes the blob wholesale as a partial user_settings upsert', async () => {
		const mock = createMockSupabase();
		await syncTrickStateToCloud(mock as any, TEST_TRICK_STATE);
		expect(mock._fromFn).toHaveBeenCalledWith('user_settings');
		const [row, opts] = mock._upsertFn.mock.calls[0];
		expect(opts).toEqual({ onConflict: 'user_id' });
		expect(row.trick_state).toEqual(TEST_TRICK_STATE);
		expect(Object.keys(row).sort()).toEqual(['trick_state', 'updated_at', 'user_id']);
	});

	it('THROWS when unauthenticated and on an upsert error (outbox contract)', async () => {
		const unauth = createMockSupabase({ user: null });
		await expect(syncTrickStateToCloud(unauth as any, TEST_TRICK_STATE)).rejects.toThrow(
			/not authenticated/
		);
		expect(unauth._fromFn).not.toHaveBeenCalled();

		const failed = createMockSupabase({ upsertResult: { error: { message: 'quota' } } });
		await expect(syncTrickStateToCloud(failed as any, TEST_TRICK_STATE)).rejects.toThrow(/quota/);
	});
});

describe('loadTrickStateFromCloud', () => {
	it('reports missing on no row, error on a query failure, error on unverifiable auth', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const missing = createMockSupabase({
			tableResults: { user_settings: { data: null, error: null } }
		});
		expect((await loadTrickStateFromCloud(missing as any)).status).toBe('missing');

		const failed = createMockSupabase({
			tableResults: { user_settings: { data: null, error: { message: 'down' } } }
		});
		expect((await loadTrickStateFromCloud(failed as any)).status).toBe('error');

		const unauth = createMockSupabase({ user: null });
		expect((await loadTrickStateFromCloud(unauth as any)).status).toBe('error');
		warnSpy.mockRestore();
	});

	it('reads a row whose column was never written as ok + all-empty (not missing)', async () => {
		const mock = createMockSupabase({
			tableResults: { user_settings: { data: { trick_state: null }, error: null } }
		});
		expect(await loadTrickStateFromCloud(mock as any)).toEqual({
			status: 'ok',
			data: {
				selectedVariants: [],
				selectedUpdatedAt: 0,
				migrations: [],
				progress: {},
				unlockCounts: {},
				history: {}
			}
		});
	});

	it('narrows every sub-field — malformed entries are dropped, never trusted', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: {
						trick_state: {
							selectedVariants: ['v1', 42, null],
							selectedUpdatedAt: 'not-a-number',
							migrations: ['m1', {}],
							progress: {
								v1: {
									C: { currentTempo: 60, lastPracticedAt: 1, passCount: 1 },
									Gb: { currentTempo: 40, lastPracticedAt: 1, passCount: 1 }, // non-canonical key
									F: { currentTempo: 'fast', lastPracticedAt: 1, passCount: 1 }, // NaN tempo
									G: 'garbage'
								},
								v2: 'not-an-object'
							},
							unlockCounts: { v1: 3, v2: 'three', v3: Infinity },
							history: {
								v1: [{ t: 1, bpm: 60, keys: 1 }, { t: 'x', bpm: 60, keys: 1 }, 'junk'],
								v2: 'not-an-array'
							}
						}
					},
					error: null
				}
			}
		});
		const result = await loadTrickStateFromCloud(mock as any);
		expect(result.status).toBe('ok');
		if (result.status !== 'ok') return;
		expect(result.data.selectedVariants).toEqual(['v1']);
		expect(result.data.selectedUpdatedAt).toBe(0);
		expect(result.data.migrations).toEqual(['m1']);
		expect(result.data.progress).toEqual({
			v1: { C: { currentTempo: 60, lastPracticedAt: 1, passCount: 1 } }
		});
		expect(result.data.unlockCounts).toEqual({ v1: 3 });
		expect(result.data.history).toEqual({ v1: [{ t: 1, bpm: 60, keys: 1 }] });
	});
});

// ═════════════════════════════════════════════════════════════════════
//  deleteAllRecordingsFromCloud (paginated by always re-listing offset 0)
// ═════════════════════════════════════════════════════════════════════

/** Storage client whose `list` serves the given pages in order, then empty. */
function makeRecordingsStorageClient(
	userId: string | null,
	pages: Array<{ name: string }[]>,
	opts: { listError?: string; removeError?: string } = {}
) {
	let call = 0;
	const list = vi.fn().mockImplementation(async () =>
		opts.listError
			? { data: null, error: { message: opts.listError } }
			: { data: pages[call++] ?? [], error: null }
	);
	const remove = vi.fn().mockResolvedValue(
		opts.removeError ? { data: null, error: { message: opts.removeError } } : { data: [], error: null }
	);
	return {
		client: {
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
			storage: { from: vi.fn().mockReturnValue({ list, remove }) }
		},
		list,
		remove
	};
}

describe('deleteAllRecordingsFromCloud', () => {
	it('re-lists offset 0 after each removal until the folder is empty', async () => {
		const { client, list, remove } = makeRecordingsStorageClient('u1', [
			[{ name: 'a.webm' }, { name: 'b.webm' }],
			[{ name: 'c.webm' }]
		]);

		await deleteAllRecordingsFromCloud(client as any);

		expect(client.storage.from).toHaveBeenCalledWith('recordings');
		// Two non-empty pages + the terminating empty page, every list at offset 0
		// (an advancing cursor over a shrinking folder skips every second page).
		expect(list).toHaveBeenCalledTimes(3);
		for (const call of list.mock.calls) expect(call).toEqual(['u1', { limit: 100, offset: 0 }]);
		expect(remove.mock.calls).toEqual([[['u1/a.webm', 'u1/b.webm']], [['u1/c.webm']]]);
	});

	it('stops on a list error without removing anything', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { client, list, remove } = makeRecordingsStorageClient('u1', [], { listError: 'down' });
		await deleteAllRecordingsFromCloud(client as any);
		expect(list).toHaveBeenCalledTimes(1);
		expect(remove).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('stops on a remove error instead of re-listing the same page forever', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { client, list, remove } = makeRecordingsStorageClient(
			'u1',
			[[{ name: 'a.webm' }], [{ name: 'a.webm' }], [{ name: 'a.webm' }]],
			{ removeError: 'forbidden' }
		);
		await deleteAllRecordingsFromCloud(client as any);
		expect(list).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});

	it('is a no-op when unauthenticated', async () => {
		const { client, list } = makeRecordingsStorageClient(null, [[{ name: 'a.webm' }]]);
		await deleteAllRecordingsFromCloud(client as any);
		expect(list).not.toHaveBeenCalled();
	});
});

// ═════════════════════════════════════════════════════════════════════
//  Tour-state sync
// ═════════════════════════════════════════════════════════════════════

describe('syncTourStateToCloud', () => {
	it('does NOT upsert when the remote read fails (a failed read must never clobber the cloud row)', async () => {
		// The 2026-07-13 incident class, tour edition: tour completion is a set
		// unioned with the remote row before every write. If the remote read
		// fails and the merge proceeds against "nothing", the local-only set is
		// written WHOLESALE over a cloud row that may hold another device's
		// completions — a tour finished elsewhere replays on the next device.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: {
				user_settings: { data: null, error: { message: 'connection reset' } }
			}
		});

		await syncTourStateToCloud(mock as any, { completed: [], dismissed: ['library-intro'] });

		expect(mock._upsertFn).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('does NOT upsert when the remote read THROWS (a transport failure is the same unknown)', async () => {
		// loadTourStateFromCloud swallows a thrown read into null — the shape a
		// merge would read as "no remote set". The push path must not route its
		// read through that swallow.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		mock._fromFn.mockImplementationOnce(() => {
			const builder: Record<string, any> = {};
			builder.select = vi.fn(() => builder);
			builder.eq = vi.fn(() => builder);
			builder.maybeSingle = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
			builder.upsert = mock._upsertFn;
			return builder;
		});

		await syncTourStateToCloud(mock as any, { completed: ['welcome'], dismissed: [] });

		expect(mock._upsertFn).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('unions the local set with the remote row and writes the merged column', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: { tour_state: { completed: ['welcome'], dismissed: [] } },
					error: null
				}
			}
		});

		await syncTourStateToCloud(mock as any, { completed: [], dismissed: ['library-intro'] });

		expect(mock._upsertFn).toHaveBeenCalledTimes(1);
		const [row, opts] = mock._upsertFn.mock.calls[0];
		expect(opts).toEqual({ onConflict: 'user_id' });
		expect(row.user_id).toBe('test-user-id');
		expect(row.tour_state).toEqual({ completed: ['welcome'], dismissed: ['library-intro'] });
		// A partial upsert: the rest of the settings row is never touched.
		expect(Object.keys(row).sort()).toEqual(['tour_state', 'updated_at', 'user_id']);
	});

	it('treats an affirmatively missing row as an empty remote set and still writes', async () => {
		const mock = createMockSupabase({
			tableResults: { user_settings: { data: null, error: null } }
		});

		await syncTourStateToCloud(mock as any, { completed: ['welcome'], dismissed: [] });

		expect(mock._upsertFn).toHaveBeenCalledTimes(1);
		expect(mock._upsertFn.mock.calls[0][0].tour_state).toEqual({
			completed: ['welcome'],
			dismissed: []
		});
	});

	it('skips when unauthenticated', async () => {
		const mock = createMockSupabase({ user: null });
		await syncTourStateToCloud(mock as any, { completed: ['welcome'], dismissed: [] });
		expect(mock._fromFn).not.toHaveBeenCalled();
	});
});

describe('loadTourStateFromCloud', () => {
	it('returns null on a query error (unknown cloud truth), not an empty set', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: { user_settings: { data: null, error: { message: 'down' } } }
		});
		expect(await loadTourStateFromCloud(mock as any)).toBeNull();
		warnSpy.mockRestore();
	});

	it('reads a row whose column was never written as an empty set', async () => {
		const mock = createMockSupabase({
			tableResults: { user_settings: { data: { tour_state: null }, error: null } }
		});
		expect(await loadTourStateFromCloud(mock as any)).toEqual({ completed: [], dismissed: [] });
	});

	it('narrows the column: non-string entries and non-array fields are dropped', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: { tour_state: { completed: ['welcome', 7, null], dismissed: 'not-an-array' } },
					error: null
				}
			}
		});
		expect(await loadTourStateFromCloud(mock as any)).toEqual({
			completed: ['welcome'],
			dismissed: []
		});
	});
});

describe('clearTourStateInCloud', () => {
	it('REPLACES the column with an empty set (the one non-union tour write)', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: {
					data: { tour_state: { completed: ['welcome'], dismissed: ['x'] } },
					error: null
				}
			}
		});

		await clearTourStateInCloud(mock as any);

		// No read-merge: the reset must not union with (and so resurrect) the
		// remote set the way syncTourStateToCloud deliberately does.
		expect(mock._upsertFn).toHaveBeenCalledTimes(1);
		const [row, opts] = mock._upsertFn.mock.calls[0];
		expect(opts).toEqual({ onConflict: 'user_id' });
		expect(row.tour_state).toEqual({ completed: [], dismissed: [] });
	});

	it('skips when unauthenticated', async () => {
		const mock = createMockSupabase({ user: null });
		await clearTourStateInCloud(mock as any);
		expect(mock._fromFn).not.toHaveBeenCalled();
	});
});

describe('deleteDailySummariesFromCloud', () => {
	it('issues a delete scoped to the authenticated user', async () => {
		const eqCalls: [string, string][] = [];
		const deleteFn = vi.fn(() => ({
			eq: (col: string, val: string) => {
				eqCalls.push([col, val]);
				return Promise.resolve({ error: null });
			}
		}));
		const fromFn = vi.fn(() => ({ delete: deleteFn }));
		const mock = {
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }) },
			from: fromFn
		};
		await deleteDailySummariesFromCloud(mock as any);
		expect(fromFn).toHaveBeenCalledWith('daily_summaries');
		expect(deleteFn).toHaveBeenCalledTimes(1);
		expect(eqCalls).toContainEqual(['user_id', 'test-user-id']);
	});

	it('skips when unauthenticated', async () => {
		const fromFn = vi.fn();
		const mock = {
			auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
			from: fromFn
		};
		await deleteDailySummariesFromCloud(mock as any);
		expect(fromFn).not.toHaveBeenCalled();
	});
});
