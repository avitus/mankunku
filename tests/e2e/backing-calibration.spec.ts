import { test } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LOCAL calibration harness, not a CI test: renders single-hit events
 * JSONs through the lab's real offline chain (all mix sliders forced to 1,
 * volume 0.6) and prints the peak per voice. Grounds BACKING_BASE_TRIMS in
 * measured smplr behavior instead of source-derived assumptions. Point it
 * at a directory of calibration JSONs via CALIB_DIR.
 */

test('measure per-voice render peaks', async ({ page, browserName }) => {
	const calibDir = process.env.CALIB_DIR;
	test.skip(!calibDir || !!process.env.CI || browserName !== 'chromium', 'calibration harness — run locally with CALIB_DIR');
	test.setTimeout(600_000);

	await seedOnboardedAnonymous(page);
	await page.addInitScript(() => {
		const orig = URL.createObjectURL.bind(URL);
		(window as unknown as { __blobs: Blob[] }).__blobs = [];
		URL.createObjectURL = ((blob: Blob) => {
			(window as unknown as { __blobs: Blob[] }).__blobs.push(blob);
			return orig(blob);
		}) as typeof URL.createObjectURL;
	});
	await page.goto('/diagnostics/backing-mixer');
	// Neutralize persisted mix state: gain sliders to 1, and the room
	// return to 0 so per-voice level probes measure the dry voice alone
	// (the bus compressor still applies — calibrate with that in mind).
	for (const key of ['bass', 'comp', 'drums', 'kick', 'ride', 'hihat']) {
		await page.getByTestId(`mix-${key}`).fill('1');
	}
	await page.getByTestId('mix-room').fill('0');

	const input = page.locator('input[aria-label="Render WAV from events JSON"]');
	let rendered = 0;
	for (const file of readdirSync(calibDir!).sort()) {
		if (!file.endsWith('.json')) continue;
		await input.setInputFiles({
			name: file,
			mimeType: 'application/json',
			buffer: readFileSync(join(calibDir!, file))
		});
		rendered++;
		// Wait for OUR wav (worker-script blobs from instrument loading also
		// hit createObjectURL) or a surfaced render error.
		await page.waitForFunction(
			(n) =>
				(window as unknown as { __blobs: Blob[] }).__blobs.filter((b) => b.type === 'audio/wav')
					.length >= n || !!document.querySelector('.text-red-500'),
			rendered,
			{ timeout: 180_000 }
		);
		const uiError = await page.locator('.text-red-500').textContent().catch(() => null);
		if (uiError) {
			console.log(`CALIB ${file}: RENDER-ERROR ${uiError}`);
			rendered--;
			await page.reload();
			continue;
		}
		const result = await page.evaluate(async () => {
			const blobs = (window as unknown as { __blobs: Blob[] }).__blobs.filter(
				(b) => b.type === 'audio/wav'
			);
			const blob = blobs[blobs.length - 1];
			const meta = `size=${blob.size} type=${blob.type || 'n/a'}`;
			const buf = await blob.arrayBuffer();
			const ctx = new AudioContext();
			try {
				const audio = await ctx.decodeAudioData(buf);
				let p = 0;
				for (let c = 0; c < audio.numberOfChannels; c++) {
					const d = audio.getChannelData(c);
					for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
				}
				return `${meta} duration=${audio.duration.toFixed(2)} peak=${p.toFixed(5)}`;
			} catch (err) {
				return `${meta} DECODE-FAILED: ${err instanceof Error ? err.message : String(err)}`;
			} finally {
				await ctx.close();
			}
		});
		console.log(`CALIB ${file}: ${result}`);
	}
});
