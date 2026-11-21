import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test';
import { SEEDED_PROGRESS } from './fixtures/lick-practice-seeds';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage, SETTINGS_ONBOARDED, TOUR_DISMISSED } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

/** Count actual starts of the stereo calibration signal across page loads. */
async function countSoundChecks(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer?.numberOfChannels === 2 && Math.abs(this.buffer.duration - 5.6) < 0.001) {
				sessionStorage.setItem('probeCount', String(Number(sessionStorage.getItem('probeCount')) + 1));
				this.addEventListener('ended', () => sessionStorage.setItem('probeEnded', 'true'), { once: true });
			}
			return start.apply(this, args);
		};
	});
}

test('Play with backing and no calibration starts the phrase on both attempts without a sound check', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Measures the native speaker graph in Chromium');
	test.setTimeout(90_000);
	await seedStorage(page, {
		settings: { ...SETTINGS_ONBOARDED, backingTrackEnabled: true },
		'tour-state': TOUR_DISMISSED
	});
	await installAudioMock(page, {recordLiveGraph: true});
	await stubCdnInstrumentSamples(page);
	await countSoundChecks(page);
	await page.goto('/ear-training');
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.getByRole('button', {name: 'Start practice'}).click();
		await expect(page.locator('[data-phase="listen"]')).toBeVisible({timeout: 30_000});
		expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBeNull();
		await page.getByRole('button', {name: 'Pause practice'}).click();
	}
});

