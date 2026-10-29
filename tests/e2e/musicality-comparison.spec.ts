import type { Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import type { BlindListeningComparisonRecord } from '../../src/lib/musicality/listening-comparison';

const criteria = ['groove', 'harmonicClarity', 'space', 'interaction', 'development', 'formArrivals', 'fatigue'];
const archiveKey = 'mankunku:musicality-blind-listening-reviews:v1';

async function setup(page: Page): Promise<void> {
	await seedOnboardedAnonymous(page);
	await stubCdnInstrumentSamples(page);
	await page.addInitScript(() => {
		const observed = { starts: 0, lastScheduledTime: 0, microphoneCalls: 0 };
		// WebKit may recreate navigator.mediaDevices; the prototype survives wrapper GC.
		MediaDevices.prototype.getUserMedia = async function () {
			observed.microphoneCalls++;
			throw new Error('Listening must not request the microphone');
		};
		(window as unknown as { __blindAudio: typeof observed }).__blindAudio = observed;
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			observed.starts++;
			observed.lastScheduledTime = Math.max(observed.lastScheduledTime, args[0] ?? this.context.currentTime);
			return Reflect.apply(start, this, args);
		};
	});
	await page.goto('/musicality');
	await expect(page.getByTestId('blind-open')).toBeVisible();
	await page.getByTestId('blind-open').click();
}

async function assertBlind(page: Page): Promise<void> {
	await expect(page.getByTestId('listening-mode')).toHaveCount(0);
	await expect(page.locator('[data-testid^="musician-"]')).toHaveCount(0);
	await expect(page.locator('body')).not.toContainText(/Original|Coordinated/);
	await expect(page.getByTestId('blind-result')).toHaveCount(0);
	await expect(page.getByTestId('blind-export')).toHaveCount(0);
	await expect(page.getByTestId('blind-save')).toHaveCount(0);
	await expect(page.locator('[data-testid^="blind-mapping-"]')).toHaveCount(0);
}

async function startPair(page: Page): Promise<void> {
	await page.getByTestId('blind-tempo').fill('240');
	await page.getByTestId('blind-choruses').selectOption('1');
	await page.getByTestId('blind-start').click();
	for (const input of ['tune', 'style', 'key', 'tempo', 'choruses']) {
		await expect(page.getByTestId(`blind-${input}`)).toBeDisabled();
	}
}

async function rate(page: Page, label: 'A' | 'B', ids = criteria): Promise<void> {
	for (const id of ids) await page.getByTestId(`blind-rating-${label}-${id}`).selectOption('3');
}

async function sourceProbe(page: Page): Promise<{ starts: number; lastScheduledTime: number }> {
	return page.evaluate(() => ({ ...(window as unknown as { __blindAudio: { starts: number; lastScheduledTime: number } }).__blindAudio }));
}

async function playComplete(page: Page, label: 'A' | 'B'): Promise<number> {
	requireRealtimeAudio(page);
	await page.getByTestId(`blind-play-${label}`).click();
	await expect(page.getByTestId('blind-status')).toHaveText(`Playing take ${label}`, { timeout: 20_000 });
	await assertBlind(page);
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await expect(page.getByTestId(`blind-completed-${label}`)).toHaveText('Full take heard', { timeout: 55_000 });
	await expect(page.getByTestId('blind-status')).toHaveText(`Take ${label} complete`);
	const origin = Number(await page.getByTestId('blind-position').getAttribute('data-start-audio-time'));
	expect(origin).toBeGreaterThan(0);
	// The actual sample renderer dispatched through bar40, not merely a
	// completion badge advancing from a wall-clock timeout.
	const audio = await sourceProbe(page);
	expect(audio.lastScheduledTime - origin).toBeGreaterThanOrEqual(39);
	expect(audio.starts).toBeGreaterThan(100);
	return origin;
}

test('opens a blind comparison without revealing arrangement identity', async ({ page, browserName }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await setup(page);
	await expect(page.getByTestId('blind-start')).toBeVisible();
	await assertBlind(page);
	await startPair(page);
	await assertBlind(page);
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await expect(page.getByTestId('blind-rating-A-groove')).toBeDisabled();
	await expect(page.getByTestId('blind-preference')).toBeDisabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: `/tmp/musicality-blind-mobile-${browserName}.png`, fullPage: true });
});

