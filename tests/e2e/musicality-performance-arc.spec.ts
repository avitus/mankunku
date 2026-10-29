import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { LOCAL_LISTENING_AABA } from '../fixtures/musicality-local-aaba';
import type { ListeningSnapshot } from '../../src/lib/musicality/listening-player';
import type { ListeningTuneBar } from '../../src/lib/musicality/listening-tunes';

interface Take {
	completion: 'complete' | 'partial';
	session: { tuneId: string; bars: ListeningTuneBar[]; source?: unknown };
	playback: ListeningSnapshot;
	review?: { barIndex: number };
}

/** Count actual source starts; never replace or accelerate the audio clock. */
async function observeAudio(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = { starts: 0, microphoneCalls: 0 };
		(window as unknown as { __arcAudio: typeof state }).__arcAudio = state;
		MediaDevices.prototype.getUserMedia = async function () {
			state.microphoneCalls++;
			throw new Error('Listening must not request the microphone');
		};
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			state.starts++;
			return Reflect.apply(start, this, args);
		};
	});
}

async function audioCounts(page: Page) {
	return page.evaluate(() => (window as unknown as { __arcAudio: { starts: number; microphoneCalls: number } }).__arcAudio);
}

async function exportTake(page: Page): Promise<Take> {
	const notes = page.locator('details.take-notes');
	if (!(await notes.evaluate(element => (element as HTMLDetailsElement).open))) await notes.locator('summary').click({ timeout: 3000 });
	const [download] = await Promise.all([
		page.waitForEvent('download', { timeout: 5000 }),
		page.getByTestId('listening-export').click({ timeout: 3000 })
	]);
	const path = await download.path();
	if (!path) throw new Error('Listening export has no local download');
	return JSON.parse(await readFile(path, 'utf8')) as Take;
}

