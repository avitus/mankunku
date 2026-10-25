import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import type { ListeningSnapshot } from '../../src/lib/musicality/listening-player';

interface ListeningEvidence {
	playback: ListeningSnapshot;
	marks: { barIndex: number; elapsedBeats: number; note: string }[];
}

/** Observe real Web Audio dispatch without replacing its clock or the renderer. */
async function observeAudio(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = { contexts: [] as BaseAudioContext[], starts: 0, lastScheduledTime: 0 };
		(window as unknown as { __listeningAudio: typeof state }).__listeningAudio = state;
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (!state.contexts.includes(this.context)) state.contexts.push(this.context);
			state.starts++;
			state.lastScheduledTime = Math.max(state.lastScheduledTime, args[0] ?? this.context.currentTime);
			return Reflect.apply(start, this, args);
		};
	});
}

async function setup(page: Page): Promise<void> {
	await seedOnboardedAnonymous(page);
	await observeAudio(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/musicality');
	await page.getByTestId('listening-tempo').fill('240');
}

async function exportTake(page: Page): Promise<ListeningEvidence> {
	const notes = page.locator('details.take-notes');
	if (!(await notes.evaluate((element) => (element as HTMLDetailsElement).open))) await notes.locator('summary').click();
	const download = page.waitForEvent('download');
	await page.getByTestId('listening-export').click();
	const path = await (await download).path();
	expect(path).not.toBeNull();
	return JSON.parse(await readFile(path!, 'utf8')) as ListeningEvidence;
}

async function soundingBar(page: Page): Promise<number> {
	const value = await page.getByTestId('listening-position').getAttribute('data-bar-index');
	return value === null || value === '' ? -1 : Number(value);
}

async function sourceStarts(page: Page): Promise<number> {
	return page.evaluate(() => (window as unknown as { __listeningAudio: { starts: number } }).__listeningAudio.starts);
}

async function playToBar(page: Page, bar = 1): Promise<void> {
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(bar);
}

async function assertDecisionClock(page: Page, score?: ListeningSnapshot): Promise<void> {
	// Read all positions and the live clock atomically. A 150 ms allowance
	// covers the 40 ms UI poll; it does not allow scheduling lookahead to
	// advance the cards to a future bar.
	const position = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="listening-position"]')!;
		const origin = Number(row.getAttribute('data-start-audio-time'));
		const bar = Number(row.getAttribute('data-bar-index'));
		const contexts = (window as unknown as { __listeningAudio: { contexts: BaseAudioContext[] } }).__listeningAudio.contexts;
		return { origin, bar, now: contexts.at(-1)?.currentTime,
			cards: ['bass', 'piano', 'drums'].map((instrument) =>
				Number(document.querySelector(`[data-testid="musician-${instrument}"]`)?.getAttribute('data-bar-index'))),
			counts: ['bass', 'piano', 'drums'].map((instrument) => Number.parseInt(
				document.querySelector(`[data-testid="musician-${instrument}"] summary`)?.textContent ?? '', 10)) };
	});
	expect(position.origin).toBeGreaterThan(0);
	expect(position.now).toBeDefined();
	expect(position.cards).toEqual([position.bar, position.bar, position.bar]);
	const elapsed = position.now! - position.origin;
	// At 240 BPM, a 4/4 bar lasts one second.
	expect(elapsed).toBeGreaterThanOrEqual(position.bar);
	expect(elapsed).toBeLessThan(position.bar + 1.15);
	if (score?.generated) {
		const inBar = (event: { time: string }) => Math.floor(parseInt(event.time, 10) / score.ppq / 4) === position.bar;
		expect(position.counts).toEqual([score.generated.bassEvents, score.generated.compEvents, score.generated.drumEvents]
			.map((events) => events.filter(inBar).length));
	}
}

