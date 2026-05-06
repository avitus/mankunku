import type { Page } from '@playwright/test';
import { test as consoleTest, expect } from './console-errors';

export interface E2ETestUser {
	id: string;
	email: string;
	isAdmin?: boolean;
}

const DEFAULT_USER: E2ETestUser = {
	id: '00000000-0000-0000-0000-000000000001',
	email: 'e2e-test@mankunku.dev',
	isAdmin: false
};

/**
 * Set the e2e-test-user cookie on the page's context.
 *
 * The server-side hook in src/hooks.server.ts reads this cookie when
 * PLAYWRIGHT=1 is in env and synthesizes a session + user from it. This
 * is the mechanism that makes "logged-in" tests possible without a real
 * Supabase backend.
 *
 * Call BEFORE page.goto() — cookies set on the context apply to the next nav.
 *
 * The cookie's URL is derived from the active project's baseURL (passed in
 * by the fixture below). Without that, changing port/host in the Playwright
 * config would silently fail to attach the cookie to navigations.
 */
export async function setE2EAuthCookie(
	page: Page,
	user: E2ETestUser = DEFAULT_USER,
	baseURL: string = 'http://localhost:4173'
): Promise<void> {
	await page.context().addCookies([
		{
			name: 'e2e-test-user',
			value: encodeURIComponent(JSON.stringify(user)),
			url: baseURL
		}
	]);
}

/**
 * `test` from this module composes the console-error fixture with a
 * `signedInPage` fixture. Tests that need an authenticated user destructure
 * `{ signedInPage }`; tests that don't can still destructure `{ page }` and
 * get the same console-error capture as the base fixture.
 *
 * Usage:
 * ```ts
 * import { test, expect } from './fixtures/auth';
 *
 * test('account section shows when signed in', async ({ signedInPage }) => {
 *   await signedInPage.goto('/settings');
 *   await expect(signedInPage.getByText(/account/i)).toBeVisible();
 * });
 * ```
 */
export const test = consoleTest.extend<{ signedInPage: Page; testUser: E2ETestUser }>({
	// Fresh clone of DEFAULT_USER per test so per-test mutations of testUser
	// can't leak into sibling tests via a shared object reference.
	testUser: async ({}, use) => {
		await use({ ...DEFAULT_USER });
	},
	signedInPage: async ({ page, testUser }, use, testInfo) => {
		const baseURL =
			(typeof testInfo.project.use.baseURL === 'string' && testInfo.project.use.baseURL) ||
			'http://localhost:4173';
		await setE2EAuthCookie(page, testUser, baseURL);
		await use(page);
	}
});

export { expect };
