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
	syncProgressToCloud: vi.fn().mockResolvedValue(true),
	// loadProgress/loadSettings are now tri-state (CloudLoad<T>): tests drive the
	// bare payload via the mocks and these wrappers adapt it to
	// { status:'ok', data } / { status:'empty' }. loadLickMetadata is already
	// tri-state in the tests below, so it stays a direct pass-through.
	loadProgressFromCloud: async (...args: unknown[]) => {
		const data = await mockLoadProgress(...args);
		return data == null ? { status: 'empty' } : { status: 'ok', data };
	},
	deleteProgressDetailsFromCloud: vi.fn().mockResolvedValue(undefined),
	deleteDailySummariesFromCloud: vi.fn().mockResolvedValue(undefined),
	syncSettingsToCloud: vi.fn().mockResolvedValue(true),
	loadSettingsFromCloud: async (...args: unknown[]) => {
		const data = await mockLoadSettings(...args);
		// An explicit tri-state ({ status: 'error' }) passes straight through —
		// a settings payload never carries a `status` key.
		if (data && typeof data === 'object' && 'status' in data) return data;
		return data == null ? { status: 'empty' } : { status: 'ok', data };
	},
	syncLickMetadataToCloud: vi.fn().mockResolvedValue(undefined),
	upsertLickMetadataRow: vi.fn().mockResolvedValue(undefined),
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
// Settings push gate — never push over a row this session could not read
// ---------------------------------------------------------------------------

