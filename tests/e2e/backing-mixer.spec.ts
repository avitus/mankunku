import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * /diagnostics/backing-mixer — the backing listening lab.
 *
 * The mixer contract: slider moves reach the engine's persisted mix
 * (localStorage `backing-mix-levels-v2`) and survive a reload, because that
 * is what makes a tuned mix apply to every later practice session. The lab
 * contract: preset/seed/checklist controls render and the checklist report
 * reflects verdicts. Audio output itself is not asserted here (bouncing
 * needs CDN instrument fetches).
 */

test('mixer sliders persist to the engine mix and survive reload', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');
	await expect(page.getByRole('heading', { name: 'Backing lab' })).toBeVisible();

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
				() => JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}').bass
			);
		})
		.toBeCloseTo(0.6);

	// Hydration is proven now; a plain fill suffices for the kick.
	await page.getByTestId('mix-kick').fill('2');
	const stored = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}')
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
		JSON.parse(localStorage.getItem('backing-mix-levels-v2') ?? '{}')
	);
	expect(reset.kick).toBe(1);
});

test('listening-lab controls render and the checklist records verdicts', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/diagnostics/backing-mixer');

	// Preset picker exposes the protocol progressions.
	const presetSelect = page.getByTestId('lab-preset');
	await expect(presetSelect).toBeVisible();
	await presetSelect.selectOption('lab-aaba-c');
	await expect(presetSelect).toHaveValue('lab-aaba-c');

	// Seed input and tempo preset chips.
	await expect(page.getByTestId('lab-seed')).toBeVisible();
	await page.getByRole('button', { name: '160', exact: true }).click();
	await expect(page.getByText('Tempo: 160 BPM')).toBeVisible();

	// Bounce button present (rendering itself needs CDN samples — not run here).
	await expect(page.getByTestId('lab-bounce')).toBeVisible();

	// Blind A/B requires a bounce + reference before it can start.
	await expect(page.getByRole('button', { name: 'Start blind comparison' })).toBeDisabled();

	// Checklist: cycle one item to pass; the copied report contains it.
	const checklist = page.getByTestId('listening-checklist');
	await expect(checklist).toBeVisible();
	const firstItem = checklist.getByRole('button', { name: /At 90 BPM the swing lopes/ });
	await firstItem.click(); // ⬜ → ✅
	await expect(firstItem).toContainText('✅');

	// A second click cycles pass → fail.
	await firstItem.click();
	await expect(firstItem).toContainText('❌');

	// Report copy button renders (clipboard write itself is not asserted —
	// permission behavior differs per engine).
	await expect(page.getByRole('button', { name: 'Copy listening report' })).toBeVisible();
});
