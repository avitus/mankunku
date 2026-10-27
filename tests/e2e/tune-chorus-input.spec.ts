import { test, expect } from './fixtures/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test('solo chorus input displays the saved count when already at a clamp boundary', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints');
	const count = page.getByRole('spinbutton', { name: 'Solo choruses', exact: true });
	for (const [entered, normalized] of [['12', '12'], ['20', '12'], ['1', '1'], ['0', '1'], ['', '1']] as const) {
		await count.fill(entered);
		await count.blur();
		await expect(count).toHaveValue(normalized);
		await expect.poll(() => page.evaluate(() => localStorage.getItem('mankunku:tune-practice-choruses'))).toBe(normalized);
		if (entered === '20') {
			await page.reload();
			await expect(count).toHaveValue('12');
		}
	}
	await page.reload();
	await expect(count).toHaveValue('1');
});

test('practice tempo entry displays the actual tempo at both boundaries and after reload', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints/practice');
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
	const tempo = page.getByRole('spinbutton', { name: 'Tempo', exact: true });
	for (const [entered, normalized] of [['240', '240'], ['300', '240'], ['50', '50'], ['20', '50'], ['', '50']] as const) {
		await tempo.fill(entered);
		await tempo.blur();
		await expect(tempo).toHaveValue(normalized);
		await expect(page.locator('.td-play-summary')).toContainText(`${normalized} BPM`);
	}
	await page.getByRole('button', { name: 'Increase tempo', exact: true }).click();
	await expect(tempo).toHaveValue('55');
	await page.getByRole('button', { name: 'Decrease tempo', exact: true }).click();
	await expect(tempo).toHaveValue('50');
	await tempo.fill('300');
	await tempo.blur();
	await expect(tempo).toHaveValue('240');
	await page.reload();
	await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
	await expect(tempo).toHaveValue('240');
	await expect(page.locator('.td-play-summary')).toContainText('240 BPM');
});