describe('settings.flushSettingsToCloud — push gate (the 2026-07-13 class)', () => {
	async function freshSettings() {
		vi.resetModules();
		const settingsModule = await import('$lib/state/settings.svelte');
		const sync = await import('$lib/persistence/sync');
		return { settingsModule, push: vi.mocked(sync.syncSettingsToCloud) };
	}

	it('THROWS and never pushes before any hydration this session', async () => {
		const { settingsModule, push } = await freshSettings();

		await expect(settingsModule.flushSettingsToCloud({ auth: {} } as never)).rejects.toThrow(
			/not hydrated/
		);
		expect(push).not.toHaveBeenCalled();
	});

	it("an 'error' read keeps local settings intact and leaves the gate CLOSED — the flush still throws", async () => {
		store.set('mankunku:settings', JSON.stringify({ defaultTempo: 77 }));
		const { settingsModule, push } = await freshSettings();
		const storedBefore = store.get('mankunku:settings');
		mockLoadSettings.mockResolvedValue({ status: 'error' });

		await settingsModule.loadSettingsFromCloud({ auth: {} } as never);

		expect(settingsModule.settings.defaultTempo).toBe(77);
		expect(store.get('mankunku:settings')).toBe(storedBefore);
		await expect(settingsModule.flushSettingsToCloud({ auth: {} } as never)).rejects.toThrow(
			/not hydrated/
		);
		expect(push).not.toHaveBeenCalled();
	});

	it("an 'empty' read (a fresh account) opens the gate: the flush pushes the local settings", async () => {
		store.set('mankunku:settings', JSON.stringify({ defaultTempo: 77 }));
		const { settingsModule, push } = await freshSettings();
		mockLoadSettings.mockResolvedValue(null);

		await settingsModule.loadSettingsFromCloud({ auth: {} } as never);
		await settingsModule.flushSettingsToCloud({ auth: {} } as never);

		expect(push).toHaveBeenCalledTimes(1);
		expect(push.mock.calls[0][1]).toMatchObject({ defaultTempo: 77 });
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
			status: 'ok',
			data: {
				lickTags: { 'lick-1': ['practice'] },
				practiceProgress: { 'lick-1': { C: { currentTempo: 120, lastPracticedAt: 1, passCount: 3 } } },
				tagOverrides: { 'curated-1': ['practice'] },
				categoryOverrides: { 'curated-2': 'modal' },
				unlockCounts: { 'lick-1': 5 }
			}
		});

		const supabase = { auth: {} };
		const ok = await lickStore.initLickMetadataFromCloud(supabase as never);

		// The mid-flight switch must also be reported as a failed hydration so
		// downstream maintenance (reconcile + backfill) stays gated off.
		expect(ok).toBe(false);

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

		// The hydration now does a per-id merge, not a whole-column overwrite. For
		// the cloud entry to win into an EMPTY local blob it must carry a client
		// mtime (mergeMeta.tags) — a tie at mtime 0 would keep the (empty) local
		// side. A real cross-device pull always carries these stamps.
		mockLoadLickMetadata.mockResolvedValue({
			status: 'ok',
			data: {
				lickTags: { 'lick-1': ['practice'] },
				practiceProgress: {},
				tagOverrides: {},
				categoryOverrides: {},
				unlockCounts: {}
			},
			mergeMeta: { tags: { 'lick-1': Date.now() } }
		});

		const supabase = { auth: {} };
		const ok = await lickStore.initLickMetadataFromCloud(supabase as never);

		expect(ok).toBe(true);
		expect(store.has('mankunku:user-lick-tags')).toBe(true);
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual({
			'lick-1': ['practice']
		});
	});

	it('merges the cloud __migrations marker into a populated local blob (marker durability)', async () => {
		vi.resetModules();
		const lickStore = await import('$lib/persistence/lick-practice-store');

		getScopeGenerationMock.mockReturnValue(0);

		// Device B: local tags blob predates the marker another device stamped.
		store.set(
			'mankunku:user-lick-tags',
			JSON.stringify({ 'lick-local': ['practice', 'prog:blues'] })
		);

		mockLoadLickMetadata.mockResolvedValue({
			status: 'ok',
			data: {
				lickTags: {
					'lick-cloud': ['practice'],
					'__migrations': ['prog-backfill-v1']
				},
				practiceProgress: {},
				tagOverrides: {},
				categoryOverrides: {},
				unlockCounts: {}
			}
		});

		const supabase = { auth: {} };
		const ok = await lickStore.initLickMetadataFromCloud(supabase as never);

		expect(ok).toBe(true);
		const localTags = JSON.parse(store.get('mankunku:user-lick-tags')!);
		// Per-entry merge (not "populated local wins"): the local-only entry is
		// kept AND the cloud-only entry is merged in — neither is dropped. A
		// cloud value with no merge_meta must survive (an absent entry is a
		// deletion only when the other side stamped a strictly-newer write).
		expect(localTags['lick-local']).toEqual(['practice', 'prog:blues']);
		expect(localTags['lick-cloud']).toEqual(['practice']);
		// The reserved marker merges down too, so this device can never re-run a
		// one-time migration another device already completed.
		expect(localTags['__migrations']).toContain('prog-backfill-v1');
	});

	it("an 'error' read reports false, leaves local untouched, and queues NO push (the 2026-07-13 class)", async () => {
		vi.resetModules();
		const lickStore = await import('$lib/persistence/lick-practice-store');
		getScopeGenerationMock.mockReturnValue(0);

		store.set('mankunku:user-lick-tags', JSON.stringify({ 'lick-local': ['practice'] }));
		store.set(
			'mankunku:lick-practice-progress',
			JSON.stringify({ 'lick-local': { C: { currentTempo: 88, lastPracticedAt: 1, passCount: 2 } } })
		);
		mockLoadLickMetadata.mockResolvedValue({ status: 'error' });

		const ok = await lickStore.initLickMetadataFromCloud({ auth: {} } as never);

		expect(ok).toBe(false);
		// Every blob is byte-identical: no merge against an unknown cloud.
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual({ 'lick-local': ['practice'] });
		expect(JSON.parse(store.get('mankunku:lick-practice-progress')!)).toEqual({
			'lick-local': { C: { currentTempo: 88, lastPracticedAt: 1, passCount: 2 } }
		});
		expect(store.has('mankunku:lick-merge-meta')).toBe(false);
		// And nothing was queued for the outbox to push over the intact cloud row.
		expect(store.has('mankunku:outbox')).toBe(false);
	});
});

