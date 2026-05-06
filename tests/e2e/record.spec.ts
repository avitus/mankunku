import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

/**
 * /record route — verifies the recording UI mounts and the mocked audio
 * pipeline can be installed without crashing.
 *
 * Full record → transcribe → save → library round-trips depend on the
 * downstream pipeline accepting the fixture WAV exactly as it would a
 * real WebM. That round-trip is in the plan but deferred until we've
 * exercised the simpler smoke layer in CI.
 */

test.describe('record route', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
		await installAudioMock(page, {
			fixturePath: '2026-04-14-a4-c5-tenor-sax.wav'
		});
	});

	test('record page renders the start-recording control', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/record');
		await expect(page.locator('main')).toBeVisible();

		// The record page exposes a large circular start-recording button.
		// We assert at least one button exists in main; production has a few
		// (record, stop, tempo controls). The exact selector is intentionally
		// loose because the buttons currently have no aria-label.
		const buttons = page.locator('main button');
		expect(await buttons.count()).toBeGreaterThan(0);
	});
});
