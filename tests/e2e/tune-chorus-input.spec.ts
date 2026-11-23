import { setTuneTempo } from './fixtures/tune-setup';
import { test, expect } from './fixtures/test';
import { SAINTS_USER_TUNE, seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

test('solo chorus input displays the saved count when already at a clamp boundary', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [SAINTS_USER_TUNE]);
	await page.goto('/tunes/e2e-when-the-saints');

	const count = page.getByRole('spinbutton', { name: 'Choruses', exact: true });
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
	await page.goto('/tunes/e2e-when-the-saints?licks=1');
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	const tempo = page.getByRole('slider', { name: 'Tempo', exact: true });
	await setTuneTempo(page, 40);
	await tempo.press('ArrowDown');
	await expect(tempo).toHaveAttribute('aria-valuenow', '40');
	await setTuneTempo(page, 240);
	await tempo.press('ArrowUp');
	await expect(tempo).toHaveAttribute('aria-valuenow', '240');
	await page.reload();
	await expect(tempo).toHaveAttribute('aria-valuenow', '240');
});
