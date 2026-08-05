import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * End-to-end audio verification of the listening lab's offline renders:
 * the bounce and the golden-JSON reference render must produce a WAV with
 * actual signal, not a silent file. Decodes the produced blob in-page and
 * measures peak amplitude. Chromium-only and network-dependent (CDN
 * instrument samples), so CI runs skip it — it exists because a silent
 * render is invisible to every unit test we have.
 */

test('bounce and golden-JSON render produce non-silent WAVs', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'needs CDN instrument fetches — local diagnostic only');
	test.skip(browserName !== 'chromium', 'one engine is enough for an audio-presence check');
	test.setTimeout(300_000);

	await seedOnboardedAnonymous(page);
	// Capture blobs handed to object URLs so we can decode what the user hears.
	await page.addInitScript(() => {
		const orig = URL.createObjectURL.bind(URL);
		(window as unknown as { __blobs: Blob[] }).__blobs = [];
		URL.createObjectURL = ((blob: Blob) => {
			(window as unknown as { __blobs: Blob[] }).__blobs.push(blob);
			return orig(blob);
		}) as typeof URL.createObjectURL;
	});
	await page.goto('/diagnostics/backing-mixer');

	const peakOfLastBlob = async (): Promise<number> =>
		page.evaluate(async () => {
			const blobs = (window as unknown as { __blobs: Blob[] }).__blobs;
			const blob = blobs[blobs.length - 1];
			if (!blob) return -1;
			const buf = await blob.arrayBuffer();
			const ctx = new AudioContext();
			try {
				const audio = await ctx.decodeAudioData(buf);
				let peak = 0;
				for (let c = 0; c < audio.numberOfChannels; c++) {
					const data = audio.getChannelData(c);
					for (let i = 0; i < data.length; i += 13) peak = Math.max(peak, Math.abs(data[i]));
				}
				return peak;
			} finally {
				await ctx.close();
			}
		});

	// ── Path 1: normal bounce of the current engine (4-bar loop) ──
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	const bounceError = page.locator('text=/Error|failed/i');
	expect(await bounceError.count(), 'bounce reported an error').toBe(0);
	const bouncePeak = await peakOfLastBlob();
	console.log(`bounce peak amplitude: ${bouncePeak}`);

	// ── Path 2: reference render from a committed golden events JSON ──
	const jsonPath = join(process.cwd(), 'tests', 'fixtures', 'backing', 'golden-lab-blues-f-160.json');
	await page.locator('input[aria-label="Render WAV from events JSON"]').setInputFiles({
		name: 'old-blues-160.json',
		mimeType: 'application/json',
		buffer: readFileSync(jsonPath)
	});
	await expect(page.locator('label', { hasText: /Render WAV from events JSON/ })).toBeVisible({
		timeout: 240_000
	});
	await expect
		.poll(async () => page.evaluate(() => (window as unknown as { __blobs: Blob[] }).__blobs.length), {
			timeout: 240_000
		})
		.toBeGreaterThanOrEqual(2);
	const jsonPeak = await peakOfLastBlob();
	console.log(`golden-JSON render peak amplitude: ${jsonPeak}`);

	// ── Stem isolation: which instruments actually render? ──
	await page.getByTestId('mix-bass').fill('0');
	await page.getByTestId('mix-comp').fill('0');
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	console.log(`drums-only bounce peak: ${await peakOfLastBlob()}`);

	await page.getByTestId('mix-bass').fill('1');
	await page.getByTestId('mix-drums').fill('0');
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	console.log(`bass-only bounce peak: ${await peakOfLastBlob()}`);

	expect(bouncePeak, 'bounce WAV is silent').toBeGreaterThan(0.01);
	expect(jsonPeak, 'golden-JSON WAV is silent').toBeGreaterThan(0.01);
});