// Preserve the original assertion failure while attaching any stopped/failed
// take, including the renderer's callback clock diagnostics, for investigation.
test.afterEach(async ({ page }, info) => {
	if (info.status === info.expectedStatus || page.isClosed()) return;
	try {
		const stop = page.getByTestId('listening-stop');
		if (await stop.isVisible()) await stop.click({ timeout: 2000 });
		if (await page.getByTestId('listening-export').isEnabled({ timeout: 2000 })) {
			const evidence = await exportTake(page);
			await info.attach('failed-performance-arc-take', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
		}
	} catch (error) {
		await info.attach('performance-arc-evidence-unavailable', { body: String(error), contentType: 'text/plain' });
	}
});

async function soundingBar(page: Page): Promise<number> {
	const value = await page.getByTestId('listening-position').getAttribute('data-bar-index');
	return value ? Number(value) : -1;
}

async function assertArcFollowsSoundingBar(page: Page, totalBars: number, pass: string) {
	// Atomic DOM read avoids comparing opposite sides of a real bar boundary.
	const position = await page.evaluate(() => ({
		sounding: document.querySelector('[data-testid="listening-position"]')?.getAttribute('data-bar-index'),
		arc: document.querySelector('[data-testid="listening-arc"]')?.getAttribute('data-bar-index')
	}));
	expect(position.arc).toBe(position.sounding);
	expect(Number(position.arc)).toBeGreaterThanOrEqual(0);
	expect(Number(position.arc)).toBeLessThan(totalBars);
	await expect(page.locator('[data-testid="listening-arc-pass"][aria-current="step"]')).toHaveText(pass);
	await expect(page.getByTestId('listening-arc-marker')).toBeVisible();
}

const cases = [
	{ label: 'local AABA Swing', local: true, style: 'swing', bars: 128, boundaries: [32, 64, 96], passes: [32, 32, 32, 32], ending: 'continue' },
	{ label: 'Blues Straight', local: false, style: 'straight', bars: 52, boundaries: [16, 28, 40], passes: [16, 12, 12, 12], ending: 'continue' },
	{ label: 'Blues Bossa', local: false, style: 'bossa-nova', bars: 52, boundaries: [16, 28, 40], passes: [16, 12, 12, 12], ending: 'continue' },
	{ label: 'Blues Ballad hold and release', local: false, style: 'ballad', bars: 52, boundaries: [16, 28, 40], passes: [16, 12, 12, 12], ending: 'hold-release' }
] as const;

for (const example of cases) {
	test(`${example.label}: overall arc follows a complete real-clock performance and silent review`, async ({ page }) => {
		test.setTimeout(180_000);
		await seedOnboardedAnonymous(page);
		if (example.local) await seedTunes(page, [LOCAL_LISTENING_AABA]);
		await observeAudio(page);
		await stubCdnInstrumentSamples(page);
		await page.goto('/musicality');
		if (example.local) await page.getByTestId('listening-tune').selectOption(LOCAL_LISTENING_AABA.id);
		await page.getByTestId('listening-tempo').fill('240');
		await page.getByTestId('listening-style').selectOption(example.style);
		await page.getByTestId('listening-choruses').selectOption('2');
		const modes = page.getByTestId('listening-mode');
		await modes.getByRole('button', { name: 'Original', exact: true }).click();
		await expect(page.getByTestId('listening-arc')).toContainText('Tune form');
		await expect(page.getByTestId('listening-arc-curve')).toHaveCount(0);
		await modes.getByRole('button', { name: 'Coordinated', exact: true }).click();
		await page.getByTestId('listening-ending').selectOption(example.ending);
		await expect(page.getByTestId('listening-arc-curve')).toBeVisible();
		await expect(page.getByTestId('listening-arc-pass')).toHaveText(['Head in', 'Solo 1', 'Solo 2', 'Head out']);
		await expect(page.getByTestId('listening-arc-position')).toHaveText('Whole tune');

		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
		await assertArcFollowsSoundingBar(page, example.bars, 'Head in');
		const opening = await exportTake(page);
		expect(opening.completion).toBe('partial');
		expect(opening.playback.provenance?.committedBars).toBeLessThan(example.bars);
		for (const [index, boundary] of example.boundaries.entries()) {
			await expect.poll(() => soundingBar(page), { timeout: 36_000 }).toBeGreaterThanOrEqual(boundary);
			await assertArcFollowsSoundingBar(page, example.bars, ['Solo 1', 'Solo 2', 'Head out'][index]);
		}
		await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 36_000 });
		await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
		await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 6000 });
		await expect(page.getByTestId('listening-arc')).toHaveAttribute('data-bar-index', String(example.bars - 1));
		await expect(page.getByTestId('listening-arc-position')).toHaveText(`Bar ${example.bars} of ${example.bars}`);
		const finished = await exportTake(page);
		expect(finished.completion).toBe('complete');
		expect(finished.session.bars).toHaveLength(example.bars);
		if (example.local) expect(finished.session.source).toMatchObject({ id: LOCAL_LISTENING_AABA.id, source: 'user' });
		expect(finished.playback).toMatchObject({ status: 'completed', barIndex: example.bars - 1,
			elapsedBeats: example.bars * 4, durationBeats: example.bars * 4 });
		expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(example.bars + 2.5);
		expect(finished.playback.params!.ending).toBe(example.ending === 'hold-release' ? 'hold-release' : undefined);
		expect(finished.playback.params!.phrase.performanceForm!.choruses.map(pass => [pass.role, pass.endBarExclusive - pass.startBar]))
			.toEqual(example.passes.map((bars, i) => [i === 0 || i === 3 ? 'head' : 'solo', bars]));
		const provenance = finished.playback.provenance;
		expect(provenance).toMatchObject({ engine: 'causal-rolling', totalBars: example.bars, committedBars: example.bars,
			committedThroughTick: example.bars * 4 * finished.playback.ppq, sessionStatus: 'complete' });
		if (provenance?.engine !== 'causal-rolling') throw new Error('Expected causal playback evidence');
		expect(provenance.dispatches.length).toBeGreaterThan(0);
		expect(provenance.dispatches.every(event => event.status === 'played' && !event.diagnostic)).toBe(true);
		for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
			const prefix = opening.playback.generated![field];
			expect(finished.playback.generated![field].slice(0, prefix.length)).toEqual(prefix);
		}
		expect(finished.playback.generated!.ensemblePlan!.bars.slice(0, opening.playback.provenance!.committedBars))
			.toEqual(opening.playback.generated!.ensemblePlan!.bars);
		expect(finished.playback.generated!.ensembleDevelopment!.pianoFeedback!.slice(0, opening.playback.provenance!.committedBars))
			.toEqual(opening.playback.generated!.ensembleDevelopment!.pianoFeedback);
		if (example.style === 'ballad') expect(finished.playback.generated!.ensembleDevelopment!.terminalArrangements)
			.toEqual([expect.objectContaining({ barIndex: 51, status: 'accepted' })]);

		const headReturn = example.boundaries[2];
		const breathBars = [headReturn + 1, headReturn + 2];
		for (const bar of breathBars) {
			expect(finished.playback.generated!.ensemblePlan!.bars[bar].piano)
				.toMatchObject({ maxAttacks: 0, silenceReason: 'returning_melody' });
			expect(finished.playback.generated!.compEvents.filter(event => Math.floor(event.absBeat / 4) === bar)).toEqual([]);
			expect(finished.playback.generated!.bassEvents.some(event => Math.floor(event.absBeat / 4) === bar)).toBe(true);
			expect(finished.playback.generated!.drumEvents.some(event => Math.floor(event.absBeat / 4) === bar && event.role === 'timekeeping')).toBe(true);
		}
		expect(finished.playback.generated!.compEvents.some(event => Math.floor(event.absBeat / 4) === headReturn + 3)).toBe(true);

		const heard = await audioCounts(page);
		expect(heard.starts).toBeGreaterThan(100);
		expect(heard.microphoneCalls).toBe(0);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await expect(review).toHaveAttribute('max', String(example.bars - 1));
		await review.press('Home');
		await expect(page.getByTestId('listening-arc')).toHaveAttribute('data-bar-index', '0');
		await expect(page.getByTestId('listening-arc-position')).toHaveText(`Review · Bar 1 of ${example.bars}`);
		await expect(page.locator('[data-testid="listening-arc-pass"][aria-current="step"]')).toHaveText('Head in');
		const reviewed = await exportTake(page);
		expect(reviewed.review?.barIndex).toBe(0);
		expect(reviewed.playback).toEqual(finished.playback);
		await review.press('End');
		await expect(page.getByTestId('listening-arc')).toHaveAttribute('data-bar-index', String(example.bars - 1));
		await expect(page.getByTestId('listening-arc-position')).toHaveText(`Review · Bar ${example.bars} of ${example.bars}`);
		await expect(page.locator('[data-testid="listening-arc-pass"][aria-current="step"]')).toHaveText('Head out');
		for (let bar = example.bars - 1; bar > headReturn + 2; bar--) await review.press('ArrowLeft');
		await expect(page.getByTestId('musician-piano')).toContainText('Make room for the returning melody');
		await expect(page.getByTestId('listening-arc')).toHaveAttribute('data-bar-index', String(headReturn + 2));
		expect(await audioCounts(page)).toEqual(heard);
	});
}
