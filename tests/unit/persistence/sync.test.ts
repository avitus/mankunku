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
	syncUserLicksToCloud
} from '$lib/persistence/sync.ts';
import type {
	UserProgress,
	SessionResult,
	ScaleProficiency,
	KeyProficiency,
	AdaptiveState,
	CategoryProgress
} from '$lib/types/progress.ts';
import type { Phrase } from '$lib/types/music.ts';

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
		builder.order = vi.fn(() => builder);
		builder.limit = vi.fn(() => builder);
		builder.single = vi.fn().mockResolvedValue(result);
		builder.upsert = upsertFn;
		builder.delete = vi.fn().mockResolvedValue({ data: null, error: null });

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
	attemptsAtLevel: 5,
	attemptsSinceChange: 3,
	xp: 1200
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
			recentScores: [70, 75, 80],
			attemptsAtLevel: 8,
			attemptsSinceChange: 3,
			totalAttempts: 20
		} as ScaleProficiency
	} as any,
	keyProficiency: {
		C: {
			level: 30,
			recentScores: [80, 85],
			attemptsAtLevel: 6,
			attemptsSinceChange: 2,
			totalAttempts: 15
		} as KeyProficiency
	} as any,
	totalPracticeTime: 3600,
	streakDays: 5,
	lastPracticeDate: '2024-01-15'
};

