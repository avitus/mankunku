import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { createStubCloud, installStubCloud } from './fixtures/stub-cloud';
import type { E2ETestUser } from './fixtures/auth';

/**
 * "Case 2": licks entered while signed OUT must not be silently absorbed into
 * the cloud account of whoever signs in next on the same browser origin.
 *
 * The original mechanism was: anonymous saves skipped the owner stamp, first
 * login deliberately did not wipe (to support the offline → first-login
 * migration), and hydration then pushed the unstamped licks up under the new
 * account. Per-user storage namespacing should close it structurally — the
 * anonymous bucket stays at the bare `mankunku:` path while an authenticated
 * user reads `mankunku:u:<uid>:`, so there is nothing local for hydration to
 * push. This test pins that, since the guarantee is now emergent from the
 * namespacing rather than enforced by any single check.
 */

const USER: E2ETestUser = { id: 'aaaaaaaa-0000-4000-8000-00000000abs1', email: 'absorb@e2e.dev' };

const ANON_LICK = {
	id: 'user-anon-lick-1',
	name: 'Anonymous Private Lick',
	timeSignature: [4, 4],
	key: 'C',
	notes: [
		{ pitch: 60, duration: [1, 8], offset: [0, 1] },
		{ pitch: 62, duration: [1, 8], offset: [1, 8] }
	],
	harmony: [
		{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}
	],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
	category: 'bebop-lines',
	tags: [],
	source: 'user-entered'
};

test('anonymous licks are not absorbed into the first account that signs in', async ({
	page,
	baseURL,
	consoleCollector: _c
}) => {
	const cloud = createStubCloud();

	// Seed BEFORE any auth cookie exists, so this lands in the bare anonymous
	// bucket exactly as a signed-out save would.
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'user-licks': [ANON_LICK]
	});

	// Now sign in as USER on the same origin.
	await installStubCloud(page.context(), cloud, USER, baseURL as string);

	await page.goto('/licks');
	await page.waitForLoadState('networkidle');
	// Generous settle: hydration + the durable outbox drain both have to have
	// had their chance to push before absence proves anything.
	await page.waitForTimeout(3000);

	// The account's cloud must not have gained the anonymous lick.
	const absorbed = cloud.rows('user_licks').filter((r) => r.id === ANON_LICK.id);
	expect(
		absorbed,
		'anonymous lick was pushed into the signed-in account'
	).toEqual([]);

	// And it must not surface in the signed-in library either.
	await expect(page.getByText('Anonymous Private Lick')).toHaveCount(0);
});

/**
 * Control for the test above. An "it was not pushed" assertion only means
 * something if this harness pushes at all — otherwise the absence proves the
 * push path was dead, not that isolation held. Same lick, same flow, seeded
 * into the SIGNED-IN user's bucket instead of the anonymous one.
 */
test('control: a lick in the signed-in bucket IS pushed to that account', async ({
	page,
	baseURL,
	consoleCollector: _c
}) => {
	const cloud = createStubCloud();

	// Cookies first, so seedStorage resolves the user's namespace.
	await installStubCloud(page.context(), cloud, USER, baseURL as string);
	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'user-licks': [ANON_LICK]
	});

	await page.goto('/licks');
	await page.waitForLoadState('networkidle');

	await expect
		.poll(() => cloud.rows('user_licks').map((r) => r.id as string), { timeout: 15_000 })
		.toContain(ANON_LICK.id);
});

test('the anonymous bucket still holds the lick after signing in', async ({
	page,
	baseURL,
	consoleCollector: _c
}) => {
	const cloud = createStubCloud();

	await seedStorage(page, {
		settings: SETTINGS_ONBOARDED,
		'tour-state': TOUR_DISMISSED,
		'user-licks': [ANON_LICK]
	});
	await installStubCloud(page.context(), cloud, USER, baseURL as string);

	await page.goto('/licks');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500);

	// Isolation must not mean destruction: the anonymous data is untouched at
	// the bare path, so signing out returns the user to it.
	const anonBucket = await page.evaluate(() => localStorage.getItem('mankunku:user-licks'));
	expect(anonBucket, 'anonymous bucket was cleared by signing in').toContain(ANON_LICK.id);
});
