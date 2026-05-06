/**
 * Cloud sync — anonymous → first-login migration.
 *
 * When a user accumulates progress while signed out (anonymous), then signs
 * in for the first time on this device, the merge rule depends on the data
 * domain:
 *
 *   - Progress (sessions): count-based merge. Cloud ≥ local → cloud wins.
 *     Local > cloud → local kept. Equal → cloud wins (>= semantics).
 *   - Tour state: union merge — local + cloud combined, no information lost.
 *   - Community favorites: union merge — same as tour state.
 *
 * `cloud-sync-multi-device.test.ts` already covers the count-based merge for
 * progress, but it pre-seeds `progress` and treats both inputs as "cloud" vs
 * "local" abstractly. This file pins down the *anonymous → login* boundary
 * explicitly: the same logical merge from the perspective of "I was signed
 * out, then I signed in for the first time." Different scenario, same code
 * path — but the test name documents the user-facing behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserProgress, SessionResult } from '$lib/types/progress';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: vi.fn((k: string) => store.get(k) ?? null),
	setItem: vi.fn((k: string, v: string) => store.set(k, v)),
	removeItem: vi.fn((k: string) => store.delete(k)),
	key: vi.fn((i: number) => [...store.keys()][i] ?? null),
	get length() {
		return store.size;
	},
	clear: vi.fn(() => store.clear())
});

const mockLoadProgress = vi.fn();
const mockLoadSettings = vi.fn();
const mockLoadTourState = vi.fn();
const mockSyncTourState = vi.fn().mockResolvedValue(undefined);

vi.mock('$lib/persistence/sync', () => ({
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: (...args: unknown[]) => mockLoadProgress(...args),
	deleteProgressDetailsFromCloud: vi.fn().mockResolvedValue(undefined),
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: (...args: unknown[]) => mockLoadSettings(...args),
	syncTourStateToCloud: (...args: unknown[]) => mockSyncTourState(...args),
	loadTourStateFromCloud: (...args: unknown[]) => mockLoadTourState(...args),
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	loadLickMetadataFromCloud: vi.fn().mockResolvedValue(null),
	syncUserLicksToCloud: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/state/history.svelte', () => ({
	aggregateSession: vi.fn(),
	clearHistory: vi.fn(),
	localDateStr: (d: Date) => {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}
}));

vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => 0
}));

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
});

function session(id: string, ago = 0): SessionResult {
	return {
		id,
		timestamp: Date.now() - ago,
		phraseId: 'p',
		phraseName: 'P',
		category: 'ii-V-I-major',
		key: 'C',
		tempo: 120,
		difficultyLevel: 30,
		pitchAccuracy: 0.85,
		rhythmAccuracy: 0.85,
		overall: 0.85,
		grade: 'good',
		notesHit: 7,
		notesTotal: 8,
		noteResults: []
	};
}

function progressWith(sessions: SessionResult[], extra: Partial<UserProgress> = {}): UserProgress {
	return {
		adaptive: {
			currentLevel: 30,
			pitchComplexity: 30,
			rhythmComplexity: 30,
			recentScores: [0.85],
			recentPitchScores: [0.85],
			recentRhythmScores: [0.85],
			attemptsAtLevel: 1,
			attemptsSinceChange: 1,
			pitchAttemptsSinceChange: 1,
			rhythmAttemptsSinceChange: 1
		},
		sessions,
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
		totalPracticeTime: 0,
		streakDays: 0,
		lastPracticeDate: '2026-01-01',
		...extra
	};
}

describe('anonymous → first-login: progress migration', () => {
	it('50 anonymous sessions + empty cloud → local kept (offline burst preserved)', async () => {
		// Seed 50 sessions accumulated while signed out.
		const localSessions = Array.from({ length: 50 }, (_, i) => session(`anon-${i}`, i * 1000));
		store.set('mankunku:progress', JSON.stringify(progressWith(localSessions)));

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// Cloud has nothing — first time signing in on any device.
		mockLoadProgress.mockResolvedValue(progressWith([]));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// All 50 anonymous sessions preserved (local > cloud → local kept).
		expect(progressModule.progress.sessions).toHaveLength(50);
		expect(progressModule.progress.sessions[0].id).toBe('anon-0');
	});

	it('50 anonymous sessions + cloud has 30 → local kept (count-based merge)', async () => {
		const localSessions = Array.from({ length: 50 }, (_, i) => session(`anon-${i}`));
		store.set('mankunku:progress', JSON.stringify(progressWith(localSessions)));

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		const cloudSessions = Array.from({ length: 30 }, (_, i) => session(`cloud-${i}`));
		mockLoadProgress.mockResolvedValue(progressWith(cloudSessions));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// Local has more — local kept. Anonymous burst from this device is
		// the more complete record.
		expect(progressModule.progress.sessions).toHaveLength(50);
		expect(progressModule.progress.sessions[0].id).toBe('anon-0');
	});

	it('50 anonymous sessions + cloud has 60 → cloud wins (offline burst was less recent)', async () => {
		const localSessions = Array.from({ length: 50 }, (_, i) => session(`anon-${i}`));
		store.set('mankunku:progress', JSON.stringify(progressWith(localSessions)));

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		const cloudSessions = Array.from({ length: 60 }, (_, i) => session(`cloud-${i}`));
		mockLoadProgress.mockResolvedValue(progressWith(cloudSessions));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// Cloud > local → cloud wins. Anonymous data is replaced — caller
		// likely practiced more on another device while signed in.
		expect(progressModule.progress.sessions).toHaveLength(60);
		expect(progressModule.progress.sessions.map((s) => s.id)).not.toContain('anon-0');
	});
});

describe('anonymous → first-login: tour state UNION', () => {
	// `tour.svelte.ts` only calls loadInitial() when `typeof window !== 'undefined'`.
	// Stub window so the module's import-time hydration reads the seeded
	// localStorage state — that's the path that matters for "anon → login":
	// the dismissals were saved while the user was anonymous on this device.
	function withWindowStubbed(fn: () => Promise<void>): Promise<void> {
		vi.stubGlobal('window', { document: {} });
		return fn().finally(() => vi.unstubAllGlobals());
	}

	// Re-stub localStorage — vi.unstubAllGlobals() above clears it.
	function restubLocalStorage(): void {
		vi.stubGlobal('localStorage', {
			getItem: vi.fn((k: string) => store.get(k) ?? null),
			setItem: vi.fn((k: string, v: string) => store.set(k, v)),
			removeItem: vi.fn((k: string) => store.delete(k)),
			key: vi.fn((i: number) => [...store.keys()][i] ?? null),
			get length() {
				return store.size;
			},
			clear: vi.fn(() => store.clear())
		});
	}

	it('anonymous dismissals + cloud completions → both visible (UNION)', async () => {
		await withWindowStubbed(async () => {
			// User dismissed welcome tour while anonymous; the saved local state.
			store.set(
				'mankunku:tour-state',
				JSON.stringify({ completed: [], dismissed: ['welcome'] })
			);

			vi.resetModules();
			const tourModule = await import('$lib/state/tour.svelte');

			// Cloud has tours dismissed/completed on a different device while
			// signed in elsewhere.
			mockLoadTourState.mockResolvedValue({
				completed: ['library-intro'],
				dismissed: ['practice-overview']
			});

			const supabase = { auth: {} };
			await tourModule.loadTourStateFromCloud(supabase as never);

			// UNION: anon dismissals + cloud completions/dismissals all present.
			expect(tourModule.tourState.completedTours.has('library-intro')).toBe(true);
			expect(tourModule.tourState.dismissedTours.has('welcome')).toBe(true);
			expect(tourModule.tourState.dismissedTours.has('practice-overview')).toBe(true);
		});
		restubLocalStorage();
	});

	it('completion takes precedence over dismissal — same tour id from anon and cloud', async () => {
		await withWindowStubbed(async () => {
			// Anon dismissed `welcome`; cloud says it was completed elsewhere.
			store.set(
				'mankunku:tour-state',
				JSON.stringify({ completed: [], dismissed: ['welcome'] })
			);

			vi.resetModules();
			const tourModule = await import('$lib/state/tour.svelte');

			mockLoadTourState.mockResolvedValue({
				completed: ['welcome'],
				dismissed: []
			});

			const supabase = { auth: {} };
			await tourModule.loadTourStateFromCloud(supabase as never);

			// Cloud's completion lands. tour.svelte.ts:80 guards the dismissed
			// side: "if not already in completed, add to dismissed". So a tour
			// that came back as completed from cloud doesn't get re-added to
			// dismissed even if it's there from local. But local's pre-existing
			// dismissal entry persists (the merge is additive, not replacing).
			expect(tourModule.tourState.completedTours.has('welcome')).toBe(true);
			// `hasSeen('welcome')` is the UX-relevant predicate — true via either
			// set, and completion is the stronger signal.
			expect(tourModule.hasSeen('welcome')).toBe(true);
		});
		restubLocalStorage();
	});
});
