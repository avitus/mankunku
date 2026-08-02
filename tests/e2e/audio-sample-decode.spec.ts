import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Proves that real browser engines can decode the samples we ship.
 *
 * The unit test `tests/unit/audio/sample-formats.test.ts` checks the codec
 * identifier in the container, which is fast and exhaustive but is still a
 * proxy. This runs the actual `decodeAudioData` these files go through at
 * runtime, on Chromium, Firefox and WebKit.
 *
 * WebKit is the one that matters: three drum samples shipped as Ogg FLAC,
 * which it cannot decode, so the kit failed to load for every Safari user and
 * the drums were simply silent. The failure was invisible because smplr drops
 * a sample whose buffer fails (`if (buffer) preloaded.set(...)`) and then
 * refetches it from `baseUrl("") + name + ".ogg"` — so the only outward sign
 * was a puzzling `/kick.ogg` 404.
 */

/** One representative per instrument directory, plus every drum. */
const SAMPLES = [
	'/samples/drums/kick.ogg',
	'/samples/drums/ride.ogg',
	'/samples/drums/hihat.ogg',
	'/samples/tenor-sax/f_60.ogg',
	'/samples/alto-sax/f_60.ogg',
	'/samples/soprano-sax/f_60.ogg'
];

test.describe('shipped audio samples decode in every engine', () => {
	test.beforeEach(async ({ page }) => {
		await seedOnboardedAnonymous(page);
	});

	test('decodeAudioData accepts every sample the app loads', async ({
		page,
		consoleCollector: _consoleCollector
	}) => {
		await page.goto('/');

		const results = await page.evaluate(async (urls: string[]) => {
			const out: { url: string; ok: boolean; detail: string }[] = [];
			for (const url of urls) {
				try {
					const res = await fetch(url);
					if (!res.ok) {
						out.push({ url, ok: false, detail: `fetch ${res.status}` });
						continue;
					}
					const bytes = await res.arrayBuffer();
					const ctx = new AudioContext();
					try {
						const buf = await ctx.decodeAudioData(bytes.slice(0));
						out.push({
							url,
							ok: buf.duration > 0,
							detail: `${buf.duration.toFixed(3)}s / ${buf.numberOfChannels}ch`
						});
					} catch (err) {
						out.push({ url, ok: false, detail: `decode ${(err as Error)?.name}` });
					} finally {
						await ctx.close().catch(() => {});
					}
				} catch (err) {
					out.push({ url, ok: false, detail: String(err) });
				}
			}
			return out;
		}, SAMPLES);

		// Assert on the whole set so a failure names every offender at once.
		const failures = results.filter((r) => !r.ok).map((r) => `${r.url}: ${r.detail}`);
		expect(failures, 'samples this engine cannot decode').toEqual([]);
		expect(results).toHaveLength(SAMPLES.length);
	});
});
