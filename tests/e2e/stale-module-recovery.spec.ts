import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test('a cached-module export mismatch recovers to the clicked page', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/');
	const origin = new URL(page.url()).origin;
	const chunk = `${origin}/_app/immutable/chunks/stale-export.js`;
	const message = `The requested module '${chunk}' doesn't provide an export named: 'l'`;
	let injected = 0;
	const documents: string[] = [];
	let probedTarget = false;
	page.on('request', (request) => {
		if (request.method() === 'HEAD' && new URL(request.url()).pathname === '/progress') probedTarget = true;
	});
	page.on('domcontentloaded', () => {
		documents.push(new URL(page.url()).pathname);
	});
	await page.route('**/_app/immutable/nodes/*.js', async (route) => {
		if (injected) return route.continue();
		injected++;
		// Reproduce the native SyntaxError from MANKUNKU-25 in a route import.
		// The recovery document receives the real module from the server.
		await route.fulfill({
			contentType: 'application/javascript',
			body: `throw new SyntaxError(${JSON.stringify(message)});`
		});
	});
	// Dispatch a real link click without a hover preload consuming the failure.
	await page.locator('a[href="/progress"]').first().evaluate((link: HTMLAnchorElement) => link.click());
	await expect(page).toHaveURL(/\/progress$/);
	await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
	await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
	expect(injected).toBe(1);
	// The HEAD probe proves our error hook ran, rather than only Kit's own
	// native-navigation fallback. DOMContentLoaded counts fresh documents, unlike
	// framenavigated (also emitted by SPA history changes) or aborted requests.
	expect(probedTarget).toBe(true);
	expect(documents).toEqual(['/progress']);
});
