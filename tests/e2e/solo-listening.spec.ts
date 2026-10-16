import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { SoloObservationWindow } from '../../src/lib/audio/solo-observer';
import type { GeneratedBacking } from '../../src/lib/audio/backing-generation';

/** A real silent stream with explicit ownership counters; never asks the OS for a mic. */
async function microphone(page: Page, delayed = false) {
	await page.addInitScript((delay) => {
		// Keep wrappers reachable: WebKit may otherwise collect per-track method
		// overrides and re-create a native wrapper when getTracks() is called later.
		const state = { calls: 0, stopped: 0, release: () => {}, tracks: [] as MediaStreamTrack[] };
		Object.assign(window, { __soloMic: state });
		MediaDevices.prototype.getUserMedia = async () => {
			state.calls++;
			if (delay) await new Promise<void>((resolve) => { state.release = resolve; });
			const context = new AudioContext();
			await context.resume();
			const source = context.createOscillator();
			const gain = context.createGain();
			gain.gain.value = 0;
			const destination = context.createMediaStreamDestination();
			source.connect(gain).connect(destination);
			source.start();
			for (const track of destination.stream.getTracks()) {
				state.tracks.push(track);
				const stop = track.stop.bind(track);
				track.stop = () => { state.stopped++; stop(); source.stop(); void context.close(); };
			}
			return destination.stream;
		};
	}, delayed);
}

const micState = (page: Page) => page.evaluate(() => {
	const state = (window as unknown as { __soloMic: { calls: number; stopped: number } }).__soloMic;
	return { calls: state.calls, stopped: state.stopped };
});

async function setup(page: Page, delayed = false) {
	await seedOnboardedAnonymous(page);
	await microphone(page, delayed);
	await stubCdnInstrumentSamples(page);
	await page.goto('/diagnostics/backing-mixer');
	await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('swing');
	await page.getByRole('button', { name: '240', exact: true }).click();
}

test('microphone is explicit; a finite take exports causal replay evidence and parameter changes clear it', async ({ page }) => {
	await setup(page);
	expect(await micState(page)).toEqual({ calls: 0, stopped: 0 });
	await expect(page.getByTestId('lab-listen')).toBeVisible();
	await expect(page.getByTestId('lab-replay-observations')).toBeDisabled();
	await page.getByTestId('lab-listen').click();
	await expect(page.getByTestId('lab-observation-status')).toContainText('Pass complete', { timeout: 20_000 });
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
	await expect(page.getByTestId('lab-replay-observations')).toBeEnabled();
	await page.getByTestId('lab-replay-observations').click();
	await expect(page.getByTestId('lab-ensemble-scope')).toContainText('Recorded microphone observations');
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export events JSON' }).click();
	const file = await pending;
	const data = JSON.parse(await readFile((await file.path())!, 'utf8')) as GeneratedBacking & {
		soloScenario: string;
		soloFeatures: { source: string; barIndex: number; observedAtBar: number }[];
		soloObservationTrace: { sessionId: string; phraseId: string; tempo: number; windows: SoloObservationWindow[] };
	};
	expect(data.soloScenario).toBe('microphone-replay');
	expect(data.soloObservationTrace.tempo).toBe(240);
	expect(data.soloObservationTrace.windows).toHaveLength(4);
	expect(data.soloObservationTrace.windows.every((window) => window.sessionId === data.soloObservationTrace.sessionId)).toBe(true);
	expect(data.soloFeatures.length).toBeGreaterThan(0);
	for (const window of data.soloObservationTrace.windows) {
		if (!window.feature) continue;
		expect(window.feature.source).toBe('microphone');
		expect(window.feature.barIndex).toBeGreaterThanOrEqual(Math.ceil(window.availableAtSeconds)); // 240 BPM: one second per bar
		expect(window.feature.barIndex).toBeGreaterThan(window.barIndex);
	}
	expect(data.ensemblePlan?.trace.some((bar) => bar.soloEvidence === 'resting')).toBe(true);
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 }); // replay never reopens input
	await page.getByTestId('lab-seed').fill('3');
	await page.getByTestId('lab-seed').blur();
	await expect(page.getByTestId('lab-replay-observations')).toBeDisabled();
	await expect(page.getByTestId('lab-observation-status')).toContainText('No captured observations');
});

test('cancelled microphone permission cannot start a late pass', async ({ page }) => {
	await setup(page, true);
	await page.getByTestId('lab-listen').click();
	await expect.poll(async () => (await micState(page)).calls).toBe(1);
	await page.getByTestId('lab-listen').click();
	await page.evaluate(() => (window as unknown as { __soloMic: { release(): void } }).__soloMic.release());
	await expect.poll(async () => (await micState(page)).stopped).toBe(1);
	await expect(page.getByRole('button', { name: 'Play loop', exact: true })).toBeEnabled();
	await expect(page.getByTestId('lab-replay-observations')).toBeDisabled();
});

