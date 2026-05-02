/**
 * Cloud sync — auth-state edge cases.
 *
 * Covers scenarios that span the auth/hydration boundary:
 *   • Scope-generation guard prevents a mid-flight sync from writing state
 *     into the wrong user's cache after a user switch.
 *   • Token expiry (getUser → null) during hydration returns without touching
 *     local state.
 *   • Hydration fault tolerance — a failure in one hydration path must not
 *     block the others.
 *
 * Existing `user-scope.test.ts` already covers the wipe mechanics on user
 * switch; these tests focus on the more subtle coordination guarantees that
 * each cloud-reading state module must uphold.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProgress } from '$lib/types/progress';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

// ─── localStorage stub ───────────────────────────────────────────────
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

// ─── Mocks that each suite can reconfigure ───────────────────────────

const mockLoadProgress = vi.fn();
const mockLoadSettings = vi.fn();
const mockLoadLickMetadata = vi.fn();

vi.mock('$lib/persistence/sync', () => ({
	syncProgressToCloud: vi.fn().mockResolvedValue(undefined),
	loadProgressFromCloud: (...args: unknown[]) => mockLoadProgress(...args),
	deleteProgressDetailsFromCloud: vi.fn().mockResolvedValue(undefined),
	syncSettingsToCloud: vi.fn().mockResolvedValue(undefined),
	loadSettingsFromCloud: (...args: unknown[]) => mockLoadSettings(...args),
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	loadLickMetadataFromCloud: (...args: unknown[]) => mockLoadLickMetadata(...args),
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

const getScopeGenerationMock = vi.fn(() => 0);
vi.mock('$lib/persistence/user-scope', () => ({
	getScopeGeneration: () => getScopeGenerationMock()
}));

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
	getScopeGenerationMock.mockReturnValue(0);
});

// ─── Fixture helpers ─────────────────────────────────────────────────

function makeCloudProgress(sessionCount: number): UserProgress {
	return {
		adaptive: {
			currentLevel: 42,
			pitchComplexity: 42,
			rhythmComplexity: 42,
			recentScores: [0.9, 0.95, 0.92],
			recentPitchScores: [0.9, 0.95, 0.92],
			recentRhythmScores: [0.88, 0.9, 0.91],
			attemptsAtLevel: 20,
			attemptsSinceChange: 5,
			pitchAttemptsSinceChange: 5,
			rhythmAttemptsSinceChange: 5
		},
		sessions: Array.from({ length: sessionCount }, (_, i) => ({
			id: `cloud-${i}`,
			timestamp: Date.now() - i * 1000,
			phraseId: 'p',
			phraseName: 'P',
			category: 'ii-V-I-major' as const,
			key: 'C' as const,
			tempo: 120,
			difficultyLevel: 42,
			pitchAccuracy: 0.9,
			rhythmAccuracy: 0.9,
			overall: 0.9,
			grade: 'good' as const,
			notesHit: 7,
			notesTotal: 8,
			noteResults: []
		})),
		categoryProgress: {},
		keyProgress: {},
		scaleProficiency: {},
		keyProficiency: {},
		lickProgress: {},
		totalPracticeTime: 100,
		streakDays: 7,
		lastPracticeDate: '2026-01-01'
	};
}

// ---------------------------------------------------------------------------
// Scope generation guard — progress hydration
// ---------------------------------------------------------------------------

describe('progress.initFromCloud — scope generation guard', () => {
	it('does not merge cloud data when user switch happens mid-flight', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// Simulate the user switch happening between loadProgressFromCloud
		// resolving and the guard re-check. getScopeGeneration reports 0 on
		// entry, then 1 on the post-fetch check.
		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		mockLoadProgress.mockResolvedValue(makeCloudProgress(10));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// The cloud progress (10 sessions, currentLevel 42) must NOT have landed.
		expect(progressModule.progress.sessions.length).toBe(0);
		expect(progressModule.progress.adaptive.currentLevel).not.toBe(42);
	});

	it('does merge cloud data when generation is stable', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		getScopeGenerationMock.mockReturnValue(0);
		mockLoadProgress.mockResolvedValue(makeCloudProgress(5));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		expect(progressModule.progress.sessions.length).toBe(5);
		expect(progressModule.progress.adaptive.currentLevel).toBe(42);
	});

	it('exits silently when the cloud returns null (no auth / no row)', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue(null);

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		expect(progressModule.progress.sessions.length).toBe(0);
	});

	it('does not throw when loadProgressFromCloud rejects (token expiry)', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockRejectedValue(new Error('auth token expired'));

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const supabase = { auth: {} };
		await expect(progressModule.initFromCloud(supabase as never)).resolves.toBeUndefined();
		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Scope generation guard — settings hydration
// ---------------------------------------------------------------------------

describe('settings.loadSettingsFromCloud — scope generation guard', () => {
	it('does not apply cloud settings when user switch happens mid-flight', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');
		const initialTempo = settingsModule.settings.defaultTempo;

		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		mockLoadSettings.mockResolvedValue({
			instrumentId: 'alto-sax',
			defaultTempo: 200, // very obviously different
			masterVolume: 0.5,
			metronomeEnabled: false,
			metronomeVolume: 0.5,
			backingTrackEnabled: false,
			backingInstrument: 'guitar',
			backingTrackVolume: 0.3,
			swing: 0.7,
			theme: 'light',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: 72
		});

		const supabase = { auth: {} };
		await settingsModule.loadSettingsFromCloud(supabase as never);

		expect(settingsModule.settings.defaultTempo).toBe(initialTempo);
	});

	it('applies cloud settings when generation is stable', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadSettings.mockResolvedValue({
			instrumentId: 'alto-sax',
			defaultTempo: 99,
			masterVolume: 0.5,
			metronomeEnabled: false,
			metronomeVolume: 0.5,
			backingTrackEnabled: false,
			backingInstrument: 'guitar',
			backingTrackVolume: 0.3,
			swing: 0.5,
			theme: 'light',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: 72
		});

		const supabase = { auth: {} };
		await settingsModule.loadSettingsFromCloud(supabase as never);

		expect(settingsModule.settings.defaultTempo).toBe(99);
		expect(settingsModule.settings.theme).toBe('light');
	});

	it('leaves state untouched when cloud returns null', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');
		const before = { ...settingsModule.settings };

		mockLoadSettings.mockResolvedValue(null);

		const supabase = { auth: {} };
		await settingsModule.loadSettingsFromCloud(supabase as never);

		expect(settingsModule.settings.defaultTempo).toBe(before.defaultTempo);
		expect(settingsModule.settings.theme).toBe(before.theme);
	});

	it('does not throw when loadSettingsFromCloud rejects', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadSettings.mockRejectedValue(new Error('network down'));

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const supabase = { auth: {} };
		await expect(
			settingsModule.loadSettingsFromCloud(supabase as never)
		).resolves.toBeUndefined();
		warnSpy.mockRestore();
	});

	it('clamps an out-of-range swing value from cloud', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadSettings.mockResolvedValue({
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			swing: 5.0, // out of valid range [0.5, 0.8]
			theme: 'dark',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: null
		});

		const supabase = { auth: {} };
		await settingsModule.loadSettingsFromCloud(supabase as never);

		expect(settingsModule.settings.swing).toBeLessThanOrEqual(0.8);
		expect(settingsModule.settings.swing).toBeGreaterThanOrEqual(0.5);
	});

	it('falls back to a default backingStyle when cloud value is unknown', async () => {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadSettings.mockResolvedValue({
			instrumentId: 'tenor-sax',
			defaultTempo: 100,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			swing: 0.5,
			// Settings loaded from a forward schema that knows a style this client doesn't.
			backingStyle: 'some-future-style',
			theme: 'dark',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: null
		});

		const supabase = { auth: {} };
		await settingsModule.loadSettingsFromCloud(supabase as never);

		expect(['swing', 'bossa-nova', 'ballad', 'straight']).toContain(
			settingsModule.settings.backingStyle
		);
	});
});

// ---------------------------------------------------------------------------
// Hydration fault tolerance — one path failing does not stop another
// ---------------------------------------------------------------------------

describe('independent hydration fault tolerance', () => {
	it('settings hydration runs even if progress hydration rejected earlier', async () => {
		vi.resetModules();

		const progressModule = await import('$lib/state/progress.svelte');
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadProgress.mockRejectedValue(new Error('progress fail'));
		mockLoadSettings.mockResolvedValue({
			instrumentId: 'tenor-sax',
			defaultTempo: 150,
			masterVolume: 0.6,
			metronomeEnabled: true,
			metronomeVolume: 0.7,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			swing: 0.5,
			theme: 'dark',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: null
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const supabase = { auth: {} };

		// Run both hydrations; neither should throw even though one fails.
		await Promise.all([
			progressModule.initFromCloud(supabase as never),
			settingsModule.loadSettingsFromCloud(supabase as never)
		]);
		warnSpy.mockRestore();

		// Settings landed despite the progress failure.
		expect(settingsModule.settings.defaultTempo).toBe(150);
	});

	it('progress hydration runs even if settings hydration rejected earlier', async () => {
		vi.resetModules();

		const progressModule = await import('$lib/state/progress.svelte');
		const settingsModule = await import('$lib/state/settings.svelte');

		mockLoadSettings.mockRejectedValue(new Error('settings fail'));
		mockLoadProgress.mockResolvedValue(makeCloudProgress(3));

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const supabase = { auth: {} };

		await Promise.all([
			settingsModule.loadSettingsFromCloud(supabase as never),
			progressModule.initFromCloud(supabase as never)
		]);
		warnSpy.mockRestore();

		expect(progressModule.progress.sessions.length).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Scope generation guard — lick-metadata, user-licks, community
//
// progress + settings are already covered above. Closing the gap for the three
// remaining hydrators that read from the cloud and write to localStorage —
// every cloud→local writeback must check the generation counter so a mid-
// flight user switch can't land prior-user data in the new user's cache.
// ---------------------------------------------------------------------------

describe('lick-metadata.initLickMetadataFromCloud — scope generation guard', () => {
	it('does not write tags/progress/overrides/unlocks to local when user switch happens mid-flight', async () => {
		vi.resetModules();
		const lickStore = await import('$lib/persistence/lick-practice-store');

		// Generation flips between entry (0) and post-fetch check (1).
		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		mockLoadLickMetadata.mockResolvedValue({
			lickTags: { 'lick-1': ['practice'] },
			practiceProgress: { 'lick-1': { C: { currentTempo: 120, lastPracticedAt: 1, passCount: 3 } } },
			tagOverrides: { 'curated-1': ['practice'] },
			categoryOverrides: { 'curated-2': 'modal' },
			unlockCounts: { 'lick-1': 5 }
		});

		const supabase = { auth: {} };
		await lickStore.initLickMetadataFromCloud(supabase as never);

		// None of the four lick-metadata localStorage keys should have landed.
		expect(store.has('mankunku:user-lick-tags')).toBe(false);
		expect(store.has('mankunku:lick-practice-progress')).toBe(false);
		expect(store.has('mankunku:lick-tag-overrides')).toBe(false);
		expect(store.has('mankunku:lick-category-overrides')).toBe(false);
		expect(store.has('mankunku:lick-unlock-count')).toBe(false);
	});

	it('does write to local when generation is stable', async () => {
		vi.resetModules();
		const lickStore = await import('$lib/persistence/lick-practice-store');

		getScopeGenerationMock.mockReturnValue(0);

		mockLoadLickMetadata.mockResolvedValue({
			lickTags: { 'lick-1': ['practice'] },
			practiceProgress: {},
			tagOverrides: {},
			categoryOverrides: {},
			unlockCounts: {}
		});

		const supabase = { auth: {} };
		await lickStore.initLickMetadataFromCloud(supabase as never);

		expect(store.has('mankunku:user-lick-tags')).toBe(true);
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual({
			'lick-1': ['practice']
		});
	});
});

// User-licks and community do not go through the mocked sync.ts — they query
// supabase.from() directly. So these tests construct a `from()` chain inline
// and rely on the real getScopeGenerationMock to drive the guard.

interface FromChain {
	select: (cols?: string) => FromChain;
	eq: (col: string, val: unknown) => FromChain;
	in: (col: string, vals: unknown[]) => FromChain;
	upsert: (row: unknown) => Promise<{ error: null }>;
	then: (
		resolve: (v: { data: unknown[]; error: null }) => unknown,
		reject?: (e: unknown) => unknown
	) => Promise<unknown>;
}

function makeQueryClient(opts: {
	userId: string | null;
	tableData: Record<string, unknown[]>;
}): unknown {
	const auth = {
		getUser: vi.fn().mockResolvedValue({
			data: { user: opts.userId ? { id: opts.userId } : null },
			error: null
		})
	};

	function from(table: string): FromChain {
		const chain: FromChain = {
			select() {
				return chain;
			},
			eq() {
				return chain;
			},
			in() {
				return chain;
			},
			async upsert() {
				return { error: null };
			},
			then(resolve) {
				return Promise.resolve({ data: opts.tableData[table] ?? [], error: null }).then(
					resolve
				);
			}
		};
		return chain;
	}

	return { auth, from };
}

describe('user-licks.initUserLicksFromCloud — scope generation guard', () => {
	it('does not write to localStorage when user switch happens mid-flight', async () => {
		vi.resetModules();
		const userLicks = await import('$lib/persistence/user-licks');

		// First call (entry into initUserLicksFromCloud) returns 0.
		// Subsequent calls return 1 — every guard inside the function must
		// detect the bump and bail before writing.
		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		const supabase = makeQueryClient({
			userId: 'user-A',
			tableData: {
				user_licks: [
					{
						id: 'cloud-lick',
						name: 'Cloud',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
						category: 'user',
						tags: [],
						source: 'user-entered',
						user_id: 'user-A'
					}
				]
			}
		});

		await userLicks.initUserLicksFromCloud(supabase as never);

		// No lick should have landed in localStorage — the writeback is gated
		// on the generation guard.
		expect(store.has('mankunku:user-licks')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Hydration timeout — render race
//
// `+layout.ts:118-120` races the parallel hydration against a 2-second timer
// so render isn't blocked on slow networks. Verify the pattern works (slow
// hydrator does not stall the race) AND that the production source still
// contains the Promise.race + setTimeout structure.
// ---------------------------------------------------------------------------

describe('hydration race against the 2s timeout', () => {
	it('the timeout wins when a hydrator is slower than 2s — render does not stall', async () => {
		vi.useFakeTimers();

		try {
			let hydrationResolved = false;
			const slowHydration = new Promise<void>((resolve) => {
				setTimeout(() => {
					hydrationResolved = true;
					resolve();
				}, 5000);
			});

			// Mirrors the production race in +layout.ts:120 — slow hydration vs
			// 2s timeout. Whichever wins resolves the await.
			const race = Promise.race([
				slowHydration,
				new Promise<void>((r) => setTimeout(r, 2000))
			]);

			// At t=0, neither is resolved.
			let raceResolved = false;
			race.then(() => {
				raceResolved = true;
			});

			// Advance to t=2000 — timeout fires. Race resolves.
			await vi.advanceTimersByTimeAsync(2000);
			expect(raceResolved).toBe(true);
			expect(hydrationResolved).toBe(false); // slow hydrator still pending

			// Advance to t=5000 — hydrator finally completes (continues in background).
			await vi.advanceTimersByTimeAsync(3000);
			expect(hydrationResolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('production +layout.ts still races hydration against a 2s timeout', async () => {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const layoutPath = fileURLToPath(new URL('../../src/routes/+layout.ts', import.meta.url));
		const src = readFileSync(layoutPath, 'utf8');
		// Allow whitespace variation; require the Promise.race + setTimeout
		// (with a literal 2000) wrapping the hydration await.
		const racePattern = /Promise\.race\(\s*\[\s*hydration\s*,\s*new\s+Promise[^]*?setTimeout\([^]*?2000[^]*?\)\s*\]\s*\)/;
		expect(
			src,
			'src/routes/+layout.ts must keep Promise.race([hydration, setTimeout(..., 2000)]) so a slow cloud does not block render. See +layout.ts:118-120.'
		).toMatch(racePattern);
	});
});

// ---------------------------------------------------------------------------
// Token refresh cycle — fresh auth after a previously-expired call
// ---------------------------------------------------------------------------

describe('token refresh cycle', () => {
	it('a fresh authenticated call succeeds even after a previous attempt rejected with expired-token', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// First attempt: token-expiry rejection. Production code catches and
		// returns silently — no state mutation.
		mockLoadProgress.mockRejectedValueOnce(new Error('JWT expired'));

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// State untouched after the rejection.
		expect(progressModule.progress.sessions.length).toBe(0);

		// Second attempt: refresh has happened, getUser is good, cloud returns
		// real data. Hydration should land normally.
		mockLoadProgress.mockResolvedValueOnce(makeCloudProgress(7));
		await progressModule.initFromCloud(supabase as never);
		warnSpy.mockRestore();

		expect(progressModule.progress.sessions.length).toBe(7);
		expect(progressModule.progress.adaptive.currentLevel).toBe(42);
	});
});

describe('community.initCommunityFromCloud — scope generation guard', () => {
	it('does not write favorites/steals to localStorage when user switch happens mid-flight', async () => {
		vi.resetModules();
		const community = await import('$lib/persistence/community');

		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		const supabase = makeQueryClient({
			userId: 'user-A',
			tableData: {
				lick_favorites: [{ lick_id: 'fav-1' }, { lick_id: 'fav-2' }],
				lick_adoptions: [{ lick_id: 'steal-1' }],
				user_licks: [
					{
						id: 'steal-1',
						user_id: 'author',
						name: 'X',
						key: 'C',
						time_signature: [4, 4],
						notes: [],
						harmony: [],
						difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
						category: 'user',
						tags: [],
						source: 'user-recorded',
						audio_url: null,
						created_at: '',
						updated_at: '',
						favorite_count: 0
					}
				]
			}
		});

		await community.initCommunityFromCloud(supabase as never);

		// No community caches written — every checkpoint inside
		// initCommunityFromCloud detects the generation bump and aborts.
		expect(store.has('mankunku:community-favorites')).toBe(false);
		expect(store.has('mankunku:community-adoptions')).toBe(false);
		expect(store.has('mankunku:community-adopted-payloads')).toBe(false);
		expect(store.has('mankunku:community-adopted-authors')).toBe(false);
	});
});
