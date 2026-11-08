import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/** A one-second tone for the external libraries, with real decoding and synthesis. */
function audibleSample(): Buffer {
	const sampleRate = 44100;
	const frames = sampleRate;
	const wav = Buffer.alloc(44 + frames * 2);
	wav.write('RIFF');
	wav.writeUInt32LE(36 + frames * 2, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(frames * 2, 40);
	for (let i = 0; i < frames; i++) {
		wav.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
	}
	return wav;
}

for (const instrumentId of ['tenor-sax', 'soprano-sax'])
for (const brokenSamples of [false, true]) test(`ear-training sounds ${instrumentId} alongside the band (failed samples: ${brokenSamples})`, async ({ page, browserName }) => {
	// Opt in only in an isolated executor with a running virtual audio sink.
	// Firefox otherwise hangs in AudioContext.resume() on headless Linux.
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI && process.env.MANKUNKU_TEST_AUDIO_SINK !== '1', 'Headless Linux Firefox has no audio output device');
	test.setTimeout(60_000);
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, instrumentId, backingTrackEnabled: true, tonalityOverride: { key: 'C', scaleType: 'major' } },
		'tour-state': TOUR_DISMISSED
	});
	await installAudioMock(page);
	// Audible, deterministic stand-in for external libraries; the app still
	// loads its real sax samples unless this test exercises decode failure.
	await stubCdnInstrumentSamples(page, audibleSample());
	if (brokenSamples) {
		await page.route(`**/samples/${instrumentId}/**`, route => route.fulfill({ status: 200, body: 'invalid audio' }));
		// smplr silently retries missing buffers at /C4.ogg, losing the
		// original sample URL. Keep those failed decodes deterministic too.
		await page.route(/\/[A-G](?:%23|#|b)?\d\.ogg$/, route => route.fulfill({ status: 200, body: 'invalid audio' }));
	}
	await page.addInitScript(() => {
		const peaks = { melody: 0, backing: 0 };
		(window as unknown as { __audioPeaks: typeof peaks }).__audioPeaks = peaks;
		const probe = (node: AudioNode, kind: keyof typeof peaks) => {
			const analyser = node.context.createAnalyser();
			node.connect(analyser);
			const samples = new Float32Array(analyser.fftSize);
			setInterval(() => {
				analyser.getFloatTimeDomainData(samples);
				peaks[kind] = Math.max(peaks[kind], ...samples.map(Math.abs));
			}, 20);
		};
		const delay = BaseAudioContext.prototype.createDelay;
		BaseAudioContext.prototype.createDelay = function (...args) {
			const node = delay.apply(this, args);
			probe(node, 'melody');
			return node;
		};
		const compressor = BaseAudioContext.prototype.createDynamicsCompressor;
		BaseAudioContext.prototype.createDynamicsCompressor = function () {
			const node = compressor.call(this);
			probe(node, 'backing');
			return node;
		};
	});
	await page.goto('/ear-training', { waitUntil: 'networkidle' });
	await page.locator('[data-tour="play-button"]').click();
	const phase = page.locator('[data-tour="status-text"]');
	await expect(phase).toHaveAttribute('data-phase', 'listen', { timeout: 30_000 });
	await expect(phase).not.toHaveAttribute('data-phase', 'listen', { timeout: 30_000 });
	const peaks = await page.evaluate(() => (window as unknown as { __audioPeaks: { melody: number; backing: number } }).__audioPeaks);
	console.log('ear-training audio peaks', { instrumentId, brokenSamples, ...peaks });
	expect(peaks.backing, 'the backing must actually sound').toBeGreaterThan(0.001);
	expect(peaks.melody, 'the lick must actually sound, including after sample decode failure').toBeGreaterThan(0.001);
});
