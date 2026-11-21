import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage, seedTunes, SAINTS_USER_TUNE } from './fixtures/storage';
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

const pendingSetupCases = [
	{ mode: 'ear-training', delayedStep: 'scoring' },
	{ mode: 'ear-training', delayedStep: 'permission' },
	{ mode: 'lick-practice', delayedStep: 'scoring' },
	{ mode: 'tune-practice', delayedStep: 'permission' },
	{ mode: 'tune-change', delayedStep: 'permission' }
] as const;
for (const { mode, delayedStep } of pendingSetupCases) test(`${mode}: stopping during ${delayedStep} preparation does not recreate detection resources`, async ({ page, browserName }) => {
	test.skip(browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI, 'Headless Linux Firefox has no audio device');
	await seedOnboardedAnonymous(page);
	if (mode === 'tune-change') await seedTunes(page, [SAINTS_USER_TUNE]);
	if (mode === 'lick-practice') {
		await seedUserLicks(page);
		await seedStorage(page, { 'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] }, ...SEEDED_PROGRESS });
	}
	await stubCdnInstrumentSamples(page);
	await page.addInitScript(delayedStep => {
		const probe = window as unknown as { __setupPending: boolean; __releaseSetup: () => Promise<void>; __setupSettled: boolean; __lateLevelTimers: number };
		probe.__setupPending = false;
		probe.__setupSettled = false;
		probe.__lateLevelTimers = 0;
		const hold = () => new Promise<void>(resolve => {
			probe.__setupPending = true;
			probe.__releaseSetup = async () => { resolve(); };
		});
		const addModule = AudioWorklet.prototype.addModule;
		AudioWorklet.prototype.addModule = async function (url, options) {
			const address = String(url);
			const source = address.startsWith('data:')
				? address.slice(0, address.indexOf(',')).includes(';base64')
					? atob(address.slice(address.indexOf(',') + 1)) : decodeURIComponent(address.slice(address.indexOf(',') + 1))
				: address;
			const scoring = source.includes('scoring-capture');
			if (scoring && delayedStep === 'scoring') await hold();
			await addModule.call(this, url, options);
			if (scoring && delayedStep === 'scoring') probe.__setupSettled = true;
		};
	}, delayedStep);
	// The stream probe and permission gate are installed atomically with the mock;
	// their behavior does not depend on this worklet init script's order.
	await installAudioMock(page, { trackMicrophoneStreams: true, delayMicrophonePermission: delayedStep === 'permission' });
	await page.goto(mode.startsWith('tune-') ? '/tunes/ls-mankunku-blues/practice' : `/${mode}`, { waitUntil: 'networkidle' });
	if (mode === 'ear-training') await page.locator('[data-tour="play-button"]').click();
	else if (mode.startsWith('tune-')) await page.getByRole('button', { name: /^start$/i }).click();
	else await page.getByRole('button', { name: /start daily practice/i }).click();
	await expect.poll(() => page.evaluate(step => step === 'permission'
		? (window as unknown as { __mockMicPending: boolean }).__mockMicPending
		: (window as unknown as { __setupPending: boolean }).__setupPending, delayedStep)).toBe(true);
	if (mode !== 'lick-practice') {
		const destination = mode === 'tune-change' ? '/tunes/e2e-when-the-saints/practice' : '/settings';
		await page.evaluate(destination => {
			const link = document.createElement('a');
			link.href = destination;
			link.textContent = 'Leave pending practice';
			document.querySelector('main')!.append(link);
		}, destination);
		await page.getByRole('link', { name: 'Leave pending practice' }).click();
		await expect(page).toHaveURL(new RegExp(`${destination}$`));
	} else {
		await page.getByRole('button', { name: 'End Session', exact: true }).click();
		await expect(page.getByRole('button', { name: 'End Session', exact: true })).toHaveCount(0);
	}
	// Observe both release paths before either pending continuation can resume.
	await page.evaluate(() => {
		const probe = window as unknown as { __lateLevelTimers: number };
		const interval = window.setInterval;
		window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
			if (timeout === 50) probe.__lateLevelTimers++;
			return interval(handler, timeout, ...args);
		}) as typeof window.setInterval;
	});
	if (delayedStep === 'permission') {
		await page.evaluate(() => (window as unknown as { __releaseMockMic: () => void }).__releaseMockMic());
	} else {
		await page.evaluate(() => (window as unknown as { __releaseSetup: () => Promise<void> }).__releaseSetup());
		await expect.poll(() => page.evaluate(() => (window as unknown as { __setupSettled: boolean }).__setupSettled)).toBe(true);
	}
	// Let the resumed continuation and any mistakenly-created level timer run.
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (window as unknown as { __lateLevelTimers: number }).__lateLevelTimers)).toBe(0);
	const states = await page.evaluate(() => (window as unknown as { __mockMicTracks: MediaStreamTrack[] }).__mockMicTracks.map(track => track.readyState));
	expect(states.length).toBeGreaterThan(0);
	expect(states.every(state => state === 'ended')).toBe(true);
	if (mode === 'lick-practice') await expect(page.locator('.report').first()).toBeVisible();
	if (mode === 'tune-change') await expect(page.getByRole('button', { name: /^start$/i })).toBeEnabled();
});
