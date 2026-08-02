import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /diagnostics/backing-mixer — per-instrument backing levels.
 *
 * The page's contract is that slider moves reach the engine's persisted
 * mix (localStorage `backing-mix-levels`) and survive a reload, because
 * that is what makes a tuned mix apply to every later practice session.
 * Audio output itself is not asserted here.
 */

test('mixer sliders persist to the engine mix and survive reload', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');
	await expect(page.getByRole('heading', { name: 'Backing mixer' })).toBeVisible();

	// All six sliders render.
	for (const key of ['bass', 'comp', 'drums', 'kick', 'ride', 'hihat']) {
		await expect(page.getByTestId(`mix-${key}`)).toBeVisible();
	}

	// Move bass down. Polling the fill→storage round-trip also absorbs the
	// hydration race: a fill dispatched before Svelte attaches oninput does
	// nothing, and the next retry lands once the page is interactive.
	await expect
		.poll(async () => {
			await page.getByTestId('mix-bass').fill('0.6');
			return page.evaluate(
				() => JSON.parse(localStorage.getItem('backing-mix-levels') ?? '{}').bass
			);
		})
		.toBeCloseTo(0.6);

	// Hydration is proven now; a plain fill suffices for the kick.
	await page.getByTestId('mix-kick').fill('2');
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('backing-mix-levels') ?? '{}')
	);
	expect(stored.kick).toBeCloseTo(2);

	// Reload: the tuned values come back on the sliders.
	await page.reload();
	await expect(page.getByTestId('mix-bass')).toHaveValue('0.6');
	await expect(page.getByTestId('mix-kick')).toHaveValue('2');

	// Reset returns the sliders and the stored mix to defaults.
	await page.getByRole('button', { name: 'Reset to defaults' }).click();
	await expect(page.getByTestId('mix-bass')).toHaveValue('1');
	const reset = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('backing-mix-levels') ?? '{}')
	);
	expect(reset.kick).toBe(1);
});