describe('lick-metadata.flushLickMetadataToCloud — the outbox write path', () => {
	async function freshStore() {
		vi.resetModules();
		const lickStore = await import('$lib/persistence/lick-practice-store');
		const sync = await import('$lib/persistence/sync');
		getScopeGenerationMock.mockReturnValue(0);
		return { lickStore, upsert: vi.mocked(sync.upsertLickMetadataRow) };
	}

	it("THROWS on an 'error' read and never upserts — no merge-against-empty", async () => {
		const { lickStore, upsert } = await freshStore();
		store.set('mankunku:user-lick-tags', JSON.stringify({ 'lick-local': ['practice'] }));
		mockLoadLickMetadata.mockResolvedValue({ status: 'error' });

		await expect(lickStore.flushLickMetadataToCloud({ auth: {} } as never)).rejects.toThrow(
			/deferring push/
		);
		expect(upsert).not.toHaveBeenCalled();
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual({ 'lick-local': ['practice'] });
	});

	it("seeds a fresh cloud row from local on an 'empty' read", async () => {
		const { lickStore, upsert } = await freshStore();
		store.set('mankunku:user-lick-tags', JSON.stringify({ 'lick-local': ['practice'] }));
		store.set('mankunku:lick-unlock-count', JSON.stringify({ 'lick-local': 4 }));
		mockLoadLickMetadata.mockResolvedValue({ status: 'empty' });

		await lickStore.flushLickMetadataToCloud({ auth: {} } as never);

		expect(upsert).toHaveBeenCalledTimes(1);
		const [, data] = upsert.mock.calls[0];
		expect(data.lickTags).toEqual({ 'lick-local': ['practice'] });
		expect(data.unlockCounts).toEqual({ 'lick-local': 4 });
	});

	it("folds the cloud row in on an 'ok' read: both sides converge locally AND in the pushed row", async () => {
		const { lickStore, upsert } = await freshStore();
		store.set('mankunku:user-lick-tags', JSON.stringify({ 'lick-local': ['prog:blues'] }));
		store.set('mankunku:lick-merge-meta', JSON.stringify({ tags: { 'lick-local': 500 } }));
		mockLoadLickMetadata.mockResolvedValue({
			status: 'ok',
			data: {
				lickTags: { 'lick-local': ['practice'], 'lick-cloud': ['practice'] },
				practiceProgress: {},
				tagOverrides: {},
				categoryOverrides: {},
				unlockCounts: { 'lick-cloud': 7 },
				progressHistory: {}
			},
			mergeMeta: { tags: { 'lick-local': 100, 'lick-cloud': 100 } }
		});

		await lickStore.flushLickMetadataToCloud({ auth: {} } as never);

		const [, data, mergeMeta] = upsert.mock.calls[0];
		// Local's newer stamp wins its own id; the cloud-only id survives; the
		// cloud-only unlock count survives.
		expect(data.lickTags).toEqual({ 'lick-local': ['prog:blues'], 'lick-cloud': ['practice'] });
		expect(data.unlockCounts).toEqual({ 'lick-cloud': 7 });
		expect(mergeMeta.tags).toEqual({ 'lick-local': 500, 'lick-cloud': 100 });
		// The merged result was saved locally too (both sides converge).
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual(data.lickTags);
		expect(JSON.parse(store.get('mankunku:lick-unlock-count')!)).toEqual({ 'lick-cloud': 7 });
	});

	it('aborts silently (no throw, no upsert, no local write) when the user switches mid-flight', async () => {
		const { lickStore, upsert } = await freshStore();
		store.set('mankunku:user-lick-tags', JSON.stringify({ 'lick-local': ['practice'] }));
		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});
		mockLoadLickMetadata.mockResolvedValue({
			status: 'ok',
			data: {
				lickTags: { 'lick-cloud': ['practice'] },
				practiceProgress: {},
				tagOverrides: {},
				categoryOverrides: {},
				unlockCounts: {},
				progressHistory: {}
			},
			mergeMeta: { tags: { 'lick-cloud': 100 } }
		});

		await expect(lickStore.flushLickMetadataToCloud({ auth: {} } as never)).resolves.toBeUndefined();
		expect(upsert).not.toHaveBeenCalled();
		expect(JSON.parse(store.get('mankunku:user-lick-tags')!)).toEqual({ 'lick-local': ['practice'] });
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

	it('flushUserLicksToCloud THROWS on a mid-flight switch so the outbox keeps (or uid-gates) the intent', async () => {
		vi.resetModules();
		const userLicks = await import('$lib/persistence/user-licks');

		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		const supabase = makeQueryClient({ userId: 'user-A', tableData: { user_licks: [] } });

		// A silent resolve here would let the drain DELETE the intent as
		// handled while the reconcile never ran.
		await expect(userLicks.flushUserLicksToCloud(supabase as never)).rejects.toThrow(/aborted/);
		expect(store.has('mankunku:user-licks')).toBe(false);
	});
});

