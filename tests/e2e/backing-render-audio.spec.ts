import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * End-to-end audio verification of the listening lab's offline renders:
 * the bounce and the golden-JSON reference render must produce a WAV with
 * actual signal, not a silent file. Decodes the produced blob in-page and
 * measures peak amplitude. Chromium/WebKit and network-dependent (CDN
 * instrument samples), so CI runs skip it — it exists because a silent
 * render is invisible to every unit test we have.
 */

test('coordinated bounce and golden-JSON render produce non-silent WAVs', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'needs CDN instrument fetches — local diagnostic only');
	test.skip(browserName === 'firefox', 'Tone-less render path — verify on Chromium and WebKit, the engines with divergent audio stacks');
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
	await page.getByTestId('lab-orchestration').selectOption('coordinated');

	/**
	 * Peak + coverage profile of the last rendered WAV. Coverage is the
	 * fraction of half-second buckets (up to `musicSeconds`) whose RMS
	 * clears a floor — a render that dies after the first lookahead window
	 * has a high peak but near-zero coverage, which is exactly the failure
	 * a peak-only check waved through.
	 */
	const profileOfLastBlob = async (musicSeconds: number): Promise<{ peak: number; coverage: number }> =>
		page.evaluate(async (musicSecs) => {
			const blobs = (window as unknown as { __blobs: Blob[] }).__blobs.filter(
				(b) => b.type === 'audio/wav'
			);
			const blob = blobs[blobs.length - 1];
			if (!blob) return { peak: -1, coverage: -1 };
			const buf = await blob.arrayBuffer();
			const ctx = new AudioContext();
			try {
				const audio = await ctx.decodeAudioData(buf);
				const data = audio.getChannelData(0);
				const bucketLen = Math.floor(audio.sampleRate / 2);
				const buckets = Math.min(
					Math.floor(data.length / bucketLen),
					Math.ceil(musicSecs * 2)
				);
				let peak = 0;
				let covered = 0;
				for (let b = 0; b < buckets; b++) {
					let sum = 0;
					for (let i = b * bucketLen; i < (b + 1) * bucketLen; i++) {
						const v = Math.abs(data[i]);
						peak = Math.max(peak, v);
						sum += v * v;
					}
					if (Math.sqrt(sum / bucketLen) > 0.004) covered++;
				}
				return { peak, coverage: buckets > 0 ? covered / buckets : 0 };
			} finally {
				await ctx.close();
			}
		}, musicSeconds);

	// ── Path 1: normal bounce of the current engine (4-bar loop) ──
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	const bounceError = page.locator('text=/Error|failed/i');
	expect(await bounceError.count(), 'bounce reported an error').toBe(0);
	const bounce = await profileOfLastBlob(6.8);
	console.log(`bounce: peak=${bounce.peak.toFixed(3)} coverage=${bounce.coverage.toFixed(2)}`);

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
		.poll(
			async () =>
				page.evaluate(
					() =>
						(window as unknown as { __blobs: Blob[] }).__blobs.filter((b) => b.type === 'audio/wav')
							.length
				),
			{ timeout: 240_000 }
		)
		.toBeGreaterThanOrEqual(2);
	const golden = await profileOfLastBlob(18);
	console.log(`golden-JSON: peak=${golden.peak.toFixed(3)} coverage=${golden.coverage.toFixed(2)}`);

	// ── Stem isolation: which instruments actually render? ──
	await page.getByTestId('mix-bass').fill('0');
	await page.getByTestId('mix-comp').fill('0');
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	{
		const p = await profileOfLastBlob(6.8);
		console.log(`drums-only: peak=${p.peak.toFixed(3)} coverage=${p.coverage.toFixed(2)}`);
	}

	await page.getByTestId('mix-bass').fill('1');
	await page.getByTestId('mix-drums').fill('0');
	await page.getByTestId('lab-bounce').click();
	await expect(page.getByTestId('lab-bounce')).toHaveText(/Bounce to WAV/, { timeout: 240_000 });
	{
		const p = await profileOfLastBlob(6.8);
		console.log(`bass-only: peak=${p.peak.toFixed(3)} coverage=${p.coverage.toFixed(2)}`);
	}

	expect(bounce.peak, 'bounce WAV is silent').toBeGreaterThan(0.05);
	expect(golden.peak, 'golden-JSON WAV is silent').toBeGreaterThan(0.05);
	// The whole point: sound must span the music, not just the first
	// lookahead window. Swing comping has legitimate rest bars, so demand
	// most — not all — buckets carry energy.
	expect(bounce.coverage, 'bounce dies early — audio must span the full loop').toBeGreaterThan(0.7);
	expect(golden.coverage, 'golden render dies early — audio must span the form').toBeGreaterThan(0.7);
});

