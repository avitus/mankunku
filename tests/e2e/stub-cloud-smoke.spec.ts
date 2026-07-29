import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud, type Row } from './fixtures/stub-cloud';
import type { E2ETestUser } from './fixtures/auth';

/**
 * SMOKE test for the in-memory stub-cloud plumbing (auth bridge + REST GET).
 *
 * If this fails, the auth/REST bridge is wrong and the convergence specs can't
 * be trusted — fix this first. It proves that:
 *   1. The seeded browser session cookie makes `supabase.auth.getUser()` return
 *      the user (routed /auth/v1/user), so the app's sync code is authenticated.
 *   2. A GET on `user_licks` returns the seeded cloud row, which the real
 *      `reconcileUserLicks` pulls down into local storage and the library renders.
 */

const USER: E2ETestUser = { id: 'aaaaaaaa-0000-4000-8000-000000000abc', email: 'smoke@e2e.dev' };

const CLOUD_LICK: Row = {
	id: 'cloud-smoke-lick',
	user_id: USER.id,
	name: 'Cloud Smoke Lick',
	key: 'C',
	time_signature: [4, 4],
	notes: [
		{ pitch: 60, duration: [1, 8], offset: [0, 1] },
		{ pitch: 62, duration: [1, 8], offset: [1, 8] },
		{ pitch: 64, duration: [1, 8], offset: [1, 4] }
	],
	harmony: [
		{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
	],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
	category: 'bebop-lines',
	tags: [],
	source: 'user-entered',
	favorite_count: 0,
	deleted_at: null,
	client_mtime: 1000,
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString()
};

test('stub-cloud: a cloud-only user lick is pulled down and rendered on /licks', async ({
	page,
	baseURL,
	consoleCollector: _consoleCollector
}) => {
	const cloud = createStubCloud();
	cloud.seedRow('user_licks', CLOUD_LICK);

	await installStubCloud(page.context(), cloud, USER, baseURL as string);
	// Onboarded locally, but NO local user-licks — the lick must arrive from cloud.
	await seedStorage(page, { settings: SETTINGS_ONBOARDED, 'tour-state': TOUR_DISMISSED });

	await page.goto('/licks');
	await page.waitForLoadState('networkidle');

	// The library reconcile (in +layout hydration AND the page's own effect)
	// pulls the cloud row into local storage and renders it.
	await expect(page.getByText('Cloud Smoke Lick')).toBeVisible({ timeout: 15_000 });

	// Local storage now contains the cloud lick (proves the pull landed on disk).
	await expect
		.poll(
			async () =>
				page.evaluate(
					(uid) => localStorage.getItem(`mankunku:u:${uid}:user-licks`) ?? '',
					USER.id
				),
			{ timeout: 15_000 }
		)
		.toContain('cloud-smoke-lick');
});
