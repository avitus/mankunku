import type { Page } from '@playwright/test';
import { test, expect, type ConsoleCollector } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

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
	}: {
		page: Page;
		browserName: string;
		consoleCollector: ConsoleCollector;
	}): Promise<void> => {
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
		// Flow test, never asserts audible output: serve the piano/sax samples
		// locally so a CDN CORS hiccup can't fail it (see fixtures/audio.ts).
		await stubCdnInstrumentSamples(page);

		await page.addInitScript((): void => {
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
		await page.evaluate((): void => {
			const btn = document.querySelector('[data-tour="play-button"]') as HTMLButtonElement;
			btn.click();
			btn.click();
		});

		await expect
			.poll(
				(): Promise<number> =>
					page.evaluate(
						(): number => (window as unknown as { __gumCount: number }).__gumCount
					),
				{ intervals: [100], timeout: 10_000 }
			)
			.toBeGreaterThanOrEqual(1);
		// Give a second (unguarded) handlePlay time to also reach getUserMedia.
		await page.waitForTimeout(500);

		const gumCount = await page.evaluate(
			(): number => (window as unknown as { __gumCount: number }).__gumCount
		);
		expect(gumCount).toBe(1);
	});
});

/**
 * The practice-time counter is driven off a `practising` flag that spans the
 * whole run — including the awaiting-input and auto-advance phases, where the
 * engine sits at 'ready'. These tests pin the two ends of that behaviour: it
 * stays hidden until a run actually begins, and once begun it advances.
 */
test.describe('ear-training: practice-time counter', () => {
	const timerSeconds = async (page: Page): Promise<number> => {
		const text = (await page.getByRole('timer').textContent()) ?? '';
		const parts = text.trim().split(':').map(Number);
		return parts.reduce((acc, part) => acc * 60 + part, 0);
	};

	test('stays hidden until a practice run starts, then counts up', async ({
		page,
		consoleCollector: _consoleCollector
	}: {
		page: Page;
		consoleCollector: ConsoleCollector;
	}): Promise<void> => {
		await seedOnboardedAnonymous(page);
		await installAudioMock(page);
		// Flow test, never asserts audible output: serve the piano/sax samples
		// locally so a CDN CORS hiccup can't fail it (see fixtures/audio.ts).
		await stubCdnInstrumentSamples(page);

		await page.goto('/ear-training', { waitUntil: 'networkidle' });
		await expect(page.locator('main')).toBeVisible();

		// Nothing has been practised yet, so there is no clock to show.
		await expect(page.getByRole('timer')).toHaveCount(0);

		const playBtn = page.locator('[data-tour="play-button"]');
		await expect(playBtn).toBeEnabled();
		await playBtn.click();

		// `starting` flips synchronously inside handlePlay, so the counter
		// appears without waiting on the audio pipeline.
		await expect(page.getByRole('timer')).toBeVisible({ timeout: 10_000 });

		const first = await timerSeconds(page);
		await expect
			.poll((): Promise<number> => timerSeconds(page), { intervals: [250], timeout: 10_000 })
			.toBeGreaterThan(first);
	});
});
