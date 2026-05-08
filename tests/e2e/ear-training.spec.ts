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

		// Fire synchronous double-clicks in a polling loop. The dynamic
		// imports in onMount may not have completed when the page settles
		// (Firefox is noticeably slower than Chromium/WebKit on CI), in
		// which case handlePlay returns at its `!playback` early-out and
		// the click is a silent no-op. We retry every 200ms until the
		// first effective pair lands, observable as __gumCount > 0. The
		// pair itself is what tests the guard: the first click increments
		// the counter; the second is rejected (guard works → final 1) or
		// also reaches getUserMedia in parallel (guard broken → final 2).
		await expect
			.poll(
				async () => {
					await page.evaluate(() => {
						const btn = document.querySelector(
							'[data-tour="play-button"]'
						) as HTMLButtonElement;
						btn.click();
						btn.click();
					});
					return page.evaluate(
						() => (window as unknown as { __gumCount: number }).__gumCount
					);
				},
				{ intervals: [200], timeout: 15_000 }
			)
			.toBeGreaterThan(0);

		// Let an unguarded second handlePlay finish reaching getUserMedia
		// (the audio mock holds ~200ms) before reading the final count.
		await page.waitForTimeout(500);

		const gumCount = await page.evaluate(
			() => (window as unknown as { __gumCount: number }).__gumCount
		);
		expect(gumCount).toBe(1);
	});
});