describe('user-tunes.initTunesFromCloud — scope generation guard', () => {
	const cloudTune = {
		id: 'cloud-tune',
		user_id: 'user-A',
		title: 'Cloud',
		composer: null,
		key: 'C',
		time_signature: [4, 4],
		style: null,
		tags: [],
		sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
		difficulty: null,
		source: 'user',
		pdf_url: null,
		favorite_count: 0,
		deleted_at: null,
		client_mtime: 100,
		created_at: '',
		updated_at: ''
	};

	it('reports false and writes nothing when the user switches mid-flight', async () => {
		vi.resetModules();
		const userTunes = await import('$lib/persistence/user-tunes');

		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		const supabase = makeQueryClient({ userId: 'user-A', tableData: { tunes: [cloudTune] } });
		const ok = await userTunes.initTunesFromCloud(supabase as never);

		expect(ok).toBe(false);
		expect(store.has('mankunku:user-tunes')).toBe(false);
		expect(store.has('mankunku:user-tunes-meta')).toBe(false);
	});

	it('flushTunesToCloud THROWS on the same switch (outbox contract)', async () => {
		vi.resetModules();
		const userTunes = await import('$lib/persistence/user-tunes');

		let callCount = 0;
		getScopeGenerationMock.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? 0 : 1;
		});

		const supabase = makeQueryClient({ userId: 'user-A', tableData: { tunes: [cloudTune] } });
		await expect(userTunes.flushTunesToCloud(supabase as never)).rejects.toThrow(/aborted/);
		expect(store.has('mankunku:user-tunes')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Hydration timeout — fire-and-forget + bounded opt-in
//
// `+layout.ts` no longer blocks the page mount on cloud hydration: it registers
// the hydration promise fire-and-forget via `setHydrationPromise()` so render
// is never stalled. Routes that snapshot hydrated state at mount opt back into
// a wait that is bounded at 2s by `awaitHydration()` in src/lib/state/hydration.ts.
// Verify that the production sources still encode this structure.
// ---------------------------------------------------------------------------

describe('hydration timeout — fire-and-forget + bounded opt-in', () => {
	it('production +layout.ts hydrates fire-and-forget (does not await the race)', async () => {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const src = readFileSync(
			fileURLToPath(new URL('../../src/routes/+layout.ts', import.meta.url)),
			'utf8'
		);
		// The hydration promise must be registered for background completion…
		expect(
			src,
			'src/routes/+layout.ts must register the background hydration via setHydrationPromise() so render is not blocked.'
		).toMatch(/setHydrationPromise\(/);
		// …and must NOT await a blocking race on `hydration` (the old behaviour
		// that stalled every cold load up to 2s).
		expect(
			src,
			'src/routes/+layout.ts must NOT `await Promise.race([hydration, ...])` — that blocking race was replaced by fire-and-forget. The 2s bound now lives in awaitHydration().'
		).not.toMatch(/await\s+Promise\.race\(\s*\[\s*hydration/);
	});

	it('production +layout.ts fans out initializers via allSettled, not bare Promise.all', async () => {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const src = readFileSync(
			fileURLToPath(new URL('../../src/routes/+layout.ts', import.meta.url)),
			'utf8'
		);
		// One rejecting initializer (e.g. initTunesFromCloud) must not abort the
		// recompute → cloud-summary reconcile → drainOutbox chain for the session.
		// Member-order-independent: the file has exactly one Promise combinator
		// fan-out, so pin the combinator + membership, not the array ordering.
		expect(
			src,
			'src/routes/+layout.ts must fan out the cloud initializers with Promise.allSettled so one failure cannot skip recompute/reconcile/drainOutbox.'
		).toMatch(/Promise\.allSettled\(\s*\[[\s\S]{0,400}?\binitFromCloud\b/);
		expect(
			src,
			'src/routes/+layout.ts must not use a bare Promise.all for the initializer fan-out.'
		).not.toMatch(/Promise\.all\(\s*\[/);
	});

	it('the 2s bound lives in awaitHydration() so opt-in routes never hang', async () => {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const src = readFileSync(
			fileURLToPath(new URL('../../src/lib/state/hydration.ts', import.meta.url)),
			'utf8'
		);
		// awaitHydration() must keep a Promise.race against a setTimeout, with a
		// default 2000ms ceiling, so a slow cloud degrades to local state.
		expect(src).toMatch(/Promise\.race\(/);
		expect(src).toMatch(/setTimeout\(/);
		expect(
			src,
			'src/lib/state/hydration.ts awaitHydration() must default to a 2000ms timeout.'
		).toMatch(/timeoutMs\s*=\s*2000/);
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
