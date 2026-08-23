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

test('a user switch in one tab reloads the other open tab', async ({ page, browser }, testInfo) => {
	const baseURL =
		(typeof testInfo.project.use.baseURL === 'string' && testInfo.project.use.baseURL) || 'http://localhost:4173';

	await stubSupabase(page);
	await setE2EAuthCookie(page, USER_A, baseURL);
	await seedOnboardedA(page);
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	// Second tab in the SAME context (shares cookies + localStorage).
	const tab2 = await page.context().newPage();
	await stubSupabase(tab2);
	await seedOnboardedA(tab2);
	await tab2.goto('/');
	await tab2.waitForLoadState('networkidle');

	// Arm a navigation watcher on tab2 BEFORE triggering, so we observe its
	// re-home reload directly.
	const tab2Reloaded = tab2.waitForEvent('load', { timeout: 10_000 });

	// Simulate another tab switching the active user by flipping the shared
	// `__active` pointer — this fires a `storage` event in tab2, whose
	// initCrossTabSync listener re-homes by reloading.
	await page.evaluate((other) => {
		localStorage.setItem('mankunku:__active', JSON.stringify(other));
	}, OTHER_UID);

	await tab2Reloaded;

	// The re-homed tab reloads a SECOND time: the e2e cookie still says Alice,
	// so the reconcile step flips `__active` back to her and reloads once more
	// (in production the cookie would follow the switch and there is only one).
	// Closing a page mid-navigation races Chromium's target teardown — close()
	// hung ~28 s into the 30 s test budget, 3/3 on CI — so wait for the realm
	// to settle (pointer back on Alice, reload guard cleared) before closing.
	await tab2.waitForFunction(
		(uid) =>
			localStorage.getItem('mankunku:__active') === JSON.stringify(uid) &&
			sessionStorage.getItem('mankunku:reload-target') === null,
		USER_A.id,
		{ timeout: 10_000 }
	);
	await tab2.close();
});
