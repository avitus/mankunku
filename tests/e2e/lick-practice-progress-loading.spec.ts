import { test, expect } from './fixtures/test';
import { seedStorage, seedUserLicks, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, SUPABASE_URL } from './fixtures/stub-cloud';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

const USER = { id: 'aaaaaaaa-0000-4000-8000-000000000abc', email: 'tempo@e2e.dev' };
const LICK = 'e2e-user-lick-bebop';
const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

for (const entry of ['daily', 'detail'] as const) {
	test(`${entry} waits for saved progress before starting practice`, async ({ page, baseURL }) => {
		const progress = { [LICK]: Object.fromEntries(KEYS.map(key => [key, {
			currentTempo: 117, lastPracticedAt: 1000, passCount: 66, rollingScore: 0.95
		}])) };
		const cloud = createStubCloud();
		// This is an established, onboarded account in both storage layers.
		// An empty settings table lets the tour sync create a partial row,
		// racing settings hydration and reopening onboarding on slower runners.
		cloud.seedRow('user_settings', {
			user_id: USER.id,
			instrument_id: SETTINGS_ONBOARDED.instrumentId,
			default_tempo: SETTINGS_ONBOARDED.defaultTempo,
			master_volume: SETTINGS_ONBOARDED.masterVolume,
			metronome_enabled: SETTINGS_ONBOARDED.metronomeEnabled,
			metronome_volume: SETTINGS_ONBOARDED.metronomeVolume,
			swing: SETTINGS_ONBOARDED.swing,
			theme: SETTINGS_ONBOARDED.theme,
			onboarding_complete: true,
			tour_state: TOUR_DISMISSED
		});
		cloud.seedRow('user_lick_metadata', {
			user_id: USER.id, practice_progress: progress,
			lick_tags: { [LICK]: ['practice', 'prog:ii-V-I-major'] },
			unlock_counts: { [LICK]: 12 }, merge_meta: {}, progress_history: {},
			tag_overrides: {}, category_overrides: {}
		});
		await installStubCloud(page.context(), cloud, USER, baseURL!);
		await seedStorage(page, {
			settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED,
			'user-lick-tags': { [LICK]: ['practice', 'prog:ii-V-I-major'] },
			'lick-unlock-count': { [LICK]: 12 }
		});
		await seedUserLicks(page);
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		let release!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		await page.route(`${SUPABASE_URL}/rest/v1/user_lick_metadata*`, async route => {
			if (route.request().method() === 'GET') await held;
			await route.fallback();
		});
		await page.goto(entry === 'daily' ? '/lick-practice' : `/licks/${LICK}`);
		const loading = page.getByRole('button', { name: 'Loading progress…', exact: true });
		try {
			await expect(loading).toBeDisabled();
			await expect(page.getByTestId('onboarding-overlay')).not.toBeVisible();
			await expect(page).not.toHaveURL(/\/lick-practice\/session$/);
		} finally {
			release();
		}
		const start = page.getByRole('button', {
			name: entry === 'daily' ? 'Start Daily Practice' : 'Practice', exact: true
		});
		await expect(start).toBeEnabled();
		await start.click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		const ring = page.locator('svg').filter({ hasText: 'BPM' });
		await expect(ring.locator('text', { hasText: entry === 'daily' ? /^117$/ : /^115$/ })).toBeVisible();
	});
}
