import type { Page } from '@playwright/test';
import { test, expect, type ConsoleCollector } from './fixtures/test';
import { seedOnboardedAnonymous, seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/** A newly unlocked scale can start; an invalid legacy level cannot bypass the gates. */
for (const level of [0, 1]) test(`ear-training: Altered at level ${level} respects pool eligibility`, async ({ page }) => {
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, tonalityOverride: { key: 'C', scaleType: 'altered' } },
		'tour-state': TOUR_DISMISSED,
		progress: {
			scaleProficiency: {
				'melodic-minor': { level: 40 }, // Unlock Altered independently of its own level.
				altered: { level }
			}
		}
	});
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/ear-training', { waitUntil: 'networkidle' });
	await expect(page.getByText('Altered', { exact: true })).toBeVisible();
	if (level === 0) {
		await expect(page.getByText('No phrases fit this scale at your current level.')).toBeVisible();
		await expect(page.locator('[data-tour="play-button"]')).toBeDisabled();
	} else {
		await expect(page.getByText('No phrases fit this scale at your current level.')).toHaveCount(0);
		await expect(page.locator('[data-tour="play-button"]')).toBeEnabled();
	}
});

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
		// The call counter rides inside the mock's own init script: a second
		// script wrapping the stub would depend on init-script order, which
		// Playwright leaves undefined (see fixtures/audio.ts).
		await installAudioMock(page, { countGetUserMediaCalls: true });
		// Flow test, never asserts audible output: serve the piano/sax samples
		// locally so a CDN CORS hiccup can't fail it (see fixtures/audio.ts).
		await stubCdnInstrumentSamples(page);

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

/**
 * A whole ear-training take, Play to saved recording. The mocked mic holds a
 * steady tone, so the listening window opens, the take starts on the tone and
 * ends on the phrase's time bound, and the mocked recorder hands back a
 * fixture WAV that is saved with the take's metadata.
 *
 * Pins that the saved take carries the clock evidence the click-grid
 * investigation reads (capture-timing.ts): the arm instant with the transport
 * read both ways, the recorder's start call and start event, and the live
 * detectors' readings on the audio clock.
 */
test.describe('ear-training: saved take', () => {
	test('is saved with its capture timing', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}: {
		page: Page;
		browserName: string;
		consoleCollector: ConsoleCollector;
	}): Promise<void> => {
		// Same limit the lick-practice take spec records: WebKit cannot store a
		// Blob in IndexedDB in Playwright's ephemeral context.
		test.skip(browserName === 'webkit', 'WebKit cannot store a Blob in ephemeral IndexedDB');
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(60_000);

		await seedOnboardedAnonymous(page);
		await installAudioMock(page, { fixturePath: '2026-09-18-blues-curl-up.wav' });
		await stubCdnInstrumentSamples(page);
		await page.goto('/ear-training', { waitUntil: 'networkidle' });
		await page.locator('[data-tour="play-button"]').click();

		/** The capture timing of the first saved ear-training take, or null while there is none. */
		const readTiming = () =>
			page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const req = indexedDB.open('mankunku-audio:anon', 1);
					req.onupgradeneeded = () => {
						if (!req.result.objectStoreNames.contains('recordings')) {
							req.result.createObjectStore('recordings', { keyPath: 'sessionId' });
						}
					};
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				});
				try {
					const rows = await new Promise<
						Array<{ metadata: { source?: string; captureTiming?: unknown } | null }>
					>((resolve, reject) => {
						const req = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
						req.onsuccess = () => resolve(req.result);
						req.onerror = () => reject(req.error);
					});
					const take = rows.find((r) => r.metadata?.source === 'ear-training');
					return take ? (take.metadata?.captureTiming ?? 'missing') : null;
				} finally {
					db.close();
				}
			});

		await expect.poll(readTiming, { timeout: 45_000 }).not.toBeNull();
		const t = (await readTiming()) as {
			version: number;
			arm: {
				transportSeconds: number;
				transportSecondsAtContextTime: number | null;
				lookAhead: number | null;
				liveWindowSeconds: number;
			};
			recorder: { startEvent: { contextTime: number } | null } | null;
			liveReadings: Array<[number, number, number]>;
		};
		expect(t).not.toBe('missing');
		expect(t.version).toBe(1);
		expect(typeof t.arm.transportSeconds).toBe('number');
		expect(typeof t.arm.transportSecondsAtContextTime).toBe('number');
		expect(t.arm.lookAhead).toBeGreaterThan(0);
		expect(t.arm.liveWindowSeconds).toBeGreaterThan(0.05);
		expect(t.recorder?.startEvent).not.toBeNull();
		// The mocked mic's steady tone: the take started on it, so the live
		// detector read it.
		expect(t.liveReadings.length).toBeGreaterThan(0);
	});
});
