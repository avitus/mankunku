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
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		// Headless Linux Firefox in CI hangs in Tone.start() →
		// AudioContext.resume(), which never resolves without a real audio
		// output device (cubeb backend). The click never reaches getUserMedia
		// so the count signal can't be observed. The double-start guard
		// itself is browser-agnostic; coverage on Chromium and WebKit
		// catches any regression. Narrowed to CI Linux only so Firefox
		// still runs on developer machines and non-Linux systems.
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);

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

		// Fire two synchronous clicks before the first handlePlay's first
		// await yields. With the guard, click 1 sets starting=true and
		// click 2 sees it synchronously and returns; only click 1 reaches
		// getUserMedia (count=1). Without the guard, both invocations
		// queue, both reach getUserMedia in parallel because micCapture is
		// still null when the second runs (count=2).
		await page.evaluate(() => {
			const btn = document.querySelector('[data-tour="play-button"]') as HTMLButtonElement;
			btn.click();
			btn.click();
		});

		await expect
			.poll(
				() =>
					page.evaluate(() => (window as unknown as { __gumCount: number }).__gumCount),
				{ intervals: [100], timeout: 10_000 }
			)
			.toBeGreaterThanOrEqual(1);
		// Give a second (unguarded) handlePlay time to also reach getUserMedia.
		await page.waitForTimeout(500);

		const gumCount = await page.evaluate(
			() => (window as unknown as { __gumCount: number }).__gumCount
		);
		expect(gumCount).toBe(1);
	});
});