for (const mode of ['ear-training', 'lick-practice'])
	test(`${mode} subtracts the stereo room return while preserving the played tone`, async ({
		page,
		browserName
	}) => {
		test.skip(
			browserName !== 'chromium',
			'Measures the native recording and scoring branches in Chromium'
		);
		test.setTimeout(100_000);
		await seedOnboardedAnonymous(page);
		await countSoundChecks(page);
		if (mode === 'lick-practice') {
			await seedUserLicks(page);
			const progress = structuredClone(SEEDED_PROGRESS);
			progress['lick-practice-progress']['e2e-user-lick-bebop'].C.currentTempo = 100;
			await seedStorage(page, {
				'user-lick-tags': { 'e2e-user-lick-bebop': ['practice', 'prog:ii-V-I-major'] },
				...progress
			});
		}
		await stubCdnInstrumentSamples(page);
		await page.addInitScript(
			(channels) => {
				// A tapped speaker bus drives two different physical paths into the same mic.
				let master: GainNode;
				let physicalMaster: GainNode;
				let speakerPaths: GainNode | undefined;
				const original = AudioNode.prototype.connect;
				AudioNode.prototype.connect = function (
					this: AudioNode,
					to: AudioNode | AudioParam,
					...args: number[]
				) {
					if (!speakerPaths && this instanceof GainNode && to instanceof AudioDestinationNode)
						master = this;
					// Connect the simulated speakers at the explicit stereo reference tap.
					// This is present even when a saved model skips the calibration sound.
					if (speakerPaths && this instanceof GainNode && to instanceof GainNode &&
						to.channelCount === 2 && to.channelCountMode === 'explicit') {
						physicalMaster = this;
						const paths = speakerPaths;
						speakerPaths = undefined;
						physicalMaster.connect(paths);
					}
					return (original as (...args: unknown[]) => AudioNode).call(this, to, ...args);
				} as typeof original;
				MediaDevices.prototype.getUserMedia = async () => {
					const ctx = master.context as AudioContext;
					const dest = ctx.createMediaStreamDestination();
					const track = dest.stream.getAudioTracks()[0];
					Object.defineProperty(track, 'label', { value: 'Test room mic' });
					const trackSettings = track.getSettings();
					track.getSettings = () => ({...trackSettings, deviceId: sessionStorage.getItem('micId') ?? 'test-mic', groupId: 'test-group'});
					const split = ctx.createChannelSplitter(2);
					speakerPaths = ctx.createGain();
					speakerPaths.channelCountMode = 'explicit';
					speakerPaths.channelCount = 2;
					speakerPaths.connect(split);
					for (const [ch, time] of [0.045, 0.073].entries()) {
						const delay = ctx.createDelay();
						delay.delayTime.value = time + (sessionStorage.getItem('moved') ? 0.15 : 0);
						const gain = ctx.createGain();
						gain.gain.value = 0.35;
						split.connect(delay, ch);
						delay.connect(gain);
						gain.connect(dest);
					}
					const controls = window as unknown as { startBand: () => void; playNote: () => void };
					function tone(hz: number, destination: AudioNode): void {
						const osc = ctx.createOscillator(),
							gain = ctx.createGain();
						osc.frequency.value = hz;
						gain.gain.value = 0.12;
						osc.connect(gain);
						gain.connect(destination);
						osc.start();
					}
					controls.startBand = () => {
						// Give the Listen check both timing information and a measurable backing pitch.
						const noise = ctx.createBuffer(channels, ctx.sampleRate, ctx.sampleRate);
						let seed = 14893;
						for (let ch = 0; ch < channels; ch++) {
							const samples = noise.getChannelData(ch);
							for (let i = 0; i < samples.length; i++) {
								seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
								samples[i] = 0.075 * (seed / 2147483648 - 1);
							}
						}
						const source = ctx.createBufferSource();
						source.buffer = noise;
						source.loop = true;
						source.connect(physicalMaster);
						source.start();
						tone(173, physicalMaster);
					};
					controls.playNote = () => tone(440, dest);
					return dest.stream;
				};
			},
			mode === 'ear-training' ? 1 : 2
		);
		await page.goto('/settings');
		await page.getByRole('switch', { name: 'Backing track', exact: true }).click();
		const startCheck = page.getByRole('button', { name: 'Start speaker sound check' });
		await expect(startCheck).toHaveAccessibleDescription(/six seconds of hiss/);
		expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBeNull();
		await startCheck.click();
		await expect(page.getByText('Speaker calibration saved on this device.')).toBeVisible({timeout: 20_000});
		await page.goto('/' + mode);
		if (mode === 'ear-training') await page.locator('[data-tour="play-button"]').click();
		else await page.getByRole('button', { name: /start daily practice/i }).click();
		await expect(page.getByText('Using original microphone until Listen verifies saved calibration')).toBeVisible();
		await page.evaluate(() => (window as unknown as { startBand: () => void }).startBand());
		await expect(page.getByText('Speaker bleed reduction active', { exact: true })).toBeVisible({timeout: 25_000});
		expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBe('1');
		await expect(
			page
				.locator(mode === 'ear-training' ? '[data-phase="play"]' : '.row.current .chart-wrap.recording')
				.first()
		).toBeVisible({ timeout: 35_000 });
		await page.evaluate(() => (window as unknown as { playNote: () => void }).playNote());
		const take = () =>
			page.evaluate(async (mode) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('mankunku-audio:anon', 1);
					request.onupgradeneeded = () =>
						request.result.createObjectStore('recordings', { keyPath: 'sessionId' });
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				const rows = await new Promise<
					{ bytes: ArrayBuffer; scoringBytes?: ArrayBuffer; metadata?: { scoreSource?: string } }[]
				>((resolve) => {
					const request = db.transaction('recordings').objectStore('recordings').getAll();
					request.onsuccess = () => resolve(request.result);
				});
				db.close();
				const row = rows.find(
					(r) => r.scoringBytes && (mode === 'lick-practice' || r.metadata?.scoreSource === 'replay')
				);
				if (!row) return null;
				const ctx = new AudioContext();
				try {
					const score = await ctx.decodeAudioData(row.scoringBytes!.slice(0));
					const mix = await ctx.decodeAudioData(row.bytes.slice(0));
					function amplitude(buffer: AudioBuffer, hz: number): number {
						const x = buffer.getChannelData(0),
							from = Math.round(0.5 * buffer.sampleRate);
						const to = Math.min(from + buffer.sampleRate, x.length);
						let re = 0,
							im = 0;
						for (let i = from; i < to; i++) {
							const phi = (2 * Math.PI * hz * i) / buffer.sampleRate;
							re += x[i] * Math.cos(phi);
							im += x[i] * Math.sin(phi);
						}
						return (2 * Math.hypot(re, im)) / (to - from);
					}
					return {
						sax: amplitude(score, 440),
						bleed: amplitude(score, 173),
						mixedSax: amplitude(mix, 440),
						mixedBleed: amplitude(mix, 173)
					};
				} finally {
					await ctx.close();
				}
			}, mode);
		await expect.poll(take, { timeout: 55_000 }).not.toBeNull();
		const result = (await take())!;
		expect(result.sax).toBeCloseTo(0.12, 1);
		expect(result.mixedSax).toBeGreaterThan(0.015);
		expect(result.mixedBleed).toBeGreaterThan(0.008);
		expect(result.bleed).toBeLessThan(0.015);
		if (mode === 'ear-training') {
			await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));

			await expect(
				page.getByText('Room check unavailable · scoring the original microphone')
			).toBeVisible();
			await page.evaluate(() => sessionStorage.setItem('moved', 'true'));
			await page.reload();
			await page.locator('[data-tour="play-button"]').click();
			await expect(page.getByText('Using original microphone until Listen verifies saved calibration')).toBeVisible();
			await page.evaluate(() => (window as unknown as { startBand: () => void }).startBand());
			await expect(page.getByText('Saved speaker check did not pass · scoring the original microphone')).toBeVisible({timeout: 25_000});
			expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBe('1');
			await page.goto('/settings');
			await startCheck.click();
			await expect(page.getByText('Speaker calibration saved on this device.')).toBeVisible({timeout: 20_000});
			expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBe('2');
			await page.evaluate(() => sessionStorage.setItem('micId', 'new-microphone'));
			await page.goto('/ear-training');
			await page.getByRole('button', { name: 'Start practice' }).click();
			await expect(page.getByText('Using original microphone · calibrate speakers in Settings')).toBeVisible();
			await expect(page.locator('[data-phase="listen"]')).toBeVisible({ timeout: 30_000 });
			expect(await page.evaluate(() => sessionStorage.getItem('probeCount'))).toBe('2');
		}
	});

