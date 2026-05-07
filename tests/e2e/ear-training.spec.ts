import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock } from './fixtures/audio';

/**
 * Regression: clicking the start button twice in quick succession used to
 * start two simultaneous practice sessions because handlePlay() awaits
 * ensureMicCapture() / loadInstrument() before any state flips, leaving a
 * window in which a second click re-enters the handler. The fix is a
 * synchronous `starting` flag set before the first await.
 *
 * This test counts getUserMedia invocations after a synchronous double-click:
 * the first handlePlay always calls it; a second, unguarded handlePlay would
 * call it again because micCapture is still null until the first call's
 * await resolves. Exactly one call proves the guard is in place.
 */
test.describe('ear-training: double-start guard', () => {
	test('rapid double-click on play does not start two sessions', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await seedOnboardedAnonymous(page);
		await installAudioMock(page);

		await page.addInitScript(() => {
			(window as unknown as { __gumCount: number }).__gumCount = 0;
			const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
			navigator.mediaDevices.getUserMedia = async (
				constraints?: MediaStreamConstraints
			): Promise<MediaStream> => {
				(window as unknown as { __gumCount: number }).__gumCount++;
				return orig(constraints);
			};
		});

		await page.goto('/ear-training', { waitUntil: 'networkidle' });
		await expect(page.locator('main')).toBeVisible();

		const playBtn = page.locator('[data-tour="play-button"]');
		await expect(playBtn).toBeEnabled();

		// Fire two clicks back-to-back inside a single evaluate call so the
		// second click runs before the first handlePlay's first await resolves.
		// Wait until at least one click has reached getUserMedia, then assert
		// the final count to distinguish guarded (1) from unguarded (2).
		await page.evaluate(() => {
			const btn = document.querySelector('[data-tour="play-button"]') as HTMLButtonElement;
			btn.click();
			btn.click();
		});

		await page.waitForFunction(
			() => (window as unknown as { __gumCount: number }).__gumCount >= 1,
			{ timeout: 5000 }
		);
		// Give a second, unguarded handlePlay enough time to also reach
		// getUserMedia (audio mock resolves ~200ms after invocation).
		await page.waitForTimeout(500);

		const gumCount = await page.evaluate(
			() => (window as unknown as { __gumCount: number }).__gumCount
		);
		expect(gumCount).toBe(1);
	});
});
