import { test, expect } from './fixtures/test';
import { SEEDED_PROGRESS } from './fixtures/lick-practice-seeds';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

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
		await page.addInitScript(() => {
			// A tapped speaker bus drives two different physical paths into the same mic.
			let master: GainNode;
			let physicalMaster: GainNode;
			let speakerPaths: ChannelSplitterNode | undefined;
			const original = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (
				this: AudioNode,
				to: AudioNode | AudioParam,
				...args: number[]
			) {
				if (!speakerPaths && this instanceof GainNode && to instanceof AudioDestinationNode)
					master = this;
				// SAC can install its own silent gains at the destination. Tap the actual
				// output where the stereo calibration signal joins the listening mixer.
				if (
					speakerPaths &&
					this instanceof AudioBufferSourceNode &&
					this.buffer?.numberOfChannels === 2 &&
					to instanceof GainNode
				) {
					physicalMaster = to;
					physicalMaster.connect(speakerPaths);
					speakerPaths = undefined;
				}
				return (original as (...args: unknown[]) => AudioNode).call(this, to, ...args);
			} as typeof original;
			MediaDevices.prototype.getUserMedia = async () => {
				const ctx = master.context as AudioContext;
				const dest = ctx.createMediaStreamDestination();
				const split = ctx.createChannelSplitter(2);
				speakerPaths = split;
				for (const [ch, time] of [0.045, 0.073].entries()) {
					const delay = ctx.createDelay();
					delay.delayTime.value = time;
					const gain = ctx.createGain();
					gain.gain.value = 0.35;
					split.connect(delay, ch);
					delay.connect(gain);
					gain.connect(dest);
				}
				const controls = window as unknown as { startBand: () => void; playNote: () => void };
				function tone(hz: number, destination: AudioNode) {
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
					const noise = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate);
					let seed = 14893;
					for (let ch = 0; ch < 2; ch++) {
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
		});
		await page.goto('/settings');
		await page.getByRole('switch', { name: 'Speaker bleed reduction' }).click();
		await page.goto('/' + mode);
		if (mode === 'ear-training') await page.locator('[data-tour="play-button"]').click();
		else await page.getByRole('button', { name: /start daily practice/i }).click();
		await expect(page.getByText('Speaker bleed reduction active', { exact: true })).toBeVisible({
			timeout: 25_000
		});
		await page.evaluate(() => (window as unknown as { startBand: () => void }).startBand());
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
					function amplitude(buffer: AudioBuffer, hz: number) {
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
		}
	});

test('an unrelated microphone signal during calibration keeps original scoring available', async ({
	page,
	browserName
}) => {
	test.setTimeout(90_000);
	test.skip(browserName !== 'chromium', 'Uses native microphone recording in Chromium');
	await seedOnboardedAnonymous(page);
	await installAudioMock(page, { recordLiveGraph: true });
	await stubCdnInstrumentSamples(page);
	await page.goto('/settings');
	await page.getByRole('switch', { name: 'Speaker bleed reduction' }).click();
	await page.goto('/ear-training');
	await page.locator('[data-tour="play-button"]').click();
	await expect(page.getByText('Room check did not pass · scoring the original microphone')).toBeVisible({
		timeout: 20_000
	});
	await expect(page.getByText('Last take', { exact: true })).toBeVisible({ timeout: 45_000 });
});
