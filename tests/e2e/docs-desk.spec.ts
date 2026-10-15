import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, SETTINGS_ONBOARDED } from './fixtures/storage';

test.describe('docs reading desk', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await page.route('**/api/chat', async route => {
			if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true } });
			await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"delta","text":"Start with a comfortable tempo."}\n\ndata: {"type":"done"}\n\n' });
		});
	});

	test('searches the guide index, shows an empty state, and follows the selected guide', async ({ page }) => {
		await page.goto('/docs');
		const search = page.getByRole('searchbox', { name: 'Find a guide' });
		const index = page.getByRole('navigation', { name: 'Documentation', exact: true });
		await search.fill('scoring');
		await expect(index.getByRole('link')).toHaveCount(1);
		await expect(index.getByRole('link', { name: 'How Scoring Works' })).toBeVisible();
		await search.fill('no matching guide');
		await expect(page.getByRole('status')).toContainText('No guides match');
		await page.getByRole('button', { name: 'Clear search' }).click();
		await expect(index.getByRole('link')).toHaveCount(13);
		await search.fill('daily key');
		await index.getByRole('link', { name: 'The Daily Key' }).click();
		await expect(page).toHaveURL(/\/docs\/architecture\/tonality-system$/);
		await expect(search).toHaveValue('');
	});

	test('article anchors and sequential guides stay navigable', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto('/docs/getting-started');
		const contents = page.getByRole('navigation', { name: 'On this page', exact: true });
		await contents.getByRole('link', { name: 'Your first session' }).click();
		await expect(page).toHaveURL(/#your-first-session$/);
		await expect(page.getByRole('heading', { name: 'Your first session', exact: true })).toBeInViewport();
		await page.getByRole('navigation', { name: 'More guides' }).getByRole('link', { name: /Next guide/ }).click();
		await expect(page).toHaveURL(/\/docs\/user-guide$/);
		await expect(page.getByRole('heading', { name: 'How to Practice', exact: true, level: 1 })).toBeVisible();
		await page.getByRole('navigation', { name: 'More guides' }).getByRole('link', { name: /Previous guide/ }).click();
		await expect(page).toHaveURL(/\/docs\/getting-started$/);
	});

	test('mobile guide navigation closes on selection and contents links work', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/docs');
		await expect(page.getByRole('navigation', { name: 'Documentation', exact: true })).toBeHidden();
		await page.getByRole('button', { name: 'Browse guides' }).click();
		await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Glossary', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Browse guides' })).toHaveAttribute('aria-expanded', 'false');
		await page.locator('.docs-mobile-contents summary').click();
		const contents = page.getByRole('navigation', { name: 'Article sections', exact: true });
		const first = contents.getByRole('link').first();
		const href = await first.getAttribute('href');
		await first.click();
		await expect(page).toHaveURL(new RegExp(`${href}$`));
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
	});

	test('assistant is keyboard contained, receives page context, and retains its conversation', async ({ page }) => {
		await page.goto('/docs/architecture/scoring-algorithm');
		await page.getByRole('button', { name: 'Ask AI' }).click();
		const dialog = page.getByRole('dialog', { name: 'AI assistant' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Close assistant' })).toBeFocused();
		await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('How should I start?');
		const request = page.waitForRequest(req => req.url().endsWith('/api/chat') && req.method() === 'POST');
		await dialog.getByRole('button', { name: 'Send', exact: true }).click();
		expect((await request).postDataJSON()).toMatchObject({ pageSlug: 'architecture/scoring-algorithm', message: 'How should I start?' });
		await expect(dialog).toContainText('Start with a comfortable tempo.');
		await page.keyboard.press('Escape');
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole('button', { name: 'Ask AI' })).toBeFocused();
		await page.getByRole('navigation', { name: 'Documentation', exact: true }).getByRole('link', { name: 'Welcome', exact: true }).click();
		await page.getByRole('button', { name: 'Ask AI' }).click();
		await expect(dialog).toContainText('Start with a comfortable tempo.');
		await dialog.getByRole('button', { name: 'Close assistant' }).click();
	});

	test('unavailable assistant keeps readable guidance and disabled input', async ({ page }) => {
		await page.unroute('**/api/chat');
		await page.route('**/api/chat', route => route.fulfill({ json: { configured: false } }));
		await page.goto('/docs');
		await page.getByRole('button', { name: 'Ask AI' }).click();
		await expect(page.getByRole('dialog')).toContainText('You can still browse all of the guides.');
		await expect(page.getByRole('textbox', { name: 'Ask the assistant' })).toBeDisabled();
	});
});

test('light theme keeps article and reference tables within the mobile page', async ({ page }) => {
	await seedStorage(page, { settings: { ...SETTINGS_ONBOARDED, theme: 'light' } });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/docs/reference/scale-and-lick-catalog');
	await expect(page.locator('html')).toHaveClass(/light/);
	await expect(page.locator('.docs-article')).toBeVisible();
	await expect(page.locator('.docs-table-wrap').first()).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