test('navigation releases microphone permission that resolves after teardown', async ({ page }) => {
	await setup(page, true);
	await page.getByTestId('lab-listen').click();
	await expect.poll(async () => (await micState(page)).calls).toBe(1);
	await page.getByRole('link', { name: 'Musicality specification & progress' }).click();
	await expect(page).toHaveURL(/\/musicality$/);
	await page.evaluate(() => (window as unknown as { __soloMic: { release(): void } }).__soloMic.release());
	await expect.poll(async () => (await micState(page)).stopped).toBe(1);
});

test('rolling microphone take changes later decisions and exports the committed playback', async ({ page }) => {
	await setup(page);
	await page.getByTestId('lab-preset').selectOption('lab-blues-f');
	await page.getByTestId('lab-adapt').click({ timeout: 5000 });
	await expect(page.getByTestId('lab-ensemble-scope')).toContainText('upcoming bars');
	await expect(page.getByTestId('lab-observation-status')).toContainText('Adaptive pass complete', { timeout: 30_000 });
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export events JSON' }).click();
	const file = await pending;
	const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
	expect(data.soloScenario).toBe('microphone-rolling');
	expect(data.rollingTake.session.status).toBe('complete');
	expect(data.rollingTake.playback.windows).toHaveLength(12);
	expect(data.rollingTake.session.receipts.length).toBeGreaterThan(0);
	expect(data.ensemblePlan.trace.slice(0, 2).every((bar: { soloEvidence: string }) => bar.soloEvidence === 'unavailable')).toBe(true);
	expect(data.ensemblePlan.trace.slice(2).some((bar: { soloEvidence: string }) => bar.soloEvidence === 'resting')).toBe(true);
	expect(data.bassEvents).toEqual(data.rollingTake.playback.generated.bassEvents);
	expect(data.compEvents).toEqual(data.rollingTake.playback.generated.compEvents);
	expect(data.drumEvents).toEqual(data.rollingTake.playback.generated.drumEvents);
	for (const receipt of data.rollingTake.session.receipts) {
		expect(receipt.receivedAtSeconds).toBeGreaterThanOrEqual(receipt.availableAtSeconds - 0.01);
		expect(receipt.nextBarAtReceipt).toBeGreaterThan(receipt.windowBar);
	}
	await page.getByTestId('lab-seed').fill('4'); await page.getByTestId('lab-seed').blur();
	await expect(page.getByTestId('lab-observation-status')).toContainText('No captured observations');
});

test('cross-loop adaptation keeps the microphone, chronology, replay and full bounce across three loops', async ({ page }) => {
	test.setTimeout(60_000);
	await setup(page);
	await page.getByTestId('lab-adaptive-loops').selectOption('3', { timeout: 3000 });
	await page.getByTestId('lab-adapt-loops').click();
	await expect(page.getByTestId('lab-observation-status')).toContainText('Loop 2 of 3', { timeout: 15_000 });
	expect(await micState(page)).toEqual({ calls: 1, stopped: 0 });
	await expect(page.getByTestId('lab-observation-status')).toContainText('Adaptive loops complete', { timeout: 20_000 });
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
	const exported = async () => {
		const pending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export events JSON' }).click();
		return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
	};
	const data = await exported();
	expect(data.soloScenario).toBe('microphone-rolling-loops');
	expect(data.rollingTake.definition.loopCount).toBe(3);
	expect(data.performanceForm.totalBars).toBe(12);
	expect(data.soloObservationTrace.windows).toHaveLength(12);
	expect(data.rollingTake.playback.windows).toHaveLength(12);
	for (let bar = 0; bar < 12; bar++) {
		const window = data.rollingTake.playback.windows[bar];
		expect(window.fromBar).toBe(bar);
		expect(window.loopIndex).toBe(Math.floor(bar / 4));
		expect(window.sourceBarIndex).toBe(bar % 4);
		if (bar) expect(window.previousCheckpointId).toBe(data.rollingTake.playback.windows[bar - 1].checkpoint.checkpointId);
	}
	expect(data.ensemblePlan.trace.slice(4).some((bar: { soloEvidence: string }) => bar.soloEvidence === 'resting')).toBe(true);
	expect(data.rollingTake.playback.dispatches.every((entry: { status: string }) => entry.status === 'played')).toBe(true);
	expect(data.bassEvents).toEqual(data.rollingTake.playback.generated.bassEvents);
	await page.getByTestId('lab-bounce').click();
	const wav = page.getByRole('link', { name: /^Download .*\.wav$/ });
	await expect(wav).toBeVisible({ timeout: 20_000 });
	const duration = await wav.evaluate(async (link: HTMLAnchorElement) => {
		const bytes = new DataView(await (await fetch(link.href)).arrayBuffer());
		return bytes.getUint32(40, true) / bytes.getUint32(28, true);
	});
	expect(duration).toBeCloseTo(14.5, 1); // all twelve one-second bars plus the room tail
	await page.getByTestId('lab-replay-observations').click();
	const replay = await exported();
	expect(replay.soloScenario).toBe('microphone-replay');
	expect(replay.performanceForm.totalBars).toBe(12);
	expect(replay.ensemblePlan.bars).toHaveLength(12);
	expect(replay.bassEvents.some((event: { absBeat: number }) => event.absBeat >= 32)).toBe(true);
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
});

