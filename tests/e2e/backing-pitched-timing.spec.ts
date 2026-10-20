import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

test('shipped bass and piano attack promptly in a dry WAV render', async ({ page, browserName }) => {
	test.skip(!!process.env.CI, 'needs real CDN instrument recordings — local diagnostic only');
	// Forty independent full-bank decodes can take five minutes on WebKit.
	test.setTimeout(480_000);
	await seedOnboardedAnonymous(page);
	// Keep the recordings, decoder, sampler and mixer real. A synthesized
	// replacement would conceal the sample-content delay this test detects.
	await page.addInitScript(() => {
		// Each isolated render loads the bank anew. Download its real bytes once
		// per test instead of sending forty bank-sized request bursts to the CDN.
		const fetch = window.fetch.bind(window);
		const recordings = new Map<string, Promise<Response>>();
		window.fetch = (input, init) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (!url.startsWith('https://smpldsnds.github.io/') || (init?.method && init.method !== 'GET')) return fetch(input, init);
			let pending = recordings.get(url);
			if (!pending) {
				pending = fetch(input, init);
				recordings.set(url, pending);
				void pending.then((response) => { if (!response.ok) recordings.delete(url); }, () => recordings.delete(url));
			}
			return pending.then((response) => response.clone());
		};
		const original = URL.createObjectURL.bind(URL);
		const blobs: Blob[] = [];
		Object.assign(window, { __pitchedTimingBlobs: blobs });
		URL.createObjectURL = ((blob: Blob) => {
			if (blob.type === 'audio/wav') blobs.push(blob);
			return original(blob);
		}) as typeof URL.createObjectURL;
	});
	await page.goto('/diagnostics/backing-mixer');
	await page.locator('select:has(option[value="piano"]):has(option[value="organ"])').selectOption('piano');
	await page.getByTestId('mix-room').fill('0');
	const hits = [
		...[28, 36, 43, 48, 55].flatMap((midi) =>
			[45, 80, 110].map((velocity) => ({ instrument: 'bass', midi, velocity }))),
		// Cover all five SplendidGrandPiano velocity groups, including its
		// filtered quietest group. Low notes also exercise recordings whose
		// upstream sample definitions specify a content start offset.
		...[35, 38, 48, 60, 72].flatMap((midi) =>
			[35, 55, 75, 95, 115].map((velocity) => ({ instrument: 'piano', midi, velocity })))
	].map((hit) => ({ ...hit, second: 1 }));
	// Render each note separately: a combined Firefox render retained residual
	// audio that must not influence another note's attack measurement. Direct event
	// times isolate rendering from the generator's intentional piano layback.
	const measurements = [];
	for (const scheduledHit of hits) {
		const events = {
			phraseId: 'shipped-pitched-attack-alignment', tempo: 120,
			bassEvents: [scheduledHit].filter((hit) => hit.instrument === 'bass').map((hit) => ({
				time: `${hit.second * 384}i`, midi: hit.midi, velocity: hit.velocity,
				duration: 0.35, absBeat: hit.second * 2
			})),
			compEvents: [scheduledHit].filter((hit) => hit.instrument === 'piano').map((hit) => ({
				time: `${hit.second * 384}i`, notes: [hit.midi], velocity: hit.velocity,
				duration: 0.35, absBeat: hit.second * 2
			})),
			drumEvents: []
		};
		await page.locator('input[aria-label="Render WAV from events JSON"]').setInputFiles({
			name: 'pitched-attack-alignment.json', mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(events))
		});
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __pitchedTimingBlobs: Blob[] }).__pitchedTimingBlobs.length),
			{ timeout: 240_000 }).toBe(1);
		const measurement = await page.evaluate(async (hit) => {
			const blob = (window as unknown as { __pitchedTimingBlobs: Blob[] }).__pitchedTimingBlobs.shift()!;
			const context = new AudioContext();
			try {
				const audio = await context.decodeAudioData(await blob.arrayBuffer());
				const rmsAt = (millisecond: number) => {
					const start = Math.round((hit.second + millisecond / 1000) * audio.sampleRate);
					const end = Math.round((hit.second + (millisecond + 1) / 1000) * audio.sampleRate);
					let squares = 0;
					for (let channel = 0; channel < audio.numberOfChannels; channel++) {
						const samples = audio.getChannelData(channel);
						for (let frame = start; frame < end; frame++) squares += samples[frame] ** 2;
					}
					return Math.sqrt(squares / ((end - start) * audio.numberOfChannels));
				};
				const rms = Array.from({ length: 150 }, (_, millisecond) => rmsAt(millisecond));
				const peakRms = Math.max(...rms);
				return {
					...hit, peakRms,
					beforeRms: Math.max(...Array.from({ length: 50 }, (_, millisecond) => rmsAt(millisecond - 50))),
					attack10Ms: rms.findIndex((value) => value >= peakRms * 0.1),
					attack50Ms: rms.findIndex((value) => value >= peakRms * 0.5),
					peakMs: rms.indexOf(peakRms)
				};
			} finally { await context.close(); }
		}, scheduledHit);
		measurements.push(measurement);
	}
	console.log(`${browserName} shipped pitched attacks: ${JSON.stringify(measurements)}`);
	await test.info().attach('pitched-attack-measurements', {
		body: JSON.stringify(measurements, null, 2), contentType: 'application/json'
	});
	for (const hit of measurements) {
		const label = `${hit.instrument} MIDI ${hit.midi} velocity ${hit.velocity}`;
		expect(hit.peakRms, `${label} must contain real audible sample energy`).toBeGreaterThan(0.001);
		// Keep any pre-hit energy 20 dB below the 10% onset threshold.
		expect(hit.beforeRms, `${label} must have a silent lead-in`).toBeLessThan(hit.peakRms * 0.01);
		expect(hit.attack10Ms, label).toBeGreaterThanOrEqual(0);
		// Typical attacks measure 6–11 ms including the shared mixer path;
		// the calibrated low D retains a longer natural attack. Allow that
		// recording variation, but reject a mechanical pre-roll like the old
		// pedal sample's extra 40 ms. The 50%/peak times remain diagnostics:
		// the bass body's natural growth is not an onset scheduling defect.
		expect.soft(hit.attack10Ms, `${label} should sound promptly after its scheduled onset`).toBeLessThanOrEqual(25);
	}
});
