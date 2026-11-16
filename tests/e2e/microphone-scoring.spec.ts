import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { SEEDED_PROGRESS } from './fixtures/lick-practice-seeds';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/** Real capture graph: master output must be audible in playback and absent from scoring. */
for (const mode of ['ear-training', 'lick-practice']) test(`${mode}: keeps microphone scoring audio separate from mixed playback`, async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI, 'Headless Linux Firefox has no audio device');
	test.setTimeout(90_000);
	await seedOnboardedAnonymous(page);
	if (mode === 'lick-practice') {
		await seedUserLicks(page);
		await seedStorage(page, {
			'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
			...SEEDED_PROGRESS
		});
	}
	// Linux WebKit has no native MediaRecorder. Keep the suite's playback
	// fixture there; the microphone worklet and master-bus probe stay real.
	await installAudioMock(page, { recordLiveGraph: browserName === 'chromium', fixturePath: '2026-09-18-blues-curl-up.wav' });
	await stubCdnInstrumentSamples(page);
	await page.addInitScript(() => {
		// Add a known low tone to the real master bus at recorder connection.
		// The synthetic microphone is independently a 440 Hz oscillator.
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...args: number[]) {
			if (destination instanceof MediaStreamAudioDestinationNode && this instanceof GainNode && this.gain.value !== Math.fround(0.4)) {
				const osc = this.context.createOscillator();
				const gain = this.context.createGain();
				osc.frequency.value = 110;
				gain.gain.value = 0.3;
				osc.connect(gain);
				gain.connect(this);
				osc.start();
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 4096;
				this.connect(analyser);
				const samples = new Float32Array(analyser.fftSize);
				const probe = window as unknown as { __masterBass: number };
				probe.__masterBass = 0;
				setInterval(() => {
					analyser.getFloatTimeDomainData(samples);
					let re = 0, im = 0;
					for (let i = 0; i < samples.length; i++) {
						const angle = 2 * Math.PI * 110 * i / analyser.context.sampleRate;
						re += samples[i] * Math.cos(angle);
						im += samples[i] * Math.sin(angle);
					}
					probe.__masterBass = Math.max(probe.__masterBass, (re * re + im * im) / samples.length ** 2);
				}, 50);
			}
			return (connect as (...args: unknown[]) => AudioNode).call(this, destination, ...args);
		} as typeof connect;
	});
	await page.goto(`/${mode}`, { waitUntil: 'networkidle' });
	if (mode === 'ear-training') await page.locator('[data-tour="play-button"]').click();
	else await page.getByRole('button', { name: /start daily practice/i }).click();
	const readTake = () => page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('mankunku-audio:anon', 1);
			req.onupgradeneeded = () => req.result.createObjectStore('recordings', { keyPath: 'sessionId' });
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		try {
			const row = await new Promise<{
				bytes: ArrayBuffer; scoringBytes?: ArrayBuffer;
				metadata?: { score?: unknown; scoringAudio?: string; scoreSource?: string; detectedNotes: { midi: number }[] };
			} | undefined>(resolve => {
				const req = db.transaction('recordings').objectStore('recordings').getAll();
				req.onsuccess = () => resolve(req.result[0]);
			});
			if (!row?.scoringBytes || !row.metadata?.score) return null;
			const ctx = new AudioContext();
			try {
				const mic = await ctx.decodeAudioData(row.scoringBytes.slice(0));
				const mix = await ctx.decodeAudioData(row.bytes.slice(0));
				/** Measure a tone in a steady section, excluding recorder edges. */
				const power = (buffer: AudioBuffer, hz: number) => {
					const samples = buffer.getChannelData(0);
					let re = 0, im = 0;
					const from = Math.floor(buffer.sampleRate * 0.5);
					const to = Math.min(samples.length, from + buffer.sampleRate);
					for (let i = from; i < to; i++) {
						const angle = 2 * Math.PI * hz * i / buffer.sampleRate;
						re += samples[i] * Math.cos(angle);
						im += samples[i] * Math.sin(angle);
					}
					return (re * re + im * im) / ((to - from) ** 2);
				};
				return { masterBass: (window as unknown as { __masterBass: number }).__masterBass, mixBytes: row.bytes.byteLength, micBass: power(mic, 110), micNote: power(mic, 440), mixBass: power(mix, 110), mixNote: power(mix, 440), source: row.metadata.scoringAudio, scoreSource: row.metadata.scoreSource, notes: row.metadata.detectedNotes.map((note: { midi: number }) => note.midi) };
			} finally { await ctx.close(); }
		} finally { db.close(); }
	});
	await expect.poll(readTake, { timeout: 60_000 }).not.toBeNull();
	// The score is revealed after replay but before its metadata write commits.
	// Poll the persisted source marker before asserting authoritative notes.
	if (mode === 'ear-training') {
		await expect(page.getByText('Last take', { exact: true })).toBeVisible();
		await expect.poll(async () => (await readTake())?.scoreSource).toBe('replay');
	}
	const take = (await readTake())!;
	expect(take.source).toBe('microphone');
	expect(take.micNote).toBeGreaterThan(0.01);
	expect(take.micBass / take.micNote).toBeLessThan(0.001);
	expect(take.mixBytes).toBeGreaterThan(0);
	expect(take.masterBass).toBeGreaterThan(0.005);
	if (browserName === 'chromium') {
		expect(take.mixNote).toBeGreaterThan(0.001);
		expect(take.mixBass / take.mixNote).toBeGreaterThan(0.02);
	}
	// Ear training's authoritative score must come from the mic as well.
	// Lick practice keeps its live scorer; a tone sustained across its window
	// boundary need not produce a new in-window onset on every engine.
	if (mode === 'ear-training') {
		expect(take.notes.length).toBeGreaterThan(0);
		expect(take.notes.every((midi: number) => midi === 69)).toBe(true);
	}
});