test('stopping in the second adaptive loop releases input and retains an honest partial export', async ({ page }) => {
	await setup(page);
	await page.getByTestId('lab-adapt-loops').click();
	await expect(page.getByTestId('lab-observation-status')).toContainText('Loop 2 of 2', { timeout: 15_000 });
	await page.getByTestId('lab-adapt-loops').click();
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
	await expect(page.getByTestId('lab-bounce')).toBeDisabled();
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export events JSON' }).click();
	const data = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
	expect(data.rollingTake.session.status).toBe('stopped');
	expect(data.rollingTake.session.nextBar).toBeGreaterThan(4);
	expect(data.rollingTake.session.nextBar).toBeLessThan(8);
	await page.getByRole('button', { name: 'Play loop', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	expect(await micState(page)).toEqual({ calls: 1, stopped: 1 });
});

for (const loopCount of [1, 2]) test(`cancelled rolling permission (${loopCount} loops) cannot resume after a new loop starts`, async ({ page }) => {
	await setup(page, true);
	const button = page.getByTestId(loopCount === 1 ? 'lab-adapt' : 'lab-adapt-loops');
	await button.click();
	await expect.poll(async () => (await micState(page)).calls).toBe(1);
	await button.click();
	await page.getByRole('button', { name: 'Play loop', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	await page.evaluate(() => (window as unknown as { __soloMic: { release(): void } }).__soloMic.release());
	await expect.poll(async () => (await micState(page)).stopped).toBe(1);
	await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	await expect(page.getByTestId('lab-replay-observations')).toBeDisabled();
});

for (const loopCount of [1, 3]) test(`rolling adaptive playback (${loopCount} loops) produces live audio throughout its committed form`, async ({ page, browserName }) => {
	test.skip(!!process.env.CI || browserName === 'firefox', 'local Chromium/WebKit diagnostic with real CDN samples');
	test.setTimeout(180_000);
	await seedOnboardedAnonymous(page);
	await microphone(page);
	await page.addInitScript(() => {
		const readings: { time: number; rms: number }[] = [];
		const taps: { context: BaseAudioContext; analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer> }[] = [];
		Object.assign(window, { __rollingAudio: { readings, taps } });
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
			if (destination instanceof AudioDestinationNode) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 1024;
				Reflect.apply(connect, this, [analyser, 0, 0]);
				taps.push({ context: this.context, analyser, buffer: new Float32Array(1024) });
			}
			if (destination instanceof AudioParam) return Reflect.apply(connect, this, [destination, output ?? 0]);
			return Reflect.apply(connect, this, [destination, output ?? 0, input ?? 0]);
		} as typeof AudioNode.prototype.connect;
		setInterval(() => {
			for (const { context, analyser, buffer } of taps) {
				analyser.getFloatTimeDomainData(buffer);
				readings.push({ time: context.currentTime, rms: Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length) });
			}
		}, 40);
	});
	await page.goto('/diagnostics/backing-mixer');
	await page.getByRole('combobox', { name: 'Style', exact: true }).selectOption('swing');
	await page.getByRole('button', { name: '160', exact: true }).click();
	if (loopCount > 1) await page.getByTestId('lab-adaptive-loops').selectOption(String(loopCount));
	await page.getByTestId(loopCount === 1 ? 'lab-adapt' : 'lab-adapt-loops').click();
	await expect(page.getByTestId('lab-observation-status')).toContainText(loopCount === 1 ? 'Adaptive pass complete' : 'Adaptive loops complete', { timeout: 120_000 });
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export events JSON' }).click();
	const file = await pending;
	const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
	const signal = await page.evaluate(({ start, duration }) => {
		const readings = (window as unknown as { __rollingAudio: { readings: { time: number; rms: number }[] } }).__rollingAudio.readings;
		return Array.from({ length: Math.floor(duration / 0.5) }, (_, bucket) => Math.max(0, ...readings
			.filter((item) => item.time >= start + bucket * 0.5 && item.time < start + (bucket + 1) * 0.5).map((item) => item.rms)));
	}, { start: data.rollingTake.startAudioTime, duration: 6 * loopCount });
	expect(data.rollingTake.playback.dispatches.every((entry: { status: string }) => entry.status === 'played')).toBe(true);
	expect(signal.filter((rms) => rms > 0.001).length / signal.length, `live output RMS buckets: ${signal}`).toBeGreaterThan(0.8);
	expect(signal.slice(-3).every((rms) => rms > 0.001)).toBe(true);
	for (let loop = 1; loop < loopCount; loop++) {
		expect(signal.slice(loop * 12 - 1, loop * 12 + 2).every((rms) => rms > 0.001), `audio around loop seam ${loop}`).toBe(true);
	}
	console.log(`${browserName} rolling live RMS (${loopCount} loops): ${signal.map((rms) => rms.toFixed(4)).join(', ')}`);
});
