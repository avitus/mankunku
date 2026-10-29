import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import { SEEDED_PROGRESS, SUB_FLOOR_PROGRESS } from './fixtures/lick-practice-seeds';

/**
 * Lick-practice session setup: what the route does before the first count-in
 * — the key stack, the notation engine prefetch — and how it fails when the
 * microphone or the instrument samples do not arrive.
 *
 * One of the lick-practice session specs, cut by subject so CircleCI's
 * file-level test splitting can spread them across nodes; the flow they
 * share and the seeds are described in fixtures/lick-practice-seeds.ts.
 */
test.describe('lick-practice session flow', () => {
	/**
	 * The key stack is built before the microphone is requested (so it is on
	 * screen while the samples load), which means a refused microphone must
	 * not leave a populated, silent stack behind: the session shows the same
	 * microphone banner tune practice shows, and no chart. The refusal is
	 * installed on `MediaDevices.prototype` (like the mock itself) so WebKit's
	 * collectable `navigator.mediaDevices` wrapper cannot drop it.
	 */
	test('shows a microphone error instead of the key stack when the mic is refused', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(60_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SEEDED_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		await page.goto('/lick-practice');
		await page.evaluate(() => {
			MediaDevices.prototype.getUserMedia = () =>
				Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
		});
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);

		await expect(page.getByTestId('mic-error')).toBeVisible({ timeout: 20_000 });
		await expect(page.locator('.chart-wrap')).toHaveCount(0);
		await expect(page.getByTestId('lead-sheet-row')).toHaveCount(0);
		// The way out is still there.
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
	});

	/**
	 * The instrument load is the one long network wait in session setup, and
	 * a failed one used to strand the page: `initializeSession` awaited it
	 * with no catch, so the rejection escaped as an unhandled promise and the
	 * prebuilt key stack stood forever — populated, silent, never counting in.
	 * Every instrument source is made to fail — the local sax samples and the
	 * soundfont `playback.ts` falls back to when they fail — so the load
	 * rejects. The failure lands in the setup banner, in the stack's place;
	 * the automatic console guard fails the test on the unhandled rejection
	 * the unguarded await used to leave.
	 *
	 * The failure is a rejected `fetch`, installed in the page, rather than an
	 * aborted route: an aborted request writes the browser's own
	 * "Failed to load resource" line to the console (the guard would fail on
	 * the condition the test induces on purpose), and a rejected fetch is
	 * exactly what smplr sees from a dropped connection — it calls the global
	 * `fetch` for every sample.
	 */
	test('shows the setup error instead of hanging when the instrument samples fail to load', async ({
		page,
		browserName,
		consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(60_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SEEDED_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.addInitScript(() => {
			const w = window as unknown as { __failedSampleFetches: number };
			w.__failedSampleFetches = 0;
			const origFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (/\/samples\/tenor-sax\/|gleitz\.github\.io/.test(url)) {
					w.__failedSampleFetches++;
					return Promise.reject(new TypeError('Failed to fetch'));
				}
				return origFetch(input, init);
			};
		});

		await page.goto('/lick-practice');
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);

		await expect(page.getByTestId('load-error')).toBeVisible({ timeout: 30_000 });
		// The failure really was the instrument load, not some earlier step.
		expect(
			await page.evaluate(
				() => (window as unknown as { __failedSampleFetches: number }).__failedSampleFetches
			)
		).toBeGreaterThan(0);
		// The banner stands in the stack's place — no silent rows left behind,
		// nothing counting in — and the way out is still there.
		await expect(page.locator('.chart-wrap')).toHaveCount(0);
		await expect(page.getByTestId('lead-sheet-row')).toHaveCount(0);
		await expect(page.locator('.phase-tab')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /end session/i })).toBeVisible();
		// Logged, as a warning: the banner is the user's report of a dropped
		// connection, and a console.error would fail the guard.
		await expect
			.poll(() => consoleCollector.warnings.some((w) => w.startsWith('[lick-practice] audio setup failed')))
			.toBe(true);
	});

	/**
	 * The notation engine (abcjs, the second-largest chunk in the bundle) is a
	 * dynamic import that nothing on the Daily path touches before the session
	 * — so the first lead-sheet row used to issue the fetch from its own mount,
	 * which is the moment the count-in starts. The session must request it
	 * during SETUP instead: before the instrument samples, which `initializeSession`
	 * awaits (after the mic, before the pitch detector) ahead of the first
	 * count-in. Both timestamps are taken in this process, from the requests
	 * themselves, so the ordering is not a race against the page. The seed
	 * reveals the one key, so a session that only fetched on engrave still
	 * fetches — and fails on the ORDER, not on a missing request.
	 */
	test('fetches the notation engine and builds the key stack during session setup, before the samples load', async ({
		page,
		browserName,
		consoleCollector: _consoleCollector
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		test.setTimeout(120_000);

		await seedOnboardedAnonymous(page);
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SUB_FLOOR_PROGRESS
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);

		// Observers go on AFTER the stubs so they run first and fall through.
		// The engine's chunk has a hashed name; it is the one that carries the
		// library's own version banner.
		let abcjsRequestedAt: number | null = null;
		let samplesRequestedAt: number | null = null;
		await page.route('**/_app/immutable/chunks/*.js', async (route) => {
			const at = Date.now();
			const response = await route.fetch();
			const body = await response.text();
			if (abcjsRequestedAt === null && body.includes('abcjs-basic v')) abcjsRequestedAt = at;
			await route.fulfill({ response, body });
		});
		const noteSamples = async (route: import('@playwright/test').Route) => {
			samplesRequestedAt ??= Date.now();
			await route.fallback();
		};
		await page.route('https://smpldsnds.github.io/**', noteSamples);
		await page.route('https://gleitz.github.io/**', noteSamples);

		// In-page, one clock: when the lead-sheet row enters the DOM versus the
		// first instrument sample fetch. The rows are plan state, not audio
		// state, so they must not wait behind the sample load — the sax set is
		// 66 files and with the backing kit the Daily path decodes 307, which
		// is a slow connection's whole download and measured 20–45 s on a
		// contended CI runner (three consecutive builds timed out waiting for
		// the row on 2026-09-07).
		await page.addInitScript(() => {
			const order = { leadRowAt: null as number | null, sampleFetchAt: null as number | null };
			(window as unknown as { __order: typeof order }).__order = order;
			const origFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (order.sampleFetchAt === null && /\/samples\/|smpldsnds|gleitz/.test(url)) {
					order.sampleFetchAt = performance.now();
				}
				return origFetch(input, init);
			};
			new MutationObserver((_, observer) => {
				if (order.leadRowAt === null && document.querySelector('[data-testid="lead-sheet-row"]')) {
					order.leadRowAt = performance.now();
					observer.disconnect();
				}
			}).observe(document, { childList: true, subtree: true });
		});

		await page.goto('/lick-practice');
		const startBtn = page.getByRole('button', { name: /start daily practice/i });
		await expect(startBtn).toBeEnabled();
		await startBtn.click();
		await expect(page).toHaveURL(/\/lick-practice\/session$/);
		// The stack exists as soon as setup begins — before the samples, which
		// the instrument load requests a little later.
		await expect(page.locator('.chart-wrap').first()).toBeVisible({ timeout: 60_000 });
		await expect.poll(() => abcjsRequestedAt, { timeout: 20_000 }).not.toBeNull();
		await expect.poll(() => samplesRequestedAt, { timeout: 60_000 }).not.toBeNull();

		expect(abcjsRequestedAt!).toBeLessThan(samplesRequestedAt!);

		// The row was on screen before the instrument asked for its first sample.
		const readOrder = () =>
			page.evaluate(
				() => (window as unknown as { __order: { leadRowAt: number | null; sampleFetchAt: number | null } }).__order
			);
		await expect.poll(async () => (await readOrder()).sampleFetchAt, { timeout: 60_000 }).not.toBeNull();
		const order = await readOrder();
		expect(order.leadRowAt).not.toBeNull();
		expect(order.leadRowAt!).toBeLessThan(order.sampleFetchAt!);
		// Drain chunk observers before Playwright disposes their fetched responses.
		await page.unrouteAll({ behavior: 'wait' });
	});
});
