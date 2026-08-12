import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Smoke spec — visits every public route, asserts the page renders, and
 * relies on the consoleCollector fixture to fail the test if any uncaught
 * console.error or pageerror fires.
 *
 * The whole point of this layer is to surface the multiplicity of Firefox
 * (and other browser) errors that aren't currently being caught. Each
 * failure here is a real bug to fix or a known-noise pattern to add to
 * IGNORED_PATTERNS in fixtures/console-errors.ts.
 *
 * Routes that 308-redirect are kept in the list deliberately — exercising
 * the redirect catches accidental loops or broken targets.
 */

interface RouteCheck {
	path: string;
	/** Optional final URL after redirects, if it differs from path. */
	finalPath?: string;
	/** Optional text we expect to appear somewhere on the rendered page. */
	expectText?: string | RegExp;
	/** Optional reason this route is special (e.g., requires auth, redirects). */
	notes?: string;
}

const ROUTES: RouteCheck[] = [
	{ path: '/' },
	{ path: '/auth' },
	{ path: '/ear-training' },
	{ path: '/practice', finalPath: '/ear-training', notes: '308 redirect to /ear-training' },
	{ path: '/lick-practice' },
	{ path: '/licks' },
	{ path: '/licks/community' },
	{ path: '/licks/record' },
	{ path: '/licks/editor' },
	{ path: '/licks/add' },
	{ path: '/tunes' },
	{ path: '/tunes/community' },
	{ path: '/tunes/editor' },
	{ path: '/tunes/add' },
	{ path: '/progress' },
	{ path: '/settings' },
	{ path: '/scales' },
	{ path: '/diagnostics' },
	{ path: '/diagnostics/backing-mixer' },
	{ path: '/docs' }
];

/**
 * The pre-rename URLs must be dead, not redirected — the app is unlaunched
 * and the rename deliberately ships without redirect shims. A 404 here proves
 * no stale route directory or accidental alias survived the restructure.
 */
const RETIRED_PATHS = [
	'/library',
	'/community',
	'/entry',
	'/record',
	'/add-licks',
	'/lead-sheets',
	'/add-lead-sheets',
	// The ear-training settings page was deleted outright: its unique controls
	// (category / difficulty / source / bars) were discarded on arrival at
	// /ear-training, and its working ones live on /settings. The /practice
	// shim went with it — /practice itself still redirects.
	'/practice/settings',
	'/ear-training/settings'
];

test.describe('smoke: every route renders cleanly', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	for (const route of ROUTES) {
		test(`${route.path} renders without console errors${route.notes ? ` (${route.notes})` : ''}`, async ({
			page,
			consoleCollector: _consoleCollector
		}) => {
			const response = await page.goto(route.path);
			expect(response, `goto(${route.path}) returned no response`).not.toBeNull();
			expect(response!.status(), `unexpected status from ${route.path}`).toBeLessThan(400);

			if (route.finalPath) {
				await expect(page).toHaveURL(new RegExp(route.finalPath.replace(/\//g, '\\/')));
			}

			// Every page in the app renders inside a <main> landmark via the
			// global +layout.svelte. If <main> doesn't appear, the layout
			// itself failed to mount — which is exactly the kind of regression
			// this smoke layer should catch.
			await expect(page.locator('main')).toBeVisible();

			if (route.expectText) {
				await expect(page.getByText(route.expectText).first()).toBeVisible();
			}
		});
	}

	for (const path of RETIRED_PATHS) {
		test(`retired route ${path} returns 404`, async ({ page }) => {
			// request.get, not page.goto: rendering the 404 page would emit a
			// "Failed to load resource" console error and trip the console
			// fixture; the server status is all this test is about.
			// maxRedirects: 0 asserts the INITIAL response — with redirects
			// followed (the default), a redirect shim landing on a 404 page
			// would still satisfy the status check.
			const response = await page.request.get(path, { maxRedirects: 0 });
			expect(response.status(), `${path} should be dead, not redirected`).toBe(404);
		});
	}
});
