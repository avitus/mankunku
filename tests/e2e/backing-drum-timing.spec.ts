import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';

test('shipped pedal hi-hat attacks with the ride and stick hi-hat in a dry WAV render', async ({ page, browserName }) => {
	test.setTimeout(90_000);
	await seedOnboardedAnonymous(page);
	// Only pitched CDN libraries are replaced. The local drum recordings,
	// shared decoder, sampler, mixer and public events-JSON render stay real.
	await stubCdnInstrumentSamples(page);
	await page.addInitScript(() => {
		const original = URL.createObjectURL.bind(URL);
		const blobs: Blob[] = [];
		Object.assign(window, { __drumTimingBlobs: blobs });
		URL.createObjectURL = ((blob: Blob) => {
			if (blob.type === 'audio/wav') blobs.push(blob);
			return original(blob);
		}) as typeof URL.createObjectURL;
	});
	await page.goto('/diagnostics/backing-mixer');
	await page.getByTestId('mix-room').fill('0');
	const hits = [
		{ drum: 'hihat-pedal', second: 1, velocity: 0.45 },
		{ drum: 'hihat', second: 3, velocity: 0.45 },
		{ drum: 'ride', second: 5, velocity: 0.5 }
	];
	// Put the longer ride tail last so it cannot obscure another attack.
	const events = { phraseId: 'shipped-drum-attack-alignment', tempo: 120,
		bassEvents: [], compEvents: [],
		drumEvents: hits.map(({ drum, second, velocity }) => ({ drum, velocity,
			time: `${second * 384}i`, absBeat: second * 2 })) };
	await page.locator('input[aria-label="Render WAV from events JSON"]').setInputFiles({
		name: 'drum-attack-alignment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(events))
	});
	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __drumTimingBlobs: Blob[] }).__drumTimingBlobs.length), { timeout: 60_000 }).toBe(1);
	const measurements = await page.evaluate(async (scheduledHits) => {
		const blob = (window as unknown as { __drumTimingBlobs: Blob[] }).__drumTimingBlobs[0];
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(await blob.arrayBuffer());
			return scheduledHits.map(({ drum, second }) => {
				const rms = Array.from({ length: 150 }, (_, millisecond) => {
					const start = Math.round((second + millisecond / 1000) * audio.sampleRate);
					const end = Math.round((second + (millisecond + 1) / 1000) * audio.sampleRate);
					let squares = 0;
					for (let channel = 0; channel < audio.numberOfChannels; channel++) {
						const samples = audio.getChannelData(channel);
						for (let frame = start; frame < end; frame++) squares += samples[frame] ** 2;
					}
					return Math.sqrt(squares / ((end - start) * audio.numberOfChannels));
				});
				const peakRms = Math.max(...rms);
				return { drum, peakRms, attackMs: rms.findIndex((value) => value >= peakRms * 0.1) };
			});
		} finally { await context.close(); }
	}, hits);
	console.log(`${browserName} shipped drum attacks: ${JSON.stringify(measurements)}`);
	await test.info().attach('drum-attack-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
	for (const measurement of measurements) {
		expect(measurement.peakRms, `${measurement.drum} must contain real audible sample energy`).toBeGreaterThan(0.001);
		expect(measurement.attackMs).toBeGreaterThanOrEqual(0);
	}
	const pedal = measurements.find((entry) => entry.drum === 'hihat-pedal')!;
	// Allow the shared mixer/codec delay without accepting the original 40 ms pre-roll.
	expect(pedal.attackMs, 'pedal chick should follow its scheduled onset promptly').toBeLessThan(20);
	for (const reference of measurements.filter((entry) => entry.drum !== 'hihat-pedal')) {
		expect(Math.abs(pedal.attackMs - reference.attackMs),
			`pedal attack ${pedal.attackMs}ms vs ${reference.drum} ${reference.attackMs}ms after their scheduled onsets`).toBeLessThanOrEqual(10);
	}
});
