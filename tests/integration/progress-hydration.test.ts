/**
 * Integration tests for progress cloud hydration.
 *
 * Verifies that initFromCloud fetches fresh data on every call
 * (no stale guard) and correctly merges cloud progress into reactive state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProgress, SessionResult, AdaptiveState } from '$lib/types/progress';

// Mock localStorage
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((key: string) => store.get(key) ?? null),
	setItem: vi.fn((key: string, val: string) => store.set(key, val)),
	removeItem: vi.fn((key: string) => store.delete(key)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() { return store.size; },
	clear: vi.fn(() => store.clear())
});

// Mock the sync module
const mockLoadProgress = vi.fn();
vi.mock('$lib/persistence/sync', () => ({
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: (...args: unknown[]) => mockLoadProgress(...args),
	deleteProgressDetailsFromCloud: vi.fn().mockResolvedValue(undefined),
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: vi.fn().mockResolvedValue(null)
}));

// Mock history module (called during progress operations)
vi.mock('$lib/state/history.svelte', () => ({
	aggregateSession: vi.fn(),
	clearHistory: vi.fn(),
	localDateStr: (d: Date) => {
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
}));

let progressModule: typeof import('$lib/state/progress.svelte');

function makeSession(id: string, overall: number = 0.8): SessionResult {
	return {
		id,
		timestamp: Date.now(),
		phraseId: 'phrase-1',
		phraseName: 'Test',
		category: 'ii-V-I-major',
		key: 'C',
		tempo: 120,
		difficultyLevel: 5,
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		notesHit: 7,
		notesTotal: 8,
		noteResults: [],
		timing: {
			meanOffsetMs: 0,
			medianOffsetMs: 0,
			stdDevMs: 10,
			latencyCorrectionMs: 50,
			perNoteOffsetMs: []
		}
	};
}

function makeCloudProgress(sessions: SessionResult[]): UserProgress {
	return {
		adaptive: {
			currentLevel: 5,
			pitchComplexity: 4,
			rhythmComplexity: 5,
			recentScores: [0.8],
			attemptsAtLevel: 3,
			attemptsSinceChange: 3,
			xp: 200
		},
		sessions,
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		totalPracticeTime: 100,
		streakDays: 3,
		lastPracticeDate: '2026-04-06'
	};
}

beforeEach(async () => {
	vi.resetModules();
	store.clear();
	mockLoadProgress.mockReset();

	progressModule = await import('$lib/state/progress.svelte');
});

function mockSupabase() {
	return {
		auth: { getUser: vi.fn() },
		from: vi.fn()
	};
}

describe('initFromCloud', () => {
	it('merges cloud progress when cloud has more sessions', async () => {
		const cloudSessions = [makeSession('s1'), makeSession('s2'), makeSession('s3')];
		mockLoadProgress.mockResolvedValue(makeCloudProgress(cloudSessions));

		await progressModule.initFromCloud(mockSupabase() as any);

		expect(progressModule.progress.sessions).toHaveLength(3);
		expect(progressModule.progress.adaptive.xp).toBe(200);
	});

	it('fetches fresh data on every call (no stale guard)', async () => {
		// First call: cloud has 2 sessions
		mockLoadProgress.mockResolvedValue(
			makeCloudProgress([makeSession('s1'), makeSession('s2')])
		);
		await progressModule.initFromCloud(mockSupabase() as any);
		expect(progressModule.progress.sessions).toHaveLength(2);

		// Second call: cloud now has 4 sessions (practiced on another device)
		mockLoadProgress.mockResolvedValue(
			makeCloudProgress([
				makeSession('s1'), makeSession('s2'),
				makeSession('s3'), makeSession('s4')
			])
		);
		await progressModule.initFromCloud(mockSupabase() as any);
		expect(progressModule.progress.sessions).toHaveLength(4);

		expect(mockLoadProgress).toHaveBeenCalledTimes(2);
	});

	it('keeps local state when local has more sessions', async () => {
		// Seed local with 3 sessions via localStorage before module import
		vi.resetModules();
		const localProgress = makeCloudProgress([
			makeSession('local-1'), makeSession('local-2'), makeSession('local-3')
		]);
		store.set('mankunku:progress', JSON.stringify(localProgress));
		progressModule = await import('$lib/state/progress.svelte');

		// Cloud has only 1 session (hasn't synced yet)
		mockLoadProgress.mockResolvedValue(
			makeCloudProgress([makeSession('cloud-1')])
		);
		await progressModule.initFromCloud(mockSupabase() as any);

		// Local state should be kept (more sessions)
		expect(progressModule.progress.sessions).toHaveLength(3);
		expect(progressModule.progress.sessions[0].id).toBe('local-1');
	});

	it('does nothing when cloud returns null', async () => {
		mockLoadProgress.mockResolvedValue(null);
		const sessionsBefore = progressModule.progress.sessions.length;

		await progressModule.initFromCloud(mockSupabase() as any);

		expect(progressModule.progress.sessions.length).toBe(sessionsBefore);
	});

	it('handles cloud fetch errors gracefully', async () => {
		mockLoadProgress.mockRejectedValue(new Error('network error'));

		await expect(
			progressModule.initFromCloud(mockSupabase() as any)
		).resolves.toBeUndefined();
	});

	it('merges scale and key proficiency from cloud', async () => {
		const cloud = makeCloudProgress([makeSession('s1'), makeSession('s2')]);
		cloud.scaleProficiency = {
			'major': { level: 5, recentScores: [0.9], attemptsAtLevel: 3, attemptsSinceChange: 3, totalAttempts: 10 }
		};
		cloud.keyProficiency = {
			'G': { level: 3, recentScores: [0.85], attemptsAtLevel: 2, attemptsSinceChange: 2, totalAttempts: 8 }
		};
		mockLoadProgress.mockResolvedValue(cloud);

		await progressModule.initFromCloud(mockSupabase() as any);

		expect(progressModule.progress.scaleProficiency['major']).toBeDefined();
		expect(progressModule.progress.scaleProficiency['major']!.level).toBe(5);
		expect(progressModule.progress.keyProficiency['G']).toBeDefined();
		expect(progressModule.progress.keyProficiency['G']!.level).toBe(3);
	});
});
