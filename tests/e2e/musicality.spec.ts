import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.beforeEach(async ({ page }) => { await seedOnboardedAnonymous(page); });

test('finds audited devices and keeps implementation separate from listening acceptance', async ({ page }) => {
	await page.goto('/musicality');
	await expect(page.getByRole('heading', { name: 'Musicality', exact: true })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText('252 of 252 entries');
	await expect(page.getByTestId('musicality-build')).not.toBeEmpty();
	await page.getByLabel('Search the specification').fill('P3');
	await page.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('piano');
	await page.getByRole('combobox', { name: 'Implementation', exact: true }).selectOption('implemented');
	await expect(page.locator('[data-requirement-id]')).toHaveCount(1);
	await page.locator('#P3 summary').click();
	await expect(page.locator('#P3')).toContainText('and-of-2');
	await expect(page.locator('#P3')).toContainText('Source inspected · listening not assessed');
	await expect(page.locator('#P3 a', { hasText: 'backing-comp-figures.test.ts' })).toHaveAttribute('href', /\/blob\/[a-f0-9]{40}\/tests\/unit\/audio\//);
	await page.getByRole('button', { name: 'Clear filters' }).click();
	await page.getByLabel('Search the specification').fill('no-such-musical-idea');
	await expect(page.getByRole('heading', { name: 'No matching musical ideas.' })).toBeVisible();
	await page.getByRole('button', { name: 'Show all entries' }).click();
	await expect(page.locator('[data-requirement-id]')).toHaveCount(252);
});

test('deep links open the original requirement and the docs directory discovers the ledger', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/musicality#D15');
	await expect(page.locator('#D15')).toHaveAttribute('open', '');
	await expect(page.locator('#D15')).toContainText('hi-hat');
	await expect(page.locator('#D15')).toContainText('Foot hi-hat on 2 and 4');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.locator('#D15 summary').focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('#D15')).not.toHaveAttribute('open', '');
	await page.goto('/docs');
	await page.locator('.docs-directory').getByRole('link', { name: /Rhythm Section Musicality/ }).click();
	await expect(page).toHaveURL(/\/musicality$/);
	await page.getByRole('link', { name: /Read the original specification/ }).click();
	await expect(page.locator('#original-spec')).toHaveAttribute('open', '');
	await expect(page.locator('#original-spec')).toContainText('The performance sounds like three musicians listening to each other.');
});

test('native same-document hash changes reveal filtered requirements and the complete source', async ({ page }) => {
	await page.goto('/musicality');
	await page.getByLabel('Search the specification').fill('P3');
	await page.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('piano');
	await expect(page.locator('#D15')).toHaveCount(0);
	// A browser-native fragment navigation does not reload the page or require
	// SvelteKit navigation callbacks to run.
	await page.goto('/musicality#D15');
	await expect(page.locator('#D15')).toHaveAttribute('open', '');
	await expect(page.locator('#D15')).toContainText('Foot hi-hat on 2 and 4');
	await expect(page.getByLabel('Search the specification')).toHaveValue('');
	await expect(page.getByRole('combobox', { name: 'Instrument', exact: true })).toHaveValue('all');
	await page.goto('/musicality#original-spec');
	await expect(page.locator('#original-spec')).toHaveAttribute('open', '');
	await expect(page.locator('#D15')).not.toHaveAttribute('open', '');
	await expect(page.locator('#original-spec')).toContainText('The performance sounds like three musicians listening to each other.');
	await page.goto('/musicality#P3');
	await expect(page.locator('#P3')).toHaveAttribute('open', '');
	await expect(page.locator('#original-spec')).not.toHaveAttribute('open', '');
});
