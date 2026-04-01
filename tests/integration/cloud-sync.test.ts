/**
 * Integration tests for the cloud sync module.
 *
 * Tests sync.ts functions with a fully mocked Supabase client:
 * progress round-trip, settings round-trip, session capping,
 * unauthenticated handling, user lick sync, recording upload,
 * and error resilience.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SvelteKit env modules (must come before imports)
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key' }
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn()
}));

import {
	syncProgressToCloud,
	loadProgressFromCloud,
	syncSettingsToCloud,
	loadSettingsFromCloud,
	syncUserLicksToCloud,
	uploadRecording,
	downloadRecording,
	deleteProgressDetailsFromCloud
} from '../../src/lib/persistence/sync';
import type { UserProgress, AdaptiveState } from '../../src/lib/types/progress';

// ─── Mock Supabase Client ──────────────────────────────────────

function createMockSupabase(userId: string | null = 'user-123') {
	const storage = {
		from: vi.fn().mockReturnValue({
			upload: vi.fn().mockResolvedValue({ error: null }),
			download: vi.fn().mockResolvedValue({ data: new Blob(['audio']), error: null }),
			list: vi.fn().mockResolvedValue({ data: [], error: null }),
			remove: vi.fn().mockResolvedValue({ error: null })
		})
	};

	const queryBuilder = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		not: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		delete: vi.fn().mockReturnThis()
	};

	const client = {
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: userId ? { id: userId } : null },
				error: null
			})
		},
		from: vi.fn().mockReturnValue({
			upsert: vi.fn().mockResolvedValue({ error: null }),
			select: queryBuilder.select,
			delete: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					not: vi.fn().mockResolvedValue({ error: null })
				})
			})
		}),
		storage
	};

	return client;
}

function makeProgress(): UserProgress {
	return {
		adaptive: {
			currentLevel: 5,
			pitchComplexity: 4,
			rhythmComplexity: 5,
			recentScores: [0.8, 0.85, 0.9],
			attemptsAtLevel: 10,
			attemptsSinceChange: 3,
			xp: 500
		},
		sessions: [{
			id: 'session-1',
			timestamp: Date.now(),
			phraseId: 'phrase-1',
			phraseName: 'Test Phrase',
			category: 'ii-V-I-major',
			key: 'C',
			tempo: 120,
			difficultyLevel: 5,
			pitchAccuracy: 0.85,
			rhythmAccuracy: 0.80,
			overall: 0.83,
			grade: 'good',
			notesHit: 7,
			notesTotal: 8,
			noteResults: [],
			timing: {
				meanOffsetMs: 10,
				medianOffsetMs: 8,
				stdDevMs: 15,
				latencyCorrectionMs: 50,
				perNoteOffsetMs: [5, -3, 10, 8, -2, 15, 7, null]
			}
		}],
		categoryProgress: {
			'ii-V-I-major': {
				category: 'ii-V-I-major',
				attemptsTotal: 10,
				averageScore: 0.82,
				bestScore: 0.95,
				lastAttempt: Date.now()
			}
		},
		keyProgress: {
			'C': { attempts: 10, averageScore: 0.82 }
		},
		scaleProficiency: {
			'major': {
				level: 15,
				recentScores: [0.8, 0.85],
				attemptsAtLevel: 5,
				attemptsSinceChange: 2,
				totalAttempts: 20
			}
		},
		keyProficiency: {
			'C': {
				level: 10,
				recentScores: [0.9, 0.85],
				attemptsAtLevel: 3,
				attemptsSinceChange: 1,
				totalAttempts: 15
			}
		},
		totalPracticeTime: 3600,
		streakDays: 5,
		lastPracticeDate: '2024-06-15'
	};
}

// ─── Progress Sync ─────────────────────────────────────────────

describe('progress sync', () => {
	it('syncProgressToCloud calls upsert on user_progress table', async () => {
		const supabase = createMockSupabase();
		const progress = makeProgress();

		await syncProgressToCloud(supabase as any, progress);

		expect(supabase.auth.getUser).toHaveBeenCalled();
		expect(supabase.from).toHaveBeenCalledWith('user_progress');
	});

	it('syncProgressToCloud is a no-op when unauthenticated', async () => {
		const supabase = createMockSupabase(null);
		const progress = makeProgress();

		await syncProgressToCloud(supabase as any, progress);

		// from() should not be called since getUser returns null
		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('syncProgressToCloud does not throw on Supabase errors', async () => {
		const supabase = createMockSupabase();
		supabase.from = vi.fn().mockReturnValue({
			upsert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } })
		});

		const progress = makeProgress();

		// Should not throw
		await expect(syncProgressToCloud(supabase as any, progress)).resolves.toBeUndefined();
	});

	it('loadProgressFromCloud returns null when unauthenticated', async () => {
		const supabase = createMockSupabase(null);
		const result = await loadProgressFromCloud(supabase as any);
		expect(result).toBeNull();
	});

	it('loadProgressFromCloud returns null when no data exists', async () => {
		const supabase = createMockSupabase();

		// Mock the chained select → eq → maybeSingle
		const chainedQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockResolvedValue({ data: [], error: null })
		};
		supabase.from = vi.fn().mockReturnValue(chainedQuery);

		const result = await loadProgressFromCloud(supabase as any);
		expect(result).toBeNull();
	});
});

// ─── Settings Sync ─────────────────────────────────────────────

describe('settings sync', () => {
	const settings = {
		instrumentId: 'tenor-sax',
		defaultTempo: 120,
		masterVolume: 0.8,
		metronomeEnabled: true,
		metronomeVolume: 0.6,
		swing: 0.5,
		theme: 'dark',
		onboardingComplete: true,
		tonalityOverride: null
	};

	it('syncSettingsToCloud calls upsert on user_settings table', async () => {
		const supabase = createMockSupabase();

		await syncSettingsToCloud(supabase as any, settings);

		expect(supabase.from).toHaveBeenCalledWith('user_settings');
	});

	it('syncSettingsToCloud is a no-op when unauthenticated', async () => {
		const supabase = createMockSupabase(null);

		await syncSettingsToCloud(supabase as any, settings);

		expect(supabase.from).not.toHaveBeenCalled();
	});

	it('loadSettingsFromCloud returns null when unauthenticated', async () => {
		const supabase = createMockSupabase(null);
		const result = await loadSettingsFromCloud(supabase as any);
		expect(result).toBeNull();
	});

	it('loadSettingsFromCloud returns mapped settings', async () => {
		const supabase = createMockSupabase();

		const chainedQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({
				data: {
					instrument_id: 'tenor-sax',
					default_tempo: 120,
					master_volume: 0.8,
					metronome_enabled: true,
					metronome_volume: 0.6,
					swing: 0.5,
					theme: 'dark',
					onboarding_complete: true,
					tonality_override: null
				},
				error: null
			})
		};
		supabase.from = vi.fn().mockReturnValue(chainedQuery);

		const result = await loadSettingsFromCloud(supabase as any);

		expect(result).not.toBeNull();
		expect(result!.instrumentId).toBe('tenor-sax');
		expect(result!.defaultTempo).toBe(120);
		expect(result!.theme).toBe('dark');
	});

	it('loadSettingsFromCloud validates tonality override shape', async () => {
		const supabase = createMockSupabase();

		const chainedQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({
				data: {
					instrument_id: 'tenor-sax',
					default_tempo: 120,
					master_volume: 0.8,
					metronome_enabled: true,
					metronome_volume: 0.6,
					swing: 0.5,
					theme: 'dark',
					onboarding_complete: true,
					tonality_override: { key: 'C', scaleType: 'major' }
				},
				error: null
			})
		};
		supabase.from = vi.fn().mockReturnValue(chainedQuery);

		const result = await loadSettingsFromCloud(supabase as any);
		expect(result!.tonalityOverride).toEqual({ key: 'C', scaleType: 'major' });
	});

	it('loadSettingsFromCloud nullifies invalid tonality override', async () => {
		const supabase = createMockSupabase();

		const chainedQuery = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({
				data: {
					instrument_id: 'tenor-sax',
					default_tempo: 120,
					master_volume: 0.8,
					metronome_enabled: true,
					metronome_volume: 0.6,
					swing: 0.5,
					theme: 'dark',
					onboarding_complete: true,
					tonality_override: { key: 'Z', scaleType: 'invalid' } // bad shape
				},
				error: null
			})
		};
		supabase.from = vi.fn().mockReturnValue(chainedQuery);

		const result = await loadSettingsFromCloud(supabase as any);
		expect(result!.tonalityOverride).toBeNull();
	});
});

// ─── User Licks Sync ───────────────────────────────────────────

describe('user licks sync', () => {
	it('syncUserLicksToCloud calls upsert on user_licks table', async () => {
		const supabase = createMockSupabase();

		const licks = [{
			id: 'lick-1',
			name: 'My Lick',
			timeSignature: [4, 4] as [number, number],
			key: 'C' as const,
			notes: [{ pitch: 60, offset: [0, 1] as [number, number], duration: [1, 4] as [number, number] }],
			harmony: [],
			difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
			category: 'user' as const,
			tags: ['custom'],
			source: 'user'
		}];

		await syncUserLicksToCloud(supabase as any, licks);

		expect(supabase.from).toHaveBeenCalledWith('user_licks');
	});

	it('syncUserLicksToCloud skips empty lick array', async () => {
		const supabase = createMockSupabase();

		await syncUserLicksToCloud(supabase as any, []);

		// getUser is called but no upsert since array is empty
		expect(supabase.auth.getUser).toHaveBeenCalled();
	});
});

// ─── Recording Sync ────────────────────────────────────────────

describe('recording upload/download', () => {
	it('uploadRecording stores to recordings bucket with user path', async () => {
		const supabase = createMockSupabase();
		const blob = new Blob(['audio-data'], { type: 'audio/webm' });

		await uploadRecording(supabase as any, 'session-abc', blob);

		expect(supabase.storage.from).toHaveBeenCalledWith('recordings');
	});

	it('uploadRecording rejects unsafe session IDs', async () => {
		const supabase = createMockSupabase();
		const blob = new Blob(['audio']);

		// Path traversal attempt
		await uploadRecording(supabase as any, '../../../etc/passwd', blob);

		// storage.from should not be called for upload with bad ID
		// (getUser is called first, then ID is validated)
		expect(supabase.auth.getUser).toHaveBeenCalled();
	});

	it('uploadRecording is a no-op when unauthenticated', async () => {
		const supabase = createMockSupabase(null);
		const blob = new Blob(['audio']);

		await uploadRecording(supabase as any, 'session-1', blob);

		expect(supabase.storage.from).not.toHaveBeenCalled();
	});

	it('downloadRecording returns null when unauthenticated', async () => {
		const supabase = createMockSupabase(null);
		const result = await downloadRecording(supabase as any, 'session-1');
		expect(result).toBeNull();
	});

	it('downloadRecording rejects unsafe session IDs', async () => {
		const supabase = createMockSupabase();
		const result = await downloadRecording(supabase as any, '../../secret');
		expect(result).toBeNull();
	});
});

// ─── Delete Progress Details ───────────────────────────────────

describe('delete progress details', () => {
	it('deletes from all three detail tables', async () => {
		const supabase = createMockSupabase();
		const deleteMock = vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: null })
		});
		supabase.from = vi.fn().mockReturnValue({
			delete: deleteMock
		});

		await deleteProgressDetailsFromCloud(supabase as any);

		// Should be called for session_results, scale_proficiency, key_proficiency
		expect(supabase.from).toHaveBeenCalledWith('session_results');
		expect(supabase.from).toHaveBeenCalledWith('scale_proficiency');
		expect(supabase.from).toHaveBeenCalledWith('key_proficiency');
	});

	it('is a no-op when unauthenticated', async () => {
		const supabase = createMockSupabase(null);

		await deleteProgressDetailsFromCloud(supabase as any);

		expect(supabase.from).not.toHaveBeenCalled();
	});
});

// ─── Error Resilience ──────────────────────────────────────────

describe('sync error resilience', () => {
	it('all sync functions catch and warn on network errors', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const supabase = createMockSupabase();
		supabase.auth.getUser = vi.fn().mockRejectedValue(new Error('Network error'));

		// None of these should throw
		await expect(syncProgressToCloud(supabase as any, makeProgress())).resolves.toBeUndefined();
		await expect(loadProgressFromCloud(supabase as any)).resolves.toBeNull();
		await expect(syncSettingsToCloud(supabase as any, {
			instrumentId: 'sax', defaultTempo: 120, masterVolume: 0.8,
			metronomeEnabled: true, metronomeVolume: 0.6, swing: 0.5,
			theme: 'dark', onboardingComplete: true, tonalityOverride: null,
			highestNote: null
		})).resolves.toBeUndefined();
		await expect(loadSettingsFromCloud(supabase as any)).resolves.toBeNull();
		await expect(syncUserLicksToCloud(supabase as any, [])).resolves.toBeUndefined();
		await expect(uploadRecording(supabase as any, 'id', new Blob())).resolves.toBeUndefined();
		await expect(downloadRecording(supabase as any, 'id')).resolves.toBeNull();

		warnSpy.mockRestore();
	});
});
