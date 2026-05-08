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

		// Inject a synthetic trigger button that fires two synchronous
		// clicks on the play button when invoked. We click this trigger
		// via Playwright (a real CDP click event = user gesture). The
		// trigger's handler runs within the gesture-activated task, and
		// the two nested btn.click() calls inherit that activation —
		// crucial because Tone.start() awaits AudioContext.resume() which
		// requires a user gesture under Firefox/WebKit autoplay policies.
		// Firing both clicks synchronously (before any await yields) is
		// what tests the guard: the first click sets starting=true; the
		// second click's handler synchronously sees starting=true and
		// returns. Without the guard, both handlePlay invocations queue,
		// both reach getUserMedia → __gumCount goes to 2.
		await page.evaluate(() => {
			const playBtn = document.querySelector(
				'[data-tour="play-button"]'
			) as HTMLButtonElement;
			const trigger = document.createElement('button');
			trigger.id = '__double-click-trigger';
			trigger.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;';
			trigger.textContent = 'trigger';
			trigger.addEventListener('click', () => {
				playBtn.click();
				playBtn.click();
			});
			document.body.appendChild(trigger);
		});

		await page.locator('#__double-click-trigger').click();

		// Wait until at least one handlePlay reaches getUserMedia, then
		// give a second (unguarded) one time to also call it.
		await expect
			.poll(
				() =>
					page.evaluate(() => (window as unknown as { __gumCount: number }).__gumCount),
				{ intervals: [100], timeout: 10_000 }
			)
			.toBeGreaterThanOrEqual(1);
		await page.waitForTimeout(1000);

		const gumCount = await page.evaluate(
			() => (window as unknown as { __gumCount: number }).__gumCount
		);
		expect(gumCount).toBe(1);
	});
});