test('requires two full actual takes and blind ratings before revealing and saving matched evidence', async ({ page }) => {
	test.setTimeout(150_000);
	await setup(page);
	await startPair(page);
	const startA = await playComplete(page, 'A');
	await rate(page, 'A');
	await expect(page.getByTestId('blind-completed-B')).toHaveText('Full listen pending');
	await expect(page.getByTestId('blind-rating-B-groove')).toBeDisabled();
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await assertBlind(page);
	const startB = await playComplete(page, 'B');
	expect(startB).toBeGreaterThan(startA + 40);
	await rate(page, 'B', criteria.filter((id) => id !== 'fatigue'));
	await page.getByTestId('blind-preference').selectOption('A');
	await page.getByTestId('blind-notes').fill('A had clearer arrivals; compare the final chorus again.');
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await assertBlind(page);
	await rate(page, 'B', ['fatigue']);
	await expect(page.getByTestId('blind-reveal')).toBeEnabled();
	await page.getByTestId('blind-reveal').click();
	await expect(page.getByTestId('blind-result')).toContainText('You preferred take A.');
	for (const label of ['A', 'B'] as const) {
		await expect(page.getByTestId(`blind-rating-${label}-groove`)).toBeDisabled();
	}
	await expect(page.getByTestId('blind-preference')).toBeDisabled();
	await expect(page.getByTestId('blind-notes')).toBeDisabled();
	const downloadPromise = page.waitForEvent('download');
	await page.getByTestId('blind-export').click();
	const download = await downloadPromise;
	const path = await download.path();
	expect(path).not.toBeNull();
	const evidence = JSON.parse(await readFile(path!, 'utf8')) as BlindListeningComparisonRecord;
	expect(evidence.revealed).toBe(true);
	expect(Object.values(evidence.mapping).sort()).toEqual(['coordinated', 'original']);
	expect(evidence.preference).toBe('A');
	expect(evidence.notes).toBe('A had clearer arrivals; compare the final chorus again.');
	expect(evidence.inputs.phrase.performanceForm!.choruses.map((chorus) => chorus.role)).toEqual(['head', 'solo', 'head']);
	for (const label of ['A', 'B'] as const) {
		const take = evidence.takes[label];
		expect(take.status).toBe('completed');
		expect(take.barIndex).toBe(39);
		expect(take.durationBeats).toBe(160);
		expect(take.elapsedBeats).toBe(160);
		expect(take.startAudioTime).toBe(label === 'A' ? startA : startB);
		expect(take.audioTime! - take.startAudioTime!).toBeGreaterThanOrEqual(42.5);
		expect(take.params).toEqual({ ...evidence.inputs, orchestration: evidence.mapping[label] });
		expect(take.generated!.bassEvents.some((event) => event.absBeat >= 156)).toBe(true);
		expect(Boolean(take.generated!.ensemblePlan)).toBe(evidence.mapping[label] === 'coordinated');
		expect(take.provenance).toMatchObject({ engine: evidence.mapping[label] === 'coordinated' ? 'causal-rolling' : 'fixed', totalBars: 40, committedBars: 40, committedThroughTick: 40 * 4 * take.ppq });
		if (evidence.mapping[label] === 'coordinated') {
			if (take.provenance?.engine !== 'causal-rolling') throw new Error('Expected causal completed evidence');
			expect(take.provenance.sessionStatus).toBe('complete');
			expect(take.provenance.dispatches.every(entry => entry.status === 'played')).toBe(true);
			expect(take.generated!.ensembleDevelopment!.pianoFeedback).toHaveLength(40);
		}
		expect(Object.values(evidence.ratings[label])).toEqual(Array(7).fill(3));
		await expect(page.getByTestId(`blind-mapping-${label}`)).toHaveText(evidence.mapping[label] === 'original' ? 'Original' : 'Coordinated');
	}
	expect(await page.evaluate(() => (window as unknown as { __blindAudio: { microphoneCalls: number } }).__blindAudio.microphoneCalls)).toBe(0);
	await page.getByTestId('blind-save').click();
	await expect(page.getByTestId('blind-save')).toHaveText('Saved locally');
	const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), archiveKey);
	expect(saved).toHaveLength(1);
	expect(saved[0]).toMatchObject({ id: evidence.id, mapping: evidence.mapping, ratings: evidence.ratings, preference: 'A', notes: evidence.notes });
	expect(saved[0].takes).toBeUndefined();
	expect(saved[0].completion.A).toMatchObject({ status: 'completed', durationBeats: 160, elapsedBeats: 160 });
	await page.getByRole('button', { name: 'Set up a new comparison', exact: true }).click();
	const history = page.getByTestId('blind-saved-reviews');
	await expect(history.locator('summary')).toHaveText('Saved reviews (1)');
	await history.locator('summary').click();
	await expect(history).toContainText('Mankunku Blues');
	const summaryDownload = page.waitForEvent('download');
	await history.getByRole('button', { name: 'Export summary', exact: true }).click();
	const summaryPath = await (await summaryDownload).path();
	expect(summaryPath).not.toBeNull();
	const summary = JSON.parse(await readFile(summaryPath!, 'utf8'));
	expect(summary).toEqual(saved[0]);
	await page.reload();
	await page.getByTestId('blind-open').click();
	await expect(page.getByTestId('blind-saved-reviews').locator('summary')).toHaveText('Saved reviews (1)');
	await startPair(page);
	await expect(page.getByTestId('blind-saved-reviews')).toHaveCount(0);
	await assertBlind(page);
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
});

