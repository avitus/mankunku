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
