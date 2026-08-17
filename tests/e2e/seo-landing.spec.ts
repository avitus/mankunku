import { test as anonTest, expect } from './fixtures/test';
import { test as authTest } from './fixtures/auth';

/**
 * Crawler-visibility invariants. Googlebot visits with a fresh profile
 * (empty localStorage) and scores what it renders, so these specs run with
 * NO storage seeding at all — the exact state a crawler (or a first-time
 * visitor from a search result) sees.
 *
 * Pinned here because each was a real indexability bug:
 * - the onboarding overlay used to be the entire rendered view of EVERY URL;
 * - the anonymous home page was a contentless dashboard shell;
 * - app.html + per-route <svelte:head> emitted two <title> elements, and
 *   crawlers take the first, so every page presented the same title.
 */

anonTest.describe('anonymous visitor (crawler-equivalent)', () => {
	anonTest('home shows the landing page, not the onboarding overlay', async ({
		page,
		consoleCollector
	}) => {
		await page.goto('/');

		await expect(page.getByRole('heading', { name: /jazz ear training that listens/i })).toBeVisible();
		await expect(page.getByTestId('onboarding-overlay')).not.toBeVisible();

		// Exactly one title and one description — the shell (app.html) must not
		// contribute a second pair over the route's SeoHead.
		await expect(page.locator('head title')).toHaveCount(1);
		await expect(page.locator('head meta[name="description"]')).toHaveCount(1);

		expect(consoleCollector.errors).toEqual([]);
		expect(consoleCollector.pageErrors).toEqual([]);
	});

	anonTest('server-rendered HTML of / carries the landing, not the overlay', async ({ page }) => {
		// Raw HTML, no JS: what a non-rendering crawler (and Google's first
		// pass) reads.
		const res = await page.request.get('/');
		const html = await res.text();
		expect(html).toContain('Jazz ear training that listens');
		expect(html).not.toContain('onboarding-overlay');
		expect(html).toContain('application/ld+json');
	});

	anonTest('docs pages render prose with no overlay', async ({ page }) => {
		await page.goto('/docs/getting-started');
		await expect(page.getByRole('heading', { name: /welcome to mankunku/i })).toBeVisible();
		await expect(page.getByTestId('onboarding-overlay')).not.toBeVisible();
	});

	anonTest('onboarding still auto-triggers on practice routes', async ({ page }) => {
		// The overlay gate is an allowlist, not a removal: a fresh visitor who
		// heads for a practice surface still gets instrument + mic setup.
		await page.goto('/ear-training');
		await expect(page.getByTestId('onboarding-overlay')).toBeVisible();
	});

	anonTest('the browsable licks book renders clean despite sharing the /licks/record stem', async ({
		page
	}) => {
		// The gate's riskiest boundary: '/licks/record' triggers, '/licks'
		// must not — a prefix regression here blankets the book in the
		// overlay for every crawler and first-time visitor.
		await page.goto('/licks');
		await expect(page.getByTestId('onboarding-overlay')).not.toBeVisible();
	});
});

authTest.describe('signed-in visitor', () => {
	authTest('home still renders the dashboard, not the landing', async ({ signedInPage }) => {
		await signedInPage.goto('/');
		await expect(signedInPage.getByRole('heading', { name: /what'll it be/i })).toBeVisible();
		await expect(
			signedInPage.getByRole('heading', { name: /jazz ear training that listens/i })
		).not.toBeVisible();
	});
});
