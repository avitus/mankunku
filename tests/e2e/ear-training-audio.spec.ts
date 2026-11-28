import { observeListeningOutput } from './fixtures/listening-output';
import { test, expect } from './fixtures/test';
import { seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples, audibleSample } from './fixtures/audio';

for (const instrumentId of ['tenor-sax', 'soprano-sax'])
for (const sampleScenario of ['real', 'valid-wav', 'decode', 'stalled']) test(`ear-training sounds ${instrumentId} alongside the band (samples: ${sampleScenario})`, async ({ page, browserName }) => {
	// Opt in only in an isolated executor with a running virtual audio sink.
	// Firefox otherwise hangs in AudioContext.resume() on headless Linux.
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI && process.env.MANKUNKU_TEST_AUDIO_SINK !== '1', 'Headless Linux Firefox has no audio output device');
	test.setTimeout(60_000);
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, instrumentId, backingTrackEnabled: true, tonalityOverride: { key: 'C', scaleType: 'major' } },
		'tour-state': TOUR_DISMISSED
	});
	await installAudioMock(page);
	// Keep real-sample coverage, plus a codec-independent custom-loader success case.
	const wav = audibleSample();
	await stubCdnInstrumentSamples(page, wav);
	const fallbackRequests: string[] = [];
	page.on('request', request => {
		const url = new URL(request.url());
		if (url.hostname === 'gleitz.github.io' && url.pathname.includes(instrumentId.replace('-', '_'))) {
			fallbackRequests.push(request.url());
		}
	});
	let customSampleRequests = 0;
	if (sampleScenario === 'valid-wav') {
		await page.route(`**/samples/${instrumentId}/**`, route => {
			customSampleRequests++;
			return route.fulfill({ contentType: 'audio/wav', body: wav });
		});
	} else if (sampleScenario === 'stalled') {
		// Leave requests pending: the app must time out and use the SoundFont.
		await page.route(`**/samples/${instrumentId}/**`, () => {});
	} else if (sampleScenario === 'decode') {
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
	console.log('ear-training audio peaks', { instrumentId, sampleScenario, ...peaks });
	if (sampleScenario === 'valid-wav') {
		expect(customSampleRequests, 'the custom sampler must request its buffers').toBeGreaterThan(0);
		expect(fallbackRequests, 'valid custom samples must not load the sax SoundFont').toEqual([]);
	} else if (sampleScenario === 'decode' || sampleScenario === 'stalled') {
		expect(fallbackRequests, 'failed custom samples must load the sax SoundFont').not.toEqual([]);
	}
	expect(peaks.backing, 'the backing must actually sound').toBeGreaterThan(0.001);
	expect(peaks.melody, 'the lick must actually sound, including after sample decode failure').toBeGreaterThan(0.001);
});

for (const [instrumentId, bank] of [
	['piano', 'splendid-grand-piano'], ['bass', 'dsmolken-double-bass'], ['guitar', 'electric_guitar_jazz']
]) test(`Concert Pitch ${instrumentId} sounds with accompaniment muted`, async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI && process.env.MANKUNKU_TEST_AUDIO_SINK !== '1', 'Headless Linux Firefox has no audio output device');
	test.setTimeout(60_000);
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, instrumentId, metronomeEnabled: false, metronomeVolume: 0,
			backingTrackEnabled: false, backingTrackVolume: 0 },
		'tour-state': TOUR_DISMISSED
	});
	await installAudioMock(page);
	await observeListeningOutput(page);
	await stubCdnInstrumentSamples(page, audibleSample());
	if (instrumentId === 'bass') {
		await page.route('**/d_smolken_rubner_bass_pizz.sfz', route => route.fulfill({
			path: 'tests/fixtures/audio/smolken-pizzicato.sfz', contentType: 'text/plain',
			headers: { 'access-control-allow-origin': '*' }
		}));
	}
	await page.goto('/ear-training', { waitUntil: 'networkidle' });
	const request = page.waitForRequest(req => req.url().includes(bank));
	await page.locator('[data-tour="play-button"]').click();
	await request;
	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __listeningOutput: { peak: number } }).__listeningOutput.peak
	), { timeout: 30_000 }).toBeGreaterThan(0.001);
});

test('Progress replays an ear-training lick on the selected vibraphone', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI && process.env.MANKUNKU_TEST_AUDIO_SINK !== '1', 'Headless Linux Firefox has no audio output device');
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, instrumentId: 'vibraphone' },
		'tour-state': TOUR_DISMISSED,
		progress: { sessions: [{
			id: 'replay', phraseId: 'pfl-035', phraseName: 'Third Walks Back to Root',
			timestamp: Date.now(), key: 'C', category: 'pentatonic', tempo: 100,
			difficultyLevel: 1, source: 'ear-training', grade: 'good', overall: 0.8,
			pitchAccuracy: 0.8, rhythmAccuracy: 0.8, noteResults: []
		}] }
	});
	await observeListeningOutput(page);
	await stubCdnInstrumentSamples(page, audibleSample());
	await page.goto('/progress');
	await page.getByRole('tab', { name: 'Sessions', exact: true }).click();
	await page.getByRole('button', { name: /Third Walks Back to Root/ }).click();
	const [request] = await Promise.all([
		page.waitForRequest(req => /MusyngKite\/.*-(ogg|mp3)\.js$/.test(req.url())),
		page.getByRole('button', { name: 'Play Lick', exact: true }).click()
	]);
	expect(request.url()).toMatch(/\/vibraphone-(ogg|mp3)\.js$/);
	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __listeningOutput: { peak: number } }).__listeningOutput.peak
	), { timeout: 15_000 }).toBeGreaterThan(0.001);
});
