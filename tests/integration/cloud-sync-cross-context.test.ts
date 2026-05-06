/**
 * Cloud sync — cross-device write conflict resolution (LWW characterization).
 *
 * Two devices edit the same row offline; both come online at different times.
 * The cloud-sync-mocks harness already supports this with `clockStepMs` and
 * `setClock`, but no existing test exercises the multi-device write path. This
 * file pins down last-write-wins semantics for settings and user_settings.
 *
 * The harness's upsert handler stamps `updated_at` from `cloud.nowMs()` when
 * the row doesn't carry an explicit timestamp (mocks line 276-278). Tests can
 * advance the clock between writes to control ordering deterministically —
 * the same property real Postgres provides via NOW().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	createCloudState,
	mockSupabaseFromCloud,
	seed,
	peek,
	setClock
} from '../helpers/cloud-sync-mocks';

vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'http://localhost:54321',
	PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key'
}));

// localStorage stub — every test starts clean
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

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
});

interface SettingsPayload {
	instrumentId: string;
	defaultTempo: number;
	masterVolume: number;
	metronomeEnabled: boolean;
	metronomeVolume: number;
	backingTrackEnabled: boolean;
	backingInstrument: string;
	backingTrackVolume: number;
	swing: number;
	theme: string;
	onboardingComplete: boolean;
	tonalityOverride: unknown;
	highestNote: number | null;
}

function settingsRow(overrides: Partial<SettingsPayload> = {}): SettingsPayload {
	return {
		instrumentId: 'tenor-sax',
		defaultTempo: 100,
		masterVolume: 0.8,
		metronomeEnabled: true,
		metronomeVolume: 0.7,
		backingTrackEnabled: true,
		backingInstrument: 'piano',
		backingTrackVolume: 0.6,
		swing: 0.5,
		theme: 'dark',
		onboardingComplete: true,
		tonalityOverride: null,
		highestNote: null,
		...overrides
	};
}

describe('LWW — two devices write to same settings row', () => {
	it('newer updated_at wins; a third device pulling the cloud sees the latest', async () => {
		const cloud = createCloudState();
		setClock(cloud, 1000);
		// Pre-existing cloud row written at T=1000
		seed(cloud, 'user_settings', [
			{
				user_id: 'user-A',
				instrument_id: 'tenor-sax',
				default_tempo: 100,
				master_volume: 0.8,
				metronome_enabled: true,
				metronome_volume: 0.7,
				backing_track_enabled: true,
				backing_instrument: 'piano',
				backing_track_volume: 0.6,
				swing: 0.5,
				theme: 'dark',
				onboarding_complete: true,
				tonality_override: null,
				highest_note: null,
				updated_at: new Date(1000).toISOString()
			}
		]);

		const { syncSettingsToCloud } = await import('$lib/persistence/sync');

		// Device B writes at T=1500 (older edit, finishes uploading first)
		setClock(cloud, 1500);
		const deviceB = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncSettingsToCloud>[0];
		await syncSettingsToCloud(deviceB, settingsRow({ defaultTempo: 80 }));

		// Device A writes at T=2000 (newer edit, finishes uploading later — but
		// because it has the newer `updated_at`, it should win)
		setClock(cloud, 2000);
		const deviceA = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncSettingsToCloud>[0];
		await syncSettingsToCloud(deviceA, settingsRow({ defaultTempo: 140 }));

		// Cloud should now hold Device A's value (the later write)
		const rows = peek(cloud, 'user_settings');
		expect(rows).toHaveLength(1);
		expect(rows[0].default_tempo).toBe(140);

		// Third device C pulls — sees the winning value
		const { loadSettingsFromCloud } = await import('$lib/persistence/sync');
		const deviceC = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof loadSettingsFromCloud>[0];
		const pulled = await loadSettingsFromCloud(deviceC);
		expect(pulled?.defaultTempo).toBe(140);
	});

	it('writes by different users land in different rows (no cross-user clobber)', async () => {
		const cloud = createCloudState();
		const { syncSettingsToCloud } = await import('$lib/persistence/sync');

		// Device-A as user-A
		const userA = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncSettingsToCloud>[0];
		await syncSettingsToCloud(userA, settingsRow({ defaultTempo: 100, theme: 'dark' }));

		// Device-A as user-B (e.g. signed out then in as a different user)
		const userB = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-B' }
		}) as Parameters<typeof syncSettingsToCloud>[0];
		await syncSettingsToCloud(userB, settingsRow({ defaultTempo: 200, theme: 'light' }));

		const rows = peek(cloud, 'user_settings');
		expect(rows).toHaveLength(2);
		const a = rows.find((r) => r.user_id === 'user-A');
		const b = rows.find((r) => r.user_id === 'user-B');
		expect(a?.default_tempo).toBe(100);
		expect(b?.default_tempo).toBe(200);
		// User A's settings are not visible to user B
		expect(a?.theme).toBe('dark');
		expect(b?.theme).toBe('light');
	});

	it('unauthenticated upsert is a no-op — cloud unchanged', async () => {
		const cloud = createCloudState();
		seed(cloud, 'user_settings', [
			{
				user_id: 'user-A',
				default_tempo: 100,
				updated_at: new Date(1000).toISOString()
			}
		]);

		const { syncSettingsToCloud } = await import('$lib/persistence/sync');
		const anonClient = mockSupabaseFromCloud(cloud, {
			auth: { userId: null }
		}) as Parameters<typeof syncSettingsToCloud>[0];
		await syncSettingsToCloud(anonClient, settingsRow({ defaultTempo: 999 }));

		const rows = peek(cloud, 'user_settings');
		expect(rows).toHaveLength(1);
		expect(rows[0].default_tempo).toBe(100); // unchanged
	});
});

describe('LWW — two devices write to same user_progress row', () => {
	it('newer updated_at wins; older overwrite is dropped on subsequent fetch', async () => {
		const cloud = createCloudState();
		const { syncProgressToCloud, loadProgressFromCloud } = await import(
			'$lib/persistence/sync'
		);

		const baseProgress = {
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

		// Device B writes first (older clock, lower level)
		setClock(cloud, 1000);
		const deviceB = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncProgressToCloud>[0];
		await syncProgressToCloud(deviceB, {
			...baseProgress,
			adaptive: { ...baseProgress.adaptive, currentLevel: 30 }
		});

		// Device A writes second (newer clock, higher level — should win)
		setClock(cloud, 2000);
		const deviceA = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof syncProgressToCloud>[0];
		await syncProgressToCloud(deviceA, {
			...baseProgress,
			adaptive: { ...baseProgress.adaptive, currentLevel: 70 }
		});

		const rows = peek(cloud, 'user_progress');
		expect(rows).toHaveLength(1);
		expect((rows[0].adaptive_state as { currentLevel: number }).currentLevel).toBe(70);

		// Third device pulling sees the winner
		const deviceC = mockSupabaseFromCloud(cloud, {
			auth: { userId: 'user-A' }
		}) as Parameters<typeof loadProgressFromCloud>[0];
		const pulled = await loadProgressFromCloud(deviceC);
		expect(pulled?.adaptive.currentLevel).toBe(70);
	});
});
