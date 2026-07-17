/**
 * Cloud sync — multi-device merge behavior.
 *
 * These tests pin down the merge rules invoked when a user signs in on a
 * second device and their cloud state has to be reconciled with whatever
 * local cache exists on the new machine. The merge lives in
 * `progress.svelte.ts::initFromCloud`.
 *
 * Rules under test:
 *  - sessions UNION by id (local wins same-id collisions); no distinct session
 *    from either side is dropped by a count comparison
 *  - Session cap of 100 applies AFTER the union, keeping newest by timestamp
 *  - `adaptive` follows whichever side practiced most recently (newest session)
 *  - `lickProgress` is never synced through this path and must survive
 *  - Adaptive state merges forward-compat defaults with the chosen side's values
 *
 * Also covers recording-upload path isolation: each upload is scoped to the
 * authenticated user's storage prefix, so a user switch cannot bleed blobs
 * across accounts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProgress, SessionResult } from '$lib/types/progress';

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

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockLoadProgress = vi.fn();

// Partially mock sync.ts: intercept hydration (loadProgressFromCloud) but keep
// the real implementations of the write-path functions we want to exercise in
// the "recording upload" and "updated_at stamping" tests below.
vi.mock('$lib/persistence/sync', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/persistence/sync')>();
	return {
		...actual,
		// Tests set mockLoadProgress to the cloud UserProgress payload; wrap it in
		// the tri-state CloudLoad the real initFromCloud now consumes (a nullish
		// payload becomes 'empty', anything else 'ok' + data).
		loadProgressFromCloud: async (...args: unknown[]) => {
			const data = await mockLoadProgress(...args);
			return data == null ? { status: 'empty' } : { status: 'ok', data };
		},
		// New tri-state contract: no settings row → { status: 'empty' }.
		loadSettingsFromCloud: vi.fn().mockResolvedValue({ status: 'empty' })
	};
});

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

// ─── Fixtures ──────────────────────────────────────────────────────────

function session(id: string, timestampOffset = 0, overall = 0.8): SessionResult {
	return {
		id,
		timestamp: Date.now() - timestampOffset,
		phraseId: 'p',
		phraseName: 'P',
		category: 'ii-V-I-major',
		key: 'C',
		tempo: 120,
		difficultyLevel: 42,
		pitchAccuracy: overall,
		rhythmAccuracy: overall,
		overall,
		grade: 'good',
		notesHit: 7,
		notesTotal: 8,
		noteResults: []
	};
}

function progressWith(
	sessions: SessionResult[],
	extra: Partial<UserProgress> = {}
): UserProgress {
	return {
		adaptive: {
			currentLevel: 10,
			pitchComplexity: 10,
			rhythmComplexity: 10,
			recentScores: [0.8],
			recentPitchScores: [0.8],
			recentRhythmScores: [0.8],
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

// ---------------------------------------------------------------------------
// Merge rule: local > cloud → local kept
// ---------------------------------------------------------------------------

describe('merge rule — union keeps every distinct session', () => {
	it('unions the local offline burst with the cloud sessions (nothing dropped)', async () => {
		// Seed local with 80 sessions that aren't in the cloud (newer timestamps).
		const localSessions = Array.from({ length: 80 }, (_, i) => session(`local-${i}`, i * 1000));
		store.set('mankunku:progress', JSON.stringify(progressWith(localSessions)));

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// Cloud only knows about 20 (older, e.g., pre-offline period).
		const cloudSessions = Array.from({ length: 20 }, (_, i) =>
			session(`cloud-${i}`, (i + 80) * 1000)
		);
		mockLoadProgress.mockResolvedValue(progressWith(cloudSessions));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// New contract: UNION, not "local kept". All 80 local + 20 cloud distinct
		// sessions survive (100 total, exactly at the cap — none dropped).
		const ids = new Set(progressModule.progress.sessions.map((s) => s.id));
		expect(progressModule.progress.sessions).toHaveLength(100);
		for (let i = 0; i < 80; i++) expect(ids.has(`local-${i}`)).toBe(true);
		for (let i = 0; i < 20; i++) expect(ids.has(`cloud-${i}`)).toBe(true);
	});

	it('takes the adaptive state from whichever side practiced most recently', async () => {
		// Local practiced more recently (small offsets), so its adaptive buffers
		// win — the merge picks adaptive by newest session timestamp, not count.
		const localSessions = Array.from({ length: 30 }, (_, i) => session(`local-${i}`, i));
		store.set(
			'mankunku:progress',
			JSON.stringify(
				progressWith(localSessions, {
					adaptive: {
						currentLevel: 77,
						pitchComplexity: 77,
						rhythmComplexity: 77,
						recentScores: [0.95],
						recentPitchScores: [0.95],
						recentRhythmScores: [0.95],
						attemptsAtLevel: 5,
						attemptsSinceChange: 2,
						pitchAttemptsSinceChange: 2,
						rhythmAttemptsSinceChange: 2
					}
				})
			)
		);

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// Cloud's single session is much older, so local's adaptive wins.
		mockLoadProgress.mockResolvedValue(progressWith([session('cloud-1', 100_000)]));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// Local adaptive state preserved — local practiced more recently.
		expect(progressModule.progress.adaptive.currentLevel).toBe(77);
		// Forward-compat defaults still fill any missing fields.
		expect(Array.isArray(progressModule.progress.adaptive.recentPitchScores)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Merge rule: cloud >= local → cloud wins
// ---------------------------------------------------------------------------

describe('merge rule — union regardless of which side has more', () => {
	it('unions local and cloud when cloud has more (local sessions survive)', async () => {
		store.set(
			'mankunku:progress',
			JSON.stringify(progressWith([session('local-1', 1), session('local-2', 2)]))
		);

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		const cloud = Array.from({ length: 50 }, (_, i) => session(`cloud-${i}`, 10 + i));
		mockLoadProgress.mockResolvedValue(progressWith(cloud));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// New contract: UNION (was "cloud replaces local"). Local's 2 sessions
		// survive alongside the 50 cloud ones — 52 distinct, under the 100 cap.
		const ids = new Set(progressModule.progress.sessions.map((s) => s.id));
		expect(progressModule.progress.sessions).toHaveLength(52);
		expect(ids.has('local-1')).toBe(true);
		expect(ids.has('local-2')).toBe(true);
		for (let i = 0; i < 50; i++) expect(ids.has(`cloud-${i}`)).toBe(true);
	});

	it('equal session counts → union keeps all distinct ids from both sides', async () => {
		store.set(
			'mankunku:progress',
			JSON.stringify(
				progressWith([session('local-1'), session('local-2'), session('local-3')])
			)
		);

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue(
			progressWith([session('cloud-1'), session('cloud-2'), session('cloud-3')])
		);

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// New contract: equal counts no longer means "cloud wins" — all 6 distinct
		// sessions are retained by the union merge.
		const ids = new Set(progressModule.progress.sessions.map((s) => s.id));
		expect(ids).toEqual(
			new Set(['local-1', 'local-2', 'local-3', 'cloud-1', 'cloud-2', 'cloud-3'])
		);
	});

	it('applies the 100-session cap to legacy oversized cloud payloads', async () => {
		// Cloud payload written by an older client with cap=200.
		const cloud = Array.from({ length: 200 }, (_, i) => session(`cloud-${i}`, i));
		mockLoadProgress.mockResolvedValue(progressWith(cloud));

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		expect(progressModule.progress.sessions).toHaveLength(100);
	});
});

// ---------------------------------------------------------------------------
// Local-only fields — lickProgress survives cloud hydration
// ---------------------------------------------------------------------------

describe('lickProgress is never clobbered by cloud hydration', () => {
	it('preserves lickProgress when cloud wins', async () => {
		store.set(
			'mankunku:progress',
			JSON.stringify(
				progressWith([session('local-1')], {
					lickProgress: {
						'lick-1': {
							phraseId: 'lick-1',
							phraseName: 'My Lick',
							bestScore: 0.9,
							bestScoreAt: Date.now(),
							lastScore: 0.85,
							lastAttemptAt: Date.now(),
							attempts: 5
						} as unknown as UserProgress['lickProgress'][string]
					}
				})
			)
		);

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue(
			progressWith(
				Array.from({ length: 10 }, (_, i) => session(`cloud-${i}`)),
				{ lickProgress: {} }
			)
		);

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// Cloud won the session merge, but lickProgress is explicitly preserved.
		expect(progressModule.progress.lickProgress['lick-1']).toBeDefined();
	});

	it('preserves lickProgress when local wins', async () => {
		store.set(
			'mankunku:progress',
			JSON.stringify(
				progressWith(Array.from({ length: 50 }, (_, i) => session(`local-${i}`)), {
					lickProgress: {
						'lick-2': {
							phraseId: 'lick-2',
							phraseName: 'Another',
							bestScore: 0.7,
							bestScoreAt: Date.now(),
							lastScore: 0.7,
							lastAttemptAt: Date.now(),
							attempts: 2
						} as unknown as UserProgress['lickProgress'][string]
					}
				})
			)
		);

		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		mockLoadProgress.mockResolvedValue(progressWith([session('cloud-1')]));

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		expect(progressModule.progress.lickProgress['lick-2']).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Adaptive state forward-compat
// ---------------------------------------------------------------------------

describe('adaptive state — forward-compat merge', () => {
	it('fills in missing fields when cloud payload is from an older schema', async () => {
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		// Legacy cloud payload missing recentPitchScores / recentRhythmScores.
		const partialAdaptive = {
			currentLevel: 50,
			pitchComplexity: 50,
			rhythmComplexity: 50,
			recentScores: [0.8],
			attemptsAtLevel: 3,
			attemptsSinceChange: 1
			// Missing: recentPitchScores, recentRhythmScores, pitchAttemptsSinceChange, rhythmAttemptsSinceChange
		};

		mockLoadProgress.mockResolvedValue({
			...progressWith([session('cloud-1'), session('cloud-2')]),
			adaptive: partialAdaptive as unknown as UserProgress['adaptive']
		});

		const supabase = { auth: {} };
		await progressModule.initFromCloud(supabase as never);

		// Cloud value wins for known fields…
		expect(progressModule.progress.adaptive.currentLevel).toBe(50);
		// …and forward-compat defaults fill in the missing ones, so nothing crashes
		// when downstream code reads recentPitchScores.
		expect(Array.isArray(progressModule.progress.adaptive.recentPitchScores)).toBe(true);
	});

	it('tolerates unknown future fields in the adaptive payload (does not throw)', async () => {
		// A future schema may add fields the current client doesn't know about.
		// The merge should pass them through harmlessly — no exceptions, no
		// silent corruption of known fields.
		vi.resetModules();
		const progressModule = await import('$lib/state/progress.svelte');

		const futureAdaptive = {
			currentLevel: 25,
			pitchComplexity: 25,
			rhythmComplexity: 25,
			recentScores: [0.7],
			recentPitchScores: [0.7],
			recentRhythmScores: [0.7],
			attemptsAtLevel: 2,
			attemptsSinceChange: 1,
			pitchAttemptsSinceChange: 1,
			rhythmAttemptsSinceChange: 1,
			// Future fields the client doesn't yet read — must not break
			// initFromCloud's Object.assign / spread.
			futureMetric: 0.99,
			futurePolicy: { mode: 'aggressive' }
		};

		mockLoadProgress.mockResolvedValue({
			...progressWith([session('cloud-1'), session('cloud-2')]),
			adaptive: futureAdaptive as unknown as UserProgress['adaptive']
		});

		const supabase = { auth: {} };
		await expect(progressModule.initFromCloud(supabase as never)).resolves.toBeUndefined();

		// Known fields land correctly.
		expect(progressModule.progress.adaptive.currentLevel).toBe(25);
		expect(progressModule.progress.adaptive.recentPitchScores).toEqual([0.7]);
	});
});

// ---------------------------------------------------------------------------
// Recording upload — per-user path isolation
// ---------------------------------------------------------------------------

describe('recording upload — per-user path isolation', () => {
	it('places the blob under the authenticated user id', async () => {
		const { uploadRecording } = await import('$lib/persistence/sync');

		const uploadSpy = vi.fn().mockResolvedValue({ error: null });
		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } } })
			},
			storage: {
				from: vi.fn().mockReturnValue({
					upload: uploadSpy,
					list: vi.fn().mockResolvedValue({ data: [], error: null }),
					remove: vi.fn().mockResolvedValue({ error: null })
				})
			}
		};

		await uploadRecording(supabase as never, 'session-abc', new Blob(['x']));

		expect(uploadSpy).toHaveBeenCalled();
		const pathArg = uploadSpy.mock.calls[0][0] as string;
		// Upload path must be scoped to the authenticated user so one user
		// cannot read another's recordings even with a leaked session id.
		expect(pathArg).toContain('user-A');
		expect(pathArg).toContain('session-abc');
	});

	it('rejects recordings with path-traversal session ids', async () => {
		const { uploadRecording } = await import('$lib/persistence/sync');

		const uploadSpy = vi.fn().mockResolvedValue({ error: null });
		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } } })
			},
			storage: {
				from: vi.fn().mockReturnValue({
					upload: uploadSpy,
					list: vi.fn().mockResolvedValue({ data: [], error: null }),
					remove: vi.fn().mockResolvedValue({ error: null })
				})
			}
		};

		await uploadRecording(supabase as never, '../../etc/passwd', new Blob(['x']));

		// No upload attempted with the unsafe id.
		expect(uploadSpy).not.toHaveBeenCalled();
	});

	it('writes to distinct paths for distinct authenticated users', async () => {
		const { uploadRecording } = await import('$lib/persistence/sync');

		const uploadSpyA = vi.fn().mockResolvedValue({ error: null });
		const uploadSpyB = vi.fn().mockResolvedValue({ error: null });

		const clientA = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-A' } } })
			},
			storage: {
				from: vi.fn().mockReturnValue({
					upload: uploadSpyA,
					list: vi.fn().mockResolvedValue({ data: [], error: null }),
					remove: vi.fn().mockResolvedValue({ error: null })
				})
			}
		};
		const clientB = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-B' } } })
			},
			storage: {
				from: vi.fn().mockReturnValue({
					upload: uploadSpyB,
					list: vi.fn().mockResolvedValue({ data: [], error: null }),
					remove: vi.fn().mockResolvedValue({ error: null })
				})
			}
		};

		await uploadRecording(clientA as never, 'session-1', new Blob(['a']));
		await uploadRecording(clientB as never, 'session-1', new Blob(['b']));

		const pathA = uploadSpyA.mock.calls[0][0] as string;
		const pathB = uploadSpyB.mock.calls[0][0] as string;
		expect(pathA).not.toBe(pathB);
		expect(pathA).toContain('user-A');
		expect(pathB).toContain('user-B');
	});
});

// ---------------------------------------------------------------------------
// Last-write-wins characterization (upsert timestamping)
// ---------------------------------------------------------------------------

describe('syncSettingsToCloud timestamps every upsert', () => {
	it('stamps updated_at with the current time on every write', async () => {
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');

		const upsertSpy = vi.fn().mockResolvedValue({ error: null });
		const supabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })
			},
			from: vi.fn().mockReturnValue({ upsert: upsertSpy })
		};

		const settings = {
			instrumentId: 'tenor-sax',
			defaultTempo: 120,
			masterVolume: 0.8,
			metronomeEnabled: true,
			metronomeVolume: 0.6,
			backingTrackEnabled: true,
			backingInstrument: 'piano',
			backingTrackVolume: 0.6,
			swing: 0.5,
			theme: 'dark',
			onboardingComplete: true,
			tonalityOverride: null,
			highestNote: null,
			backingStyle: 'swing',
			bleedFilterEnabled: false
		};

		const beforeMs = Date.now();
		await syncSettingsToCloud(supabase as never, settings);
		const afterMs = Date.now();

		expect(upsertSpy).toHaveBeenCalledTimes(1);
		const row = upsertSpy.mock.calls[0][0] as { updated_at: string };
		expect(row.updated_at).toBeDefined();
		const stamped = new Date(row.updated_at).getTime();
		// Should be within the test's wall-clock window.
		expect(stamped).toBeGreaterThanOrEqual(beforeMs);
		expect(stamped).toBeLessThanOrEqual(afterMs);
	});
});
