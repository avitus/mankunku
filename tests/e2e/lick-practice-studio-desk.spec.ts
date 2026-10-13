import { test, expect } from './fixtures/test';
import { seedUserLicks, seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

// At twelve unlocked keys the established practice policy hides notation.
for (const theme of ['dark', 'light']) {
for (const count of [11, 12]) {
test(`Studio Desk ${theme} keeps the ${count}-key ring clear of music across screen widths`, async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await seedUserLicks(page);
	// ONE settings seed: each seeder writes a key only when absent, and the
	// order of separate init scripts is not defined.
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, theme },
		'tour-state': TOUR_DISMISSED,
		'lick-unlock-count': { 'e2e-user-lick-bebop': count },
		'lick-practice-progress': {
			'e2e-user-lick-bebop': Object.fromEntries(
				['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'].map((key) =>
					[key, { currentTempo: 60, rollingScore: key === 'Db' ? 0.1 : 0.9, passCount: 0 }])
			)
		}
	});
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/licks/e2e-user-lick-bebop');
	await page.getByRole('button', { name: /^practice$/i }).click();
	const sheet = page.getByTestId('lead-sheet-row').first();
	if (count === 11) await expect(sheet.locator('.abcjs-notehead').first()).toBeVisible();
	const ring = page.getByRole('img', { name: /Key progress/ });
	await expect(ring.locator(':scope > g')).toHaveCount(count);
	await expect(ring.locator('text').filter({ hasText: /%/ })).toHaveCount(0);
	for (const width of [1440, 1100, 768, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		await expect.poll(async () => page.evaluate(() => {
			const music = document.querySelector('.session-music')!.getBoundingClientRect();
			const rail = document.querySelector('.session-rail')!.getBoundingClientRect();
			const sheet = document.querySelector('[data-testid="lead-sheet-row"]');
			const frame = sheet?.getBoundingClientRect();
			const ink = sheet ? [...sheet.querySelectorAll('svg path, svg text.abcjs-chord')].map(e => e.getBoundingClientRect()) : [];
			return {
				overflow: document.documentElement.scrollWidth > window.innerWidth,
				separate: music.right <= rail.left || music.bottom <= rail.top,
				padding: ink.every(r => r.top >= frame!.top + 8 && r.bottom <= frame!.bottom - 8),
				tall: !sheet || Math.abs(sheet.closest('.row')!.getBoundingClientRect().height - 204.8) < .1
			};
		})).toEqual({ overflow: false, separate: true, padding: true, tall: true });
		await page.screenshot({ path: test.info().outputPath(`studio-desk-${width}.png`) });
	}
	await page.getByRole('button', { name: /end session/i }).click();
});

}
}
