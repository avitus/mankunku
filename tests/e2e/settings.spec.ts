import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test.describe('settings persistence', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('theme toggle persists across reload', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/settings');

		const themeGroup = page.getByRole('radiogroup', { name: 'Theme' });
		await expect(themeGroup).toBeVisible();
		await themeGroup.getByRole('radio', { name: 'Light' }).click();

		// applyTheme() toggles a `light` class on <html> (see settings.svelte.ts).
		await expect(page.locator('html')).toHaveClass(/light/);

		await page.reload();
		await expect(page.locator('html')).toHaveClass(/light/);

		// Restore so this isn't order-dependent.
		await page
			.getByRole('radiogroup', { name: 'Theme' })
			.getByRole('radio', { name: 'Dark' })
			.click();
		await expect(page.locator('html')).not.toHaveClass(/light/);
	});

	test('instrument change persists across reload', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/settings');

		// `exact: true` disambiguates from "Backing instrument" radiogroup.
		const instrumentGroup = page.getByRole('radiogroup', {
			name: 'Instrument',
			exact: true
		});
		await expect(instrumentGroup).toBeVisible();

		// Pick a different instrument than the seeded default (tenor-sax).
		await instrumentGroup.getByRole('radio', { name: /Alto/i }).first().click();

		await page.reload();

		const altoRadio = page
			.getByRole('radiogroup', { name: 'Instrument', exact: true })
			.getByRole('radio', { name: /Alto/i })
			.first();
		await expect(altoRadio).toHaveAttribute('aria-checked', 'true');
	});
});

// Layout is part of the control contract: switching the band off keeps the
// voice and level in place, preserves their values, and prevents input.
for (const width of [1440, 768, 390]) {
	test(`backing controls retain geometry and settings at ${width}px`, async ({
		page
	}) => {
		await seedOnboardedAnonymous(page);
		await page.setViewportSize({ width, height: 1000 });
		await page.goto('/settings');
		const section = page.getByRole('region', { name: 'Rhythm & band' });
		const backing = page.getByRole('switch', {
			name: 'Backing track',
			exact: true
		});
		const volume = page.getByRole('slider', {
			name: 'Backing track volume',
			exact: true
		});
		const organ = page
			.getByRole('radiogroup', { name: 'Backing instrument' })
			.getByRole('radio', { name: 'Organ' });
		await expect(volume).toBeVisible();
		await expect(volume).toBeDisabled();
		await expect(organ).toBeDisabled();
		const before = await section.boundingBox();
		await backing.click();
		await expect(volume).toBeEnabled();
		await organ.click();
		await volume.focus();
		await volume.press('Home');
		await volume.press('ArrowUp');
		await expect(volume).toHaveAttribute('aria-valuenow', '0.05');
		const enabled = await section.boundingBox();
		expect(enabled?.height).toBe(before?.height);
		await backing.click();
		await expect(volume).toBeDisabled();
		await expect(organ).toBeDisabled();
		expect((await section.boundingBox())?.height).toBe(before?.height);
		await backing.click();
		await expect(organ).toHaveAttribute('aria-checked', 'true');
		await expect(volume).toHaveAttribute('aria-valuenow', '0.05');
		await page.reload();
		await expect(organ).toHaveAttribute('aria-checked', 'true');
		await expect(volume).toHaveAttribute('aria-valuenow', '0.05');
		await expect(backing).toHaveAttribute('aria-checked', 'true');
		for (const theme of ['Light', 'Dark']) {
			await page
				.getByRole('radiogroup', { name: 'Theme' })
				.getByRole('radio', { name: theme })
				.click();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth
				)
			).toBe(true);
			const lit = await section.boundingBox();
			await backing.click();
			expect((await section.boundingBox())?.height).toBe(lit?.height);
			await backing.click();
		}
	});
}

test('console keyboard controls update the real setup and persist', async ({
	page
}) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/settings');
	const instruments = page.getByRole('radiogroup', {
		name: 'Instrument',
		exact: true
	});
	const selected = instruments.getByRole('radio', { checked: true });
	await selected.focus();
	await selected.press('End');
	await expect(
		instruments.getByRole('radio', { name: /Trumpet/ })
	).toHaveAttribute('aria-checked', 'true');
	await expect(
		page.getByRole('complementary', { name: 'Your setup' })
	).toContainText('Trumpet');
	await instruments.getByRole('radio', { name: /Trumpet/ }).press('Home');
	await expect(
		instruments.getByRole('radio', { name: /Concert Pitch/ })
	).toHaveAttribute('aria-checked', 'true');
	const tempo = page.getByRole('slider', { name: 'Default tempo' });
	await tempo.press('End');
	await tempo.press('ArrowUp');
	await expect(tempo).toHaveAttribute('aria-valuenow', '200');
	await tempo.press('Home');
	await tempo.press('ArrowDown');
	await expect(tempo).toHaveAttribute('aria-valuenow', '60');
	await tempo.press('PageUp');
	await expect(
		page.getByRole('complementary', { name: 'Your setup' })
	).toContainText('110 BPM');
	const swing = page.getByRole('slider', { name: 'Swing feel' });
	await swing.press('Home');
	await expect(swing).toContainText('50%');
	await expect(swing).toHaveAttribute('aria-valuetext', '50%');
	await swing.press('End');
	await expect(swing).toContainText('80%');
	await swing.press('ArrowDown');
	await expect(swing).toHaveAttribute('aria-valuenow', '0.75');
	await expect(swing).toHaveAttribute('aria-valuetext', '75%');
	await expect(
		page.getByRole('complementary', { name: 'Your setup' })
	).toContainText('75%');
	const metro = page.getByRole('switch', { name: 'Metronome', exact: true });
	const level = page.getByRole('slider', { name: 'Metronome volume' });
	const rhythm = page.getByRole('region', { name: 'Rhythm & band' });
	const before = await rhythm.boundingBox();
	await metro.click();
	await expect(level).toBeVisible();
	await expect(level).toBeDisabled();
	expect((await rhythm.boundingBox())?.height).toBe(before?.height);
	await page.reload();
	await expect(tempo).toHaveAttribute('aria-valuenow', '110');
	await expect(swing).toHaveAttribute('aria-valuenow', '0.75');
	await expect(swing).toHaveAttribute('aria-valuetext', '75%');
	await expect(metro).toHaveAttribute('aria-checked', 'false');
	await expect(
		instruments.getByRole('radio', { name: /Concert Pitch/ })
	).toHaveAttribute('aria-checked', 'true');
});
