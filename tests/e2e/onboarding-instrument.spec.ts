import { test, expect } from './fixtures/test';

/**
 * Onboarding's instrument step: the transposing horns are one tap, and
 * "Concert Pitch" asks a follow-up — which C instrument — before moving on.
 * Runs with NO storage seeding, the state a first-time visitor arrives in.
 */
test.describe('onboarding instrument step', () => {
	test('Concert Pitch asks which C instrument, and saves the answer', async ({ page }) => {
		await page.goto('/ear-training');
		const overlay = page.getByTestId('onboarding-overlay');
		await expect(overlay).toBeVisible();

		await overlay.getByTestId('onboarding-concert-pitch').click();
		const choices = overlay.getByTestId('onboarding-concert-instruments');
		await expect(overlay.getByRole('heading', { name: 'Which instrument?' })).toBeVisible();
		for (const name of ['Piano', 'Guitar', 'Bass', 'Trombone', 'Flute', 'Vibraphone', 'Violin', 'Voice', 'Other']) {
			await expect(choices.getByRole('button', { name, exact: true })).toBeVisible();
		}

		await choices.getByRole('button', { name: 'Trombone', exact: true }).click();
		await expect(overlay.getByRole('heading', { name: 'Microphone Access' })).toBeVisible();

		const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mankunku:settings') ?? '{}'));
		expect(saved.instrumentId).toBe('trombone');
	});

	test('Back returns from the follow-up to the instrument list', async ({ page }) => {
		await page.goto('/ear-training');
		const overlay = page.getByTestId('onboarding-overlay');
		await overlay.getByTestId('onboarding-concert-pitch').click();
		await overlay.getByRole('button', { name: 'Back' }).click();
		await expect(overlay.getByRole('button', { name: /Tenor Saxophone/ })).toBeVisible();
	});
});
