import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, seedUserLicks, SAMPLE_USER_LICKS } from './fixtures/storage';

/**
 * /lick-practice setup page — exercises the empty practice-set state
 * without starting a real session (which requires audio + tagged licks).
 * Basic route rendering is covered by smoke.spec.ts; the full session flow
 * (start → round → scored report) by lick-practice-session.spec.ts.
 */

test.describe('lick-practice setup', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('shows tag-some-licks guidance when no licks are tagged', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/lick-practice');
		// Keep the entry action discoverable, with guidance explaining why it is disabled.
		await expect(page.getByRole('button', { name: 'Start Daily Practice', exact: true })).toBeDisabled();
		await expect(
			page.locator('main').getByText('No licks tagged for practice yet.').first()
		).toBeVisible();
		// Page should point users at the library to tag their first lick.
		// Scope to <main> so the assertion proves the empty-state guidance link
		// renders — an unscoped /licks/i locator would match the global nav's
		// "Licks" link and pass even with the guidance missing.
		await expect(
			page.locator('main').getByRole('link', { name: /browse your licks/i })
		).toBeVisible();
	});
});


test('Duration controls the queued count beside Start and keeps its value across session choices', async ({ page }, testInfo) => {
	await seedOnboardedAnonymous(page);
	const licks = Array.from({ length: 12 }, (_, index) => ({
		...(SAMPLE_USER_LICKS[0] as Record<string, unknown>),
		id: `e2e-duration-${index}`, name: `Duration lick ${index + 1}`
	}));
	await seedUserLicks(page, licks);
	await seedStorage(page, {
		'user-lick-tags': Object.fromEntries(licks.map(lick => [lick.id, ['practice', 'prog:ii-V-I-major']]))
	});
	await page.goto('/lick-practice');
	const launch = page.getByRole('region', { name: 'Set your time. Make it count.' });
	const duration = launch.getByRole('slider', { name: 'Practice time' });
	const count = launch.locator('[aria-live="polite"]');
	await expect(page.getByRole('radiogroup', { name: 'Session type' }).getByRole('radio')).toHaveText([
		'Daily Practice Rotate all licks', 'Deep Practice Master one lick',
		'Focused Session One progression at a time', 'Tricks Drill a melodic device'
	], { useInnerText: false });
	await expect(launch.getByRole('button', { name: 'Start Daily Practice', exact: true })).toBeEnabled();
	await duration.focus();
	await page.keyboard.press('End');
	await expect(count).toHaveText('12 licks in this session');
	await page.keyboard.press('Home');
	await expect(duration).toHaveAttribute('aria-valuenow', '3');
	await expect.poll(async () => Number((await count.innerText()).match(/\d+/)?.[0])).toBeLessThan(12);
	await expect(count).toContainText('licks in this session');
	await page.getByRole('radio', { name: /Focused Session/ }).click();
	await expect(duration).toHaveAttribute('aria-valuenow', '3');
	await expect(launch.getByRole('button', { name: 'Start Session', exact: true })).toBeEnabled();
	await page.getByRole('radio', { name: /Deep Practice/ }).click();
	await expect(page.getByRole('slider', { name: 'Practice time' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Start Drill', exact: true })).toBeDisabled();
	await page.getByRole('radio', { name: /Daily Practice/ }).click();
	await expect(duration).toHaveAttribute('aria-valuenow', '3');
	await page.reload();
	await expect(duration).toHaveAttribute('aria-valuenow', '3');
	await expect(page.locator('[aria-label="Backing style"]')).toBeVisible();
	await expect(page.locator('[aria-label="Practice mode"]')).toBeVisible();
	await expect(launch).not.toContainText(/of playing|may finish before the time budget/);
	for (const width of [1200, 390, 320]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await expect(launch.getByRole('button', { name: 'Start Daily Practice', exact: true })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath(`setup-${width}.png`), fullPage: true });
	}
});