test('leaving during scoring preparation does not recreate detection resources', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI, 'Headless Linux Firefox has no audio device');
	await seedOnboardedAnonymous(page);
	await installAudioMock(page);
	await stubCdnInstrumentSamples(page);
	await page.addInitScript(() => {
		const probe = window as unknown as { __scoringPending: boolean; __releaseScoring: () => Promise<void>; __scoringSettled: boolean; __lateLevelTimers: number };
		probe.__scoringPending = false;
		probe.__scoringSettled = false;
		probe.__lateLevelTimers = 0;
		const addModule = AudioWorklet.prototype.addModule;
		AudioWorklet.prototype.addModule = async function (url, options) {
			const address = String(url);
			const source = address.startsWith('data:')
				? address.slice(0, address.indexOf(',')).includes(';base64')
					? atob(address.slice(address.indexOf(',') + 1)) : decodeURIComponent(address.slice(address.indexOf(',') + 1))
				: address;
			const scoring = source.includes('scoring-capture');
			if (scoring) {
				await new Promise<void>(resolve => {
					probe.__scoringPending = true;
					probe.__releaseScoring = async () => {
						const interval = window.setInterval;
						window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
							if (timeout === 50) probe.__lateLevelTimers++;
							return interval(handler, timeout, ...args);
						}) as typeof window.setInterval;
						resolve();
					};
				});
			}
			await addModule.call(this, url, options);
			if (scoring) probe.__scoringSettled = true;
		};
	});
	await page.goto('/ear-training', { waitUntil: 'networkidle' });
	await page.locator('[data-tour="play-button"]').click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { __scoringPending: boolean }).__scoringPending)).toBe(true);
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '/settings';
		link.textContent = 'Leave pending practice';
		document.querySelector('main')!.append(link);
	});
	await page.getByRole('link', { name: 'Leave pending practice' }).click();
	await expect(page).toHaveURL(/\/settings$/);
	await page.evaluate(() => (window as unknown as { __releaseScoring: () => Promise<void> }).__releaseScoring());
	await expect.poll(() => page.evaluate(() => (window as unknown as { __scoringSettled: boolean }).__scoringSettled)).toBe(true);
	// Let the resumed continuation and any mistakenly-created level timer run.
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (window as unknown as { __lateLevelTimers: number }).__lateLevelTimers)).toBe(0);
});
