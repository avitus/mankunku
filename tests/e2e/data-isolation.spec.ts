import { test, expect } from './fixtures/auth';
import { setE2EAuthCookie } from './fixtures/auth';
import { SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Per-user storage isolation (the leak/loss class behind the data-loss
 * incidents). Storage is namespaced under `mankunku:u:<uid>:<key>` for
 * authenticated users; switching accounts on one browser never leaks one
 * user's data into another's view and never WIPES the previous user's data.
 *
 * The e2e harness has no real Supabase, so these assert the CLIENT-SIDE
 * guarantees (isolation, no-wipe, re-home) — cross-device cloud convergence is
 * covered by the integration suite.
 */

const USER_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'alice@e2e.dev' };
const USER_B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'bob@e2e.dev' };

const ALICE_LICK = {
	id: 'iso-alice-lick',
	name: 'Alice Only Lick',
	timeSignature: [4, 4],
	key: 'C',
	notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
	harmony: [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }],
	difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: 1 },
	category: 'bebop-lines',
	tags: [],
	source: 'user-entered'
};

/** Keep the real browser Supabase client from hitting the network / erroring. */
async function stubSupabase(page: Page): Promise<void> {
	await page.route('**/rest/v1/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' })
	);
	await page.route('**/auth/v1/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
	);
}

/**
 * Seed BOTH users' namespaces at fixed, cookie-independent paths, so switching
 * the e2e-test-user cookie only changes which bucket the app reads. `__active`
 * starts pointed at A (and `__schema` stamped so the one-time upgrade is a
 * no-op). Alice gets a distinctive lick; Bob gets an onboarded-but-empty bucket.
 */
async function seedBothUsers(page: Page): Promise<void> {
	await page.addInitScript(
		({ a, b, settings, tour, lick }) => {
			const ROOT = 'mankunku:';
			const put = (key: string, value: unknown) => {
				if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
			};
			if (localStorage.getItem(`${ROOT}__schema`) === null) localStorage.setItem(`${ROOT}__schema`, '2');
			if (localStorage.getItem(`${ROOT}__active`) === null) localStorage.setItem(`${ROOT}__active`, JSON.stringify(a));
			// Alice: onboarded + one lick.
			put(`${ROOT}u:${a}:settings`, settings);
			put(`${ROOT}u:${a}:tour-state`, tour);
			put(`${ROOT}u:${a}:user-licks`, [lick]);
			// Bob: onboarded, no licks.
			put(`${ROOT}u:${b}:settings`, settings);
			put(`${ROOT}u:${b}:tour-state`, tour);
		},
		{ a: USER_A.id, b: USER_B.id, settings: SETTINGS_ONBOARDED, tour: TOUR_DISMISSED, lick: ALICE_LICK }
	);
}

/** Switch the signed-in user and land on a fresh /library, waiting for the app's re-home reload to settle. */
async function switchTo(page: Page, user: { id: string; email: string }): Promise<void> {
	await page.context().clearCookies();
	await setE2EAuthCookie(page, user);
	await page.goto('/library');
	await page.waitForLoadState('networkidle');
}

test.describe('per-user storage isolation', () => {
	test('a second user on the same browser never sees the first user’s licks, and the first user’s data survives the switch', async ({
		page
	}) => {
		await stubSupabase(page);
		await seedBothUsers(page);

		// Alice sees her lick.
		await setE2EAuthCookie(page, USER_A);
		await page.goto('/library');
		await page.waitForLoadState('networkidle');
		await expect(page.getByText('Alice Only Lick')).toBeVisible();

		// Alice's data is NAMESPACED (not at the bare legacy path).
		const keys = await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith('mankunku:'))
		);
		expect(keys).toContain(`mankunku:u:${USER_A.id}:user-licks`);
		expect(keys).not.toContain('mankunku:user-licks'); // no bare leak

		// Switch to Bob → Alice's lick must NOT be visible (isolation).
		await switchTo(page, USER_B);
		await expect(page.getByText('Alice Only Lick')).toHaveCount(0);

		// Alice's bucket still exists on the device (not wiped by the switch).
		const afterSwitch = await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith('mankunku:'))
		);
		expect(afterSwitch).toContain(`mankunku:u:${USER_A.id}:user-licks`);

		// Switch back to Alice → her lick is intact (no loss).
		await switchTo(page, USER_A);
		await expect(page.getByText('Alice Only Lick')).toBeVisible();
	});

	test('signing out does not wipe the user’s local data (local-first survival)', async ({ page }) => {
		await stubSupabase(page);
		await seedBothUsers(page);

		await setE2EAuthCookie(page, USER_A);
		await page.goto('/settings');
		await page.waitForLoadState('networkidle');

		// Sanity: Alice's bucket is present before sign-out.
		const before = await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith(`mankunku:u:${'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}:`))
		);
		expect(before.length).toBeGreaterThan(0);

		// Sign out via the real logout form. The desktop control lives inside a
		// <details> account dropdown — open it, then click Sign Out.
		await page.locator('details > summary').first().click();
		await page.getByRole('button', { name: /sign out/i }).first().click();
		await page.waitForURL(/\/auth/, { timeout: 15_000 });
		await page.waitForLoadState('networkidle');

		// Alice's namespaced data SURVIVES sign-out (re-homed to anon, not wiped).
		const after = await page.evaluate(() =>
			Object.keys(localStorage).filter((k) => k.startsWith(`mankunku:u:${'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}:`))
		);
		expect(after).toContain(`mankunku:u:${USER_A.id}:user-licks`);
	});
});