for (const failure of ['unrelated microphone', 'stalled worklet'])
	test(`${failure}: can stop the sound check, retry and score the original microphone`, async ({
		page,
		browserName
	}) => {
		test.setTimeout(90_000);
		test.skip(browserName !== 'chromium', 'Uses native microphone recording in Chromium');
		await seedOnboardedAnonymous(page);
		await installAudioMock(page, { recordLiveGraph: true, trackMicrophoneStreams: true });
		// A synthetic destination gets a new device identity on each page. Model
		// the same physical microphone when checking a stored rejection.
		await page.addInitScript(() => {
			const getSettings = MediaStreamTrack.prototype.getSettings;
			MediaStreamTrack.prototype.getSettings = function () {
				return { ...getSettings.call(this), deviceId: 'practice-room-mic' };
			};
			Object.defineProperty(MediaStreamTrack.prototype, 'label', { get: () => 'Practice room mic' });
		});
		await countSoundChecks(page);
		if (failure === 'stalled worklet') {
			await page.addInitScript(() => {
				const addModule = AudioWorklet.prototype.addModule;
				AudioWorklet.prototype.addModule = function (url, options) {
					const address = String(url);
					const comma = address.indexOf(',');
					const source = address.startsWith('data:')
						? address.slice(0, comma).includes(';base64')
							? atob(address.slice(comma + 1))
							: decodeURIComponent(address.slice(comma + 1))
						: address;
					if (source.includes('room-calibration')) return new Promise<void>(() => {});
					return addModule.call(this, url, options);
				};
			});
		}
		await stubCdnInstrumentSamples(page);
		await page.goto('/settings');
		await page.getByRole('switch', { name: 'Speaker bleed reduction' }).click();
		const startCheck = page.getByRole('button', { name: 'Start speaker sound check' });
		const trackState = () => page.evaluate(() =>
			(window as unknown as { __mockMicTracks: MediaStreamTrack[] }).__mockMicTracks[0]?.readyState);
		await startCheck.click();
		await expect.poll(trackState).toBe('live');
		if (failure === 'unrelated microphone') {
			await expect.poll(() => page.evaluate(() => sessionStorage.getItem('probeCount'))).toBe('1');
		}
		await page.getByRole('button', { name: 'Stop sound check' }).click();
		if (failure === 'unrelated microphone') {
			await expect.poll(() => page.evaluate(() => sessionStorage.getItem('probeEnded')), { timeout: 1500 }).toBe('true');
		}
		await expect.poll(trackState).toBe('ended');
		await expect(page.getByText('Sound check stopped.')).toBeVisible();
		await startCheck.click();
		const stalled = failure === 'stalled worklet';
		await expect(page.getByText(stalled ? 'Calibration unavailable. You can retry here.' :
			'No reliable speaker return. Practice will use the original microphone.')).toBeVisible({ timeout: 20_000 });
		await page.goto('/ear-training');
		await page.getByRole('button', { name: 'Start practice' }).click();
		await expect(page.getByText(stalled ? 'Using original microphone · calibrate speakers in Settings' :
			'Room check did not pass · scoring the original microphone')).toBeVisible();
		await expect(page.getByText('Last take', { exact: true })).toBeVisible({ timeout: 45_000 });
	});

test('turning backing off releases the calibration microphone; a completed negative check is remembered', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Uses native microphone recording in Chromium');
	test.setTimeout(45_000);
	await seedOnboardedAnonymous(page);
	await installAudioMock(page, {recordLiveGraph: true, trackMicrophoneStreams: true});
	await page.goto('/settings');
	const backing = page.getByRole('switch', {name: 'Backing track', exact: true});
	const tracks = () => page.evaluate(() =>
		(window as unknown as {__mockMicTracks: MediaStreamTrack[]}).__mockMicTracks.map(track => track.readyState));
	await backing.click();
	expect(await tracks()).toEqual([]);
	const startCheck = page.getByRole('button', { name: 'Start speaker sound check' });
	await startCheck.click();
	await expect.poll(tracks).toEqual(['live']);
	await backing.click();
	await expect.poll(tracks).toEqual(['ended']);
	await backing.click();
	await startCheck.click();
	await expect(page.getByText('No reliable speaker return. Practice will use the original microphone.')).toBeVisible({timeout: 20_000});
	await expect.poll(tracks).toEqual(['ended', 'ended']);
	await backing.click();
	await backing.click();
	await expect(startCheck).toBeEnabled();
	expect(await tracks()).toEqual(['ended', 'ended']);
});