const TEST_SETTINGS: Record<string, unknown> = {
	instrumentId: 'tenor-sax',
	defaultTempo: 100,
	masterVolume: 0.8,
	metronomeEnabled: true,
	metronomeVolume: 0.7,
	swing: 0.5,
	theme: 'dark',
	onboardingComplete: false,
	tonalityOverride: null
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

		await expect(
			syncProgressToCloud(mock as any, TEST_PROGRESS)
		).resolves.not.toThrow();

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('only syncs the latest 200 sessions (respecting MAX_SESSIONS cap)', async () => {
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
		expect(sessionUpsertCalls[0][0].length).toBeLessThanOrEqual(200);
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

		await expect(
			syncProgressToCloud(mock as any, emptyProgress)
		).resolves.not.toThrow();

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

		expect(result).not.toBeNull();
		if (result) {
			// Aggregate progress fields
			expect(result.totalPracticeTime).toBe(3600);
			expect(result.streakDays).toBe(5);
			expect(result.lastPracticeDate).toBe('2024-01-15');
			expect(result.adaptive).toEqual(TEST_ADAPTIVE_STATE);
			expect(result.categoryProgress).toEqual(TEST_PROGRESS.categoryProgress);
			expect(result.keyProgress).toEqual(TEST_PROGRESS.keyProgress);

			// Session results mapped from snake_case
			expect(result.sessions).toHaveLength(1);
			expect(result.sessions[0].phraseId).toBe('blues-001');
			expect(result.sessions[0].phraseName).toBe('Blues Call');
			expect(result.sessions[0].pitchAccuracy).toBe(0.85);
			expect(result.sessions[0].rhythmAccuracy).toBe(0.78);
			expect(result.sessions[0].notesHit).toBe(5);
			expect(result.sessions[0].notesTotal).toBe(6);
			expect(result.sessions[0].difficultyLevel).toBe(15);

			// Scale proficiency mapped from snake_case
			const bluesMinor = result.scaleProficiency?.['blues.minor' as any];
			expect(bluesMinor).toBeDefined();
			if (bluesMinor) {
				expect(bluesMinor.level).toBe(25);
				expect(bluesMinor.recentScores).toEqual([70, 75, 80]);
				expect(bluesMinor.attemptsAtLevel).toBe(8);
				expect(bluesMinor.attemptsSinceChange).toBe(3);
				expect(bluesMinor.totalAttempts).toBe(20);
			}

			// Key proficiency mapped from snake_case
			const cKey = result.keyProficiency?.['C' as any];
			expect(cKey).toBeDefined();
			if (cKey) {
				expect(cKey.level).toBe(30);
				expect(cKey.recentScores).toEqual([80, 85]);
				expect(cKey.attemptsAtLevel).toBe(6);
				expect(cKey.attemptsSinceChange).toBe(2);
				expect(cKey.totalAttempts).toBe(15);
			}
		}
	});

	it('returns null when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		const result = await loadProgressFromCloud(mock as any);

		expect(result).toBeNull();
		expect(mock._fromFn).not.toHaveBeenCalled();
	});

	it('returns null on database error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: {
				user_progress: { data: null, error: { message: 'Table not found' } }
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		expect(result).toBeNull();
		warnSpy.mockRestore();
	});

	it('returns null when no progress row exists', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_progress: { data: null, error: null }
			}
		});

		const result = await loadProgressFromCloud(mock as any);

		expect(result).toBeNull();
	});

	it('never throws on any error', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		mock.auth.getUser.mockRejectedValue(new Error('Auth service down'));

		await expect(
			loadProgressFromCloud(mock as any)
		).resolves.not.toThrow();
		const result = await loadProgressFromCloud(mock as any);
		expect(result).toBeNull();

		warnSpy.mockRestore();
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

		expect(result).not.toBeNull();
		if (result) {
			expect(result.sessions).toEqual([]);
			expect(result.scaleProficiency).toEqual({});
			expect(result.keyProficiency).toEqual({});
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

		await expect(
			syncSettingsToCloud(mock as any, TEST_SETTINGS)
		).resolves.not.toThrow();

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

	it('includes updated_at timestamp in the settings row', async () => {
		const mock = createMockSupabase();

		await syncSettingsToCloud(mock as any, TEST_SETTINGS);

		expect(mock._upsertFn).toHaveBeenCalledWith(
			expect.objectContaining({
				updated_at: expect.any(String)
			}),
			expect.objectContaining({ onConflict: 'user_id' })
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
						swing: 0.6,
						theme: 'light',
						onboarding_complete: true,
						tonality_override: null,
						updated_at: '2024-01-15T12:00:00Z'
					},
					error: null
				}
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result).not.toBeNull();
		if (result) {
			expect(result.instrumentId).toBe('alto-sax');
			expect(result.defaultTempo).toBe(110);
			expect(result.masterVolume).toBe(0.9);
			expect(result.metronomeEnabled).toBe(false);
			expect(result.metronomeVolume).toBe(0.6);
			expect(result.swing).toBe(0.6);
			expect(result.theme).toBe('light');
			expect(result.onboardingComplete).toBe(true);
			expect(result.tonalityOverride).toBeNull();
		}
	});

	it('returns null when not authenticated', async () => {
		const mock = createMockSupabase({ user: null });

		const result = await loadSettingsFromCloud(mock as any);

		expect(result).toBeNull();
	});

	it('returns null when no settings found in DB', async () => {
		const mock = createMockSupabase({
			tableResults: {
				user_settings: { data: null, error: null }
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result).toBeNull();
	});

	it('catches errors and returns null', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			tableResults: {
				user_settings: { data: null, error: { message: 'RLS violation' } }
			}
		});

		const result = await loadSettingsFromCloud(mock as any);

		expect(result).toBeNull();
		warnSpy.mockRestore();
	});

	it('never throws on auth failure', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase();
		mock.auth.getUser.mockRejectedValue(new Error('Auth service down'));

		await expect(
			loadSettingsFromCloud(mock as any)
		).resolves.not.toThrow();
		const result = await loadSettingsFromCloud(mock as any);
		expect(result).toBeNull();

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

	it('handles empty licks array gracefully', async () => {
		const mock = createMockSupabase();

		await expect(
			syncUserLicksToCloud(mock as any, [])
		).resolves.not.toThrow();
	});

	it('catches errors and does not throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const mock = createMockSupabase({
			upsertResult: { error: { message: 'Table locked' } }
		});

		await expect(
			syncUserLicksToCloud(mock as any, [TEST_LICK])
		).resolves.not.toThrow();

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('syncs multiple licks in a single upsert', async () => {
		const mock = createMockSupabase();
		const lick2: Phrase = { ...TEST_LICK, id: 'user-5678-efgh', name: 'Dorian Riff' };

		await syncUserLicksToCloud(mock as any, [TEST_LICK, lick2]);

		// Find the upsert call with an array of 2 lick rows
		const upsertCall = mock._upsertFn.mock.calls.find(
			(call: any[]) => Array.isArray(call[0]) && call[0].length === 2
		);
		expect(upsertCall).toBeDefined();
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
});