test('listens through a complete real tune and follows each chorus on the audio clock', async ({ page }) => {
	test.setTimeout(90_000);
	await setup(page);
	await expect(page.getByTestId('listening-tune').locator('option:checked')).toHaveText('Mankunku Blues');
	await expect(page.getByLabel('Search the specification')).not.toBeVisible();
	await playToBar(page);
	await assertDecisionClock(page);
	const started = await exportTake(page);
	await assertDecisionClock(page, started.playback);
	await page.getByLabel('Listening note', { exact: true }).fill('Listen again to the opening bass line');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	expect(started.playback.durationBeats).toBe(52 * 4);
	expect(started.playback.params!.phrase.performanceForm!.choruses.map((chorus) => chorus.role))
		.toEqual(['head', 'solo', 'solo', 'head']);
	for (const boundary of [16, 28, 40]) {
		await expect.poll(() => soundingBar(page), { timeout: 18_000 }).toBeGreaterThanOrEqual(boundary);
		await assertDecisionClock(page, started.playback);
	}
	await expect(page.getByTestId('listening-status')).toContainText(/complete/i, { timeout: 20_000 });
	const finished = await exportTake(page);
	expect(finished.playback.status).toBe('completed');
	expect(finished.marks).toHaveLength(1);
	expect(finished.marks[0].note).toBe('Listen again to the opening bass line');
	expect(finished.marks[0].barIndex).toBeGreaterThanOrEqual(started.playback.barIndex!);
	expect(finished.marks[0].elapsedBeats).toBeGreaterThanOrEqual(finished.marks[0].barIndex * 4);
	expect(finished.marks[0].elapsedBeats).toBeLessThan((finished.marks[0].barIndex + 1) * 4);
	expect(finished.playback.barIndex).toBe(51);
	expect(finished.playback.elapsedBeats).toBe(208);
	expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(54.5);
	expect(finished.playback.generated).toEqual(started.playback.generated);
	expect(finished.playback.generated!.bassEvents.some((event) => event.absBeat >= 204)).toBe(true);
	expect(await sourceStarts(page)).toBeGreaterThan(100);
	const lastAudio = await page.evaluate(() => (window as unknown as { __listeningAudio: { lastScheduledTime: number } }).__listeningAudio.lastScheduledTime);
	expect(lastAudio - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(51);
});

test('compares matched Original and Coordinated takes and stops all future dispatch', async ({ page }) => {
	await setup(page);
	await page.getByTestId('listening-mode').selectOption('original');
	await playToBar(page);
	await page.getByTestId('listening-stop').click();
	const original = await exportTake(page);
	const stoppedBar = await soundingBar(page);
	const stoppedStarts = await sourceStarts(page);
	await page.waitForTimeout(1_200);
	expect(await soundingBar(page)).toBe(stoppedBar);
	expect(await sourceStarts(page)).toBe(stoppedStarts);
	expect(original.playback.status).toBe('stopped');
	expect(original.playback.generated!.ensemblePlan).toBeUndefined();
	await page.getByTestId('listening-mode').selectOption('coordinated');
	await playToBar(page);
	await assertDecisionClock(page);
	await page.getByTestId('listening-stop').click();
	const coordinated = await exportTake(page);
	expect(coordinated.playback.generated!.ensemblePlan).toBeDefined();
	expect(coordinated.playback.params).toEqual({ ...original.playback.params, orchestration: 'coordinated' });
	expect(coordinated.playback.startAudioTime).toBeGreaterThan(original.playback.startAudioTime!);
});

for (const style of ['bossa-nova', 'ballad', 'straight'] as const) {
	test(`${style} keeps its native rhythm throughout the complete generated tune`, async ({ page, browserName }) => {
		if (style === 'bossa-nova') await page.setViewportSize({ width: 390, height: 844 });
		await setup(page);
		if (style === 'bossa-nova') expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.getByTestId('listening-style').selectOption(style);
		await playToBar(page);
		await assertDecisionClock(page);
		if (style === 'bossa-nova') {
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			await page.screenshot({ path: `/tmp/musicality-listening-mobile-${browserName}.png`, fullPage: true });
		}
		await page.getByTestId('listening-stop').click();
		const { playback } = await exportTake(page);
		expect(playback.params!.style).toBe(style);
		expect(playback.durationBeats).toBe(208);
		const generated = playback.generated!;
		expect(generated.ensemblePlan).toBeDefined();
		if (style === 'bossa-nova') {
			expect(generated.drumEvents.filter((event) => event.drum === 'hihat')).toHaveLength(52 * 8);
			expect(generated.bassEvents.every((event) => [0, 1.5, 2, 3.5].includes(event.absBeat % 4))).toBe(true);
			expect(generated.ensembleDevelopment!.pianoMotifs.every((decision) => decision.motifId === null)).toBe(true);
			expect(generated.ensembleDevelopment!.bassTurnarounds.every((decision) => decision.status === 'skipped' && decision.notes.length === 0)).toBe(true);
		}
		if (style === 'ballad') {
			expect(generated.bassEvents.every((event) => event.absBeat % 2 === 0)).toBe(true);
			expect(generated.ensemblePlan!.bars.every((bar) => bar.energy <= 0.6)).toBe(true);
			expect(generated.ensembleDevelopment!.pianoMotifs.every((decision) => decision.motifId === null)).toBe(true);
			expect(generated.ensembleDevelopment!.bassTurnarounds.every((decision) => decision.status === 'skipped' && decision.notes.length === 0)).toBe(true);
		}
		if (style === 'straight') {
			// The style's even eighth grid survives coordination; offsets are
			// expressive humanization, not Swing's displaced offbeats.
			const offbeats = generated.drumEvents.filter((event) => event.drum === 'ride' && event.absBeat % 1 === 0.5);
			expect(offbeats.length).toBeGreaterThan(0);
			expect(offbeats.every((event) => Math.abs(parseInt(event.time, 10) / playback.ppq - event.absBeat) < 0.08)).toBe(true);
		}
	});
}

test('cancels instrument loading without starting a late take, then allows replay', async ({ page }) => {
	await setup(page);
	let release!: () => void;
	let held = false;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const holdSamples = async (route: import('@playwright/test').Route) => {
		held = true;
		await gate;
		await route.fallback();
	};
	await page.route('https://smpldsnds.github.io/**', holdSamples);
	try {
		await page.getByTestId('listening-play').click();
		await expect.poll(() => held).toBe(true);
		await page.getByTestId('listening-stop').click();
		release();
		await page.unroute('https://smpldsnds.github.io/**', holdSamples);
		await page.waitForTimeout(1_200);
		await expect(page.getByTestId('listening-status')).toContainText(/stopped/i);
		expect(await soundingBar(page)).toBe(-1);
		await playToBar(page);
		await assertDecisionClock(page);
		await page.getByTestId('listening-stop').click();
	} finally {
		release();
	}
});


test('navigation releases the current take and returning starts from a fresh session', async ({ page }) => {
	await setup(page);
	await playToBar(page);
	await page.getByRole('link', { name: /Architecture & roadmap/ }).click();
	await expect(page).toHaveURL(/\/docs\/architecture\/musicality$/);
	// SvelteKit navigation retains the observed AudioContext. A document
	// reload would erase this probe and fail instead of masking cleanup.
	const stoppedStarts = await sourceStarts(page);
	expect(stoppedStarts).toBeGreaterThan(0);
	await page.waitForTimeout(1_200);
	expect(await sourceStarts(page)).toBe(stoppedStarts);
	await page.goBack();
	await expect(page.getByTestId('listening-status')).toHaveText('Ready to listen');
	expect(await soundingBar(page)).toBe(-1);
	await page.getByTestId('listening-tempo').fill('240');
	await playToBar(page);
	await page.getByTestId('listening-stop').click();
});