test('isolated bass and piano both render audible samples throughout a fixed phrase', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'needs CDN instrument fetches — local diagnostic only');
	test.skip(browserName === 'firefox', 'compare Chromium and WebKit sample decoding');
	test.setTimeout(300_000);
	await seedOnboardedAnonymous(page);
	await page.addInitScript(() => {
		const original = URL.createObjectURL.bind(URL);
		(window as unknown as { __stemBlobs: Blob[] }).__stemBlobs = [];
		URL.createObjectURL = ((blob: Blob) => {
			if (blob.type === 'audio/wav') (window as unknown as { __stemBlobs: Blob[] }).__stemBlobs.push(blob);
			return original(blob);
		}) as typeof URL.createObjectURL;
	});
	await page.goto('/diagnostics/backing-mixer');
	await page.getByRole('combobox', { name: 'Instrument', exact: true }).selectOption('piano');
	await page.getByTestId('mix-drums').fill('0');
	await page.getByTestId('mix-room').fill('0');
	// Fixed events avoid a generator's legitimate rest or device choice hiding
	// a missing sample bank. Both stems use the exact public JSON render path.
	const events = {
		phraseId: 'pitched-readiness', tempo: 120,
		bassEvents: Array.from({ length: 6 }, (_, i) => ({ time: `${i * 384}i`, midi: 43 + i % 3, velocity: 85, duration: 0.8, absBeat: i * 2 })),
		compEvents: Array.from({ length: 6 }, (_, i) => ({ time: `${i * 384}i`, notes: [60, 64, 67], velocity: 80, duration: 0.8 })),
		drumEvents: []
	};
	for (const [index, stem] of ['bass', 'piano'].entries()) {
		await page.getByTestId('mix-bass').fill(stem === 'bass' ? '1' : '0');
		await page.getByTestId('mix-comp').fill(stem === 'piano' ? '1' : '0');
		await page.locator('input[aria-label="Render WAV from events JSON"]').setInputFiles({
			name: `${stem}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(events))
		});
		await expect.poll(() => page.evaluate(() => (window as unknown as { __stemBlobs: Blob[] }).__stemBlobs.length), { timeout: 240_000 }).toBe(index + 1);
		const signal = await page.evaluate(async () => {
			const blobs = (window as unknown as { __stemBlobs: Blob[] }).__stemBlobs;
			const context = new AudioContext();
			try {
				const buffer = await context.decodeAudioData(await blobs[blobs.length - 1].arrayBuffer());
				const samples = buffer.getChannelData(0);
				const peaks = Array.from({ length: 6 }, (_, second) => {
					let peak = 0;
					for (let i = second * buffer.sampleRate; i < (second + 0.8) * buffer.sampleRate; i++) peak = Math.max(peak, Math.abs(samples[i]));
					return peak;
				});
				return { peaks };
			} finally { await context.close(); }
		});
		console.log(`${stem} isolated sample peaks: ${signal.peaks.map((peak) => peak.toFixed(4)).join(', ')}`);
		for (const [note, peak] of signal.peaks.entries()) expect(peak, `${stem} note ${note + 1} is silent`).toBeGreaterThan(0.005);
	}
});
