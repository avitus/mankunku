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
	}
	await page.reload();
	await expect(count).toHaveValue('1');
});