test('an interrupted take stays ineligible and restarting discards its unfinished review', async ({ page }) => {
	await setup(page);
	await startPair(page);
	requireRealtimeAudio(page);
	await page.getByTestId('blind-play-A').click();
	await expect.poll(async () => Number(await page.getByTestId('blind-position').getAttribute('data-bar-index')), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
	await page.getByTestId('blind-stop').click();
	const stopped = await sourceProbe(page);
	await page.waitForTimeout(1_100);
	expect((await sourceProbe(page)).starts).toBe(stopped.starts);
	await expect(page.getByTestId('blind-completed-A')).toHaveText('Full listen pending');
	await expect(page.getByTestId('blind-rating-A-groove')).toBeDisabled();
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await assertBlind(page);
	await page.getByRole('button', { name: 'Set up a new comparison', exact: true }).click();
	await expect(page.getByTestId('blind-tempo')).toBeEnabled();
	await page.getByTestId('blind-start').click();
	await expect(page.getByTestId('blind-completed-A')).toHaveText('Full listen pending');
	await expect(page.getByTestId('blind-completed-B')).toHaveText('Full listen pending');
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
});

test('leaving during sample loading cannot start or complete an obsolete blind take', async ({ page }) => {
	await setup(page);
	await startPair(page);
	let release!: () => void;
	let held = false;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const holdSamples = async (route: Route) => { held = true; await gate; await route.fallback(); };
	await page.route('https://smpldsnds.github.io/**', holdSamples);
	try {
		requireRealtimeAudio(page);
		await page.getByTestId('blind-play-A').click();
		await expect.poll(() => held).toBe(true);
		await page.getByRole('button', { name: 'Back to listening', exact: true }).click();
		release();
		await page.unroute('https://smpldsnds.github.io/**', holdSamples);
		await expect(page.getByTestId('listening-status')).toHaveText('Ready to listen');
		const stopped = await sourceProbe(page);
		await page.waitForTimeout(1_100);
		expect((await sourceProbe(page)).starts).toBe(stopped.starts);
		await page.getByTestId('blind-open').click();
		await expect(page.getByTestId('blind-start')).toBeVisible();
		await assertBlind(page);
	} finally { release(); }
});

test('a corrupted saved archive shows a fallback and cannot block a new blind comparison', async ({ page }) => {
	await page.addInitScript((key) => localStorage.setItem(key, '{invalid-json'), archiveKey);
	await setup(page);
	const history = page.getByTestId('blind-saved-reviews');
	await history.locator('summary').click();
	await expect(history).toContainText('Saved reviews are unavailable in this browser.');
	await startPair(page);
	await expect(history).toHaveCount(0);
	await expect(page.getByTestId('blind-play-A')).toBeEnabled();
	await expect(page.getByTestId('blind-reveal')).toBeDisabled();
	await assertBlind(page);
});
