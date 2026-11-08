import { test, expect } from './fixtures/auth';
import { setE2EAuthCookie } from './fixtures/auth';
import { SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import type { Page } from '@playwright/test';

/**
 * Cross-tab account-switch propagation. When one tab switches users, other open
 * tabs must re-home (reload) instead of continuing to write the previous user's
 * in-memory state under whoever is now signed in. `initCrossTabSync` listens for
 * the `mankunku:__active` pointer changing in another tab and reloads.
 */

const USER_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'alice@e2e.dev' };
const OTHER_UID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function stubSupabase(page: Page): Promise<void> {
	await page.route('**/rest/v1/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' })
	);
	await page.route('**/auth/v1/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
	);
}

async function seedOnboardedA(page: Page): Promise<void> {
	await page.addInitScript(
		({ uid, settings, tour }) => {
			const ROOT = 'mankunku:';
			if (localStorage.getItem(`${ROOT}__schema`) === null) localStorage.setItem(`${ROOT}__schema`, '2');
			if (localStorage.getItem(`${ROOT}__active`) === null) localStorage.setItem(`${ROOT}__active`, JSON.stringify(uid));
			const put = (k: string, v: unknown) => {
				if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(v));
			};
			put(`${ROOT}u:${uid}:settings`, settings);
			put(`${ROOT}u:${uid}:tour-state`, tour);
		},
		{ uid: USER_A.id, settings: SETTINGS_ONBOARDED, tour: TOUR_DISMISSED }
	);
}

test('a user switch re-homes the other tab without overwriting the previous account', async ({ page }, testInfo) => {
	const baseURL =
		(typeof testInfo.project.use.baseURL === 'string' && testInfo.project.use.baseURL) || 'http://localhost:4173';

	await stubSupabase(page);
	await setE2EAuthCookie(page, USER_A, baseURL);
	await seedOnboardedA(page);
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');

	// Second tab in the SAME context (shares cookies + localStorage).
	const tab2 = await page.context().newPage();
	await stubSupabase(tab2);
	await seedOnboardedA(tab2);
	await tab2.goto('/settings');
	await tab2.waitForLoadState('networkidle');
	await expect(tab2.getByRole('radio', { name: /Tenor/ })).toHaveAttribute('aria-checked', 'true');
	const previousSettings = await page.evaluate((uid) => localStorage.getItem(`mankunku:u:${uid}:settings`), USER_A.id);

	// Cookies and storage switch together, as they do after a real sign-in.
	// The old test changed only the pointer, then merely waited for Alice to
	// be restored. That could pass without ever showing the second account.
	await setE2EAuthCookie(page, { id: OTHER_UID, email: 'bob@e2e.dev' }, baseURL);

	// Arm a navigation watcher on tab2 BEFORE triggering, so we observe its
	// re-home reload directly.
	const tab2Reloaded = tab2.waitForEvent('load', { timeout: 10_000 });

	// Simulate another tab switching the active user by flipping the shared
	// `__active` pointer — this fires a `storage` event in tab2, whose
	// initCrossTabSync listener re-homes by reloading.
	await page.evaluate(({ other, settings, tour }) => {
		localStorage.setItem(`mankunku:u:${other}:settings`, JSON.stringify({ ...settings, instrumentId: 'alto-sax' }));
		localStorage.setItem(`mankunku:u:${other}:tour-state`, JSON.stringify(tour));
		localStorage.setItem('mankunku:__active', JSON.stringify(other));
	}, { other: OTHER_UID, settings: SETTINGS_ONBOARDED, tour: TOUR_DISMISSED });

	await tab2Reloaded;

	await expect(tab2.getByRole('radio', { name: /Alto/ })).toHaveAttribute('aria-checked', 'true');
	await tab2.getByRole('radio', { name: /Trumpet/ }).click();
	await tab2.reload();
	await expect(tab2.getByRole('radio', { name: /Trumpet/ })).toHaveAttribute('aria-checked', 'true');
	const stores = await tab2.evaluate(({ first, second }) => ({
		active: JSON.parse(localStorage.getItem('mankunku:__active') ?? 'null'),
		previous: localStorage.getItem(`mankunku:u:${first}:settings`),
		current: JSON.parse(localStorage.getItem(`mankunku:u:${second}:settings`) ?? '{}')
	}), { first: USER_A.id, second: OTHER_UID });
	expect(stores.active).toBe(OTHER_UID);
	expect(stores.previous).toBe(previousSettings);
	expect(stores.current.instrumentId).toBe('trumpet');
	await tab2.close();
});
