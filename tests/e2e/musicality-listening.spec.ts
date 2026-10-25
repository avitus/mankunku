import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import type { MusicianDecisionCard } from '../../src/lib/musicality/musician-decisions';
import type { CausalListeningProvenance, ListeningSnapshot } from '../../src/lib/musicality/listening-player';

import type { ListeningTuneBar } from '../../src/lib/musicality/listening-tunes';
import { LOCAL_LISTENING_AABA } from '../fixtures/musicality-local-aaba';

interface ListeningEvidence {
	session: { tuneId: string; headBars: number; chorusBars: number; soloChoruses: number; bars: ListeningTuneBar[]; source?: unknown };
	completion: 'complete' | 'partial';
	playback: ListeningSnapshot;
	marks: { barIndex: number; elapsedBeats: number; note: string }[];
	decisions: MusicianDecisionCard[];
	review?: { barIndex: number; decisions: MusicianDecisionCard[] };
}

/** Observe real Web Audio dispatch without replacing its clock or the renderer. */
async function observeAudio(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = { contexts: [] as BaseAudioContext[], starts: 0, lastScheduledTime: 0, microphoneCalls: 0 };
		(window as unknown as { __listeningAudio: typeof state }).__listeningAudio = state;
		// WebKit may recreate navigator.mediaDevices; the prototype survives wrapper GC.
		MediaDevices.prototype.getUserMedia = async function () {
			state.microphoneCalls++;
			throw new Error('Listening must not request the microphone');
		};
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

function causalProvenance(playback: ListeningSnapshot): CausalListeningProvenance {
	expect(playback.provenance?.engine).toBe('causal-rolling');
	if (playback.provenance?.engine !== 'causal-rolling') throw new Error('Expected a causal take');
	return playback.provenance;
}

/** Every export contains only committed bars; an earlier downloaded score stays a prefix. */
function assertCommittedPrefix(previous: ListeningSnapshot, current: ListeningSnapshot): void {
	expect(current.provenance?.engine).toBe('causal-rolling');
	expect(current.provenance!.committedBars).toBeGreaterThanOrEqual(previous.provenance!.committedBars);
	for (const field of ['bassEvents', 'compEvents', 'drumEvents'] as const) {
		const prefix = previous.generated![field];
		expect(current.generated![field].slice(0, prefix.length)).toEqual(prefix);
	}
	expect(current.generated!.ensemblePlan!.bars.slice(0, previous.provenance!.committedBars))
		.toEqual(previous.generated!.ensemblePlan!.bars);
	expect(current.generated!.ensembleDevelopment!.pianoFeedback!.slice(0, previous.provenance!.committedBars))
		.toEqual(previous.generated!.ensembleDevelopment!.pianoFeedback);
}

function assertActualFeedback(playback: ListeningSnapshot): void {
	const generated = playback.generated!;
	const feedback = generated.ensembleDevelopment!.pianoFeedback!;
	expect(feedback).toHaveLength(playback.provenance!.committedBars);
	for (const entry of feedback) {
		expect(entry.acceptedAttacks).toEqual(generated.compEvents.filter(event => Math.floor(event.absBeat! / 4) === entry.barIndex)
			.map(({ time, absBeat, notes }) => ({ time, absBeat, notes })));
		if (entry.source) {
			expect(entry.source.barIndex).toBe(entry.barIndex - 1);
			for (const hit of entry.source.hits) {
				expect(hit.role).toBe('commentary');
				expect(generated.drumEvents).toContainEqual(hit);
			}
		}
		if (entry.action === 'yield') {
			expect(entry.source!.hits.length).toBeGreaterThanOrEqual(2);
			expect(entry.acceptedAttacks).toEqual([]);
			expect(entry.originalMaxAttacks).toBeGreaterThan(0);
			expect(entry.effectiveMaxAttacks).toBe(0);
		}
	}
}

async function assertNoMicrophone(page: Page): Promise<void> {
	expect(await page.evaluate(() => (window as unknown as { __listeningAudio: { microphoneCalls: number } }).__listeningAudio.microphoneCalls)).toBe(0);
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

async function assertDecisionClock(page: Page, score?: ListeningSnapshot, tempo = 240): Promise<void> {
	// Read all positions and the live clock atomically. A 150 ms allowance
	// covers the 40 ms UI poll; it does not allow scheduling lookahead to
	// advance the cards to a future bar.
	const position = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="listening-position"]')!;
		const origin = Number(row.getAttribute('data-start-audio-time'));
		const bar = Number(row.getAttribute('data-bar-index'));
		const contexts = (window as unknown as { __listeningAudio: { contexts: BaseAudioContext[] } }).__listeningAudio.contexts;
		const arc = document.querySelector('[data-testid="listening-performance-arc"]');
		return { origin, bar, now: contexts.at(-1)?.currentTime,
			arc: arc ? { bar: Number(arc.getAttribute('data-bar-index')), phase: arc.getAttribute('data-phase') } : null,
			pianoEvidence: document.querySelector('[data-testid="musician-piano"]')?.textContent ?? '',
			cards: ['bass', 'piano', 'drums'].map((instrument) =>
				Number(document.querySelector(`[data-testid="musician-${instrument}"]`)?.getAttribute('data-bar-index'))),
			counts: ['bass', 'piano', 'drums'].map((instrument) => Number.parseInt(
				document.querySelector(`[data-testid="musician-${instrument}"] summary`)?.textContent ?? '', 10)) };
	});
	expect(position.origin).toBeGreaterThan(0);
	expect(position.now).toBeDefined();
	expect(position.cards).toEqual([position.bar, position.bar, position.bar]);
	const elapsed = position.now! - position.origin;
	const barSeconds = 240 / tempo;
	expect(elapsed).toBeGreaterThanOrEqual(position.bar * barSeconds);
	expect(elapsed).toBeLessThan((position.bar + 1) * barSeconds + 0.15);
	if (score?.generated) {
		const inBar = (event: { time: string }) => Math.floor(parseInt(event.time, 10) / score.ppq / 4) === position.bar;
		const plannedArc = score.generated.ensemblePlan?.bars[position.bar]?.performanceEnergy;
		expect(position.arc).toEqual(plannedArc ? { bar: position.bar, phase: plannedArc.phase } : null);
		const heardThree = score.generated.ensembleDevelopment?.pianoVoicings?.some(entry => inBar(entry) &&
			entry.decision.rootlessTexture?.applied === 'three' && entry.notes.length === 3) ?? false;
		expect(position.pianoEvidence.includes('texture: three-note rootless support')).toBe(heardThree);
		if (score.generated.ensemblePlan?.bars[position.bar]?.piano.rootlessTexture)
			expect(position.pianoEvidence).toContain('Planned rootless texture:');
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
	await expect(page.getByTestId('listening-performance-arc')).toContainText('Planned arc');
	await assertDecisionClock(page);
	const started = await exportTake(page);
	expect(started.completion).toBe('partial');
	expect(started.playback.provenance?.engine).toBe('causal-rolling');
	expect(started.playback.provenance!.committedBars).toBeLessThan(52);
	await assertDecisionClock(page, started.playback);
	await page.getByLabel('Listening note', { exact: true }).fill('Listen again to the opening bass line');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	expect(started.playback.durationBeats).toBe(52 * 4);
	expect(started.playback.params!.phrase.performanceForm!.choruses.map((chorus) => chorus.role))
		.toEqual(['head', 'solo', 'solo', 'head']);
	for (const boundary of [16, 28, 40]) {
		await expect.poll(() => soundingBar(page), { timeout: 18_000 }).toBeGreaterThanOrEqual(boundary);
		const later = await exportTake(page);
		assertCommittedPrefix(started.playback, later.playback);
		expect(later.playback.provenance!.committedBars).toBeGreaterThan(boundary);
		await assertDecisionClock(page, later.playback);
	}
	await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 20_000 });
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toContainText(/complete/i, { timeout: 20_000 });
	const finished = await exportTake(page);
	expect(finished.completion).toBe('complete');
	const voicings = finished.playback.generated!.ensembleDevelopment?.pianoVoicings;
	expect(voicings?.length).toBe(finished.playback.generated!.compEvents.length);
	expect(voicings!.length).toBeGreaterThan(0);
	expect(voicings!.some(entry => entry.decision.rootlessTexture?.applied === 'three')).toBe(true);
	for (const entry of voicings!) {
		expect(entry.decision.rootlessTexture?.noteCount).toBe(entry.notes.length);
		if (entry.decision.rootlessTexture?.applied === 'three') expect(entry.notes).toHaveLength(3);
	}
	for (const voiced of voicings!) expect(finished.playback.generated!.compEvents.some(event =>
		event.time === voiced.time && event.absBeat === voiced.absBeat && event.notes.join(',') === voiced.notes.join(','))).toBe(true);

	expect(finished.playback.status).toBe('completed');
	expect(finished.marks).toHaveLength(1);
	expect(finished.marks[0].note).toBe('Listen again to the opening bass line');
	expect(finished.marks[0].barIndex).toBeGreaterThanOrEqual(started.playback.barIndex!);
	expect(finished.marks[0].elapsedBeats).toBeGreaterThanOrEqual(finished.marks[0].barIndex * 4);
	expect(finished.marks[0].elapsedBeats).toBeLessThan((finished.marks[0].barIndex + 1) * 4);
	expect(finished.playback.barIndex).toBe(51);
	expect(finished.playback.elapsedBeats).toBe(208);
	expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(54.5);
	assertCommittedPrefix(started.playback, finished.playback);
	assertActualFeedback(finished.playback);
	expect(finished.playback.provenance).toMatchObject({ engine: 'causal-rolling', committedBars: 52, totalBars: 52, committedThroughTick: 52 * 4 * finished.playback.ppq, sessionStatus: 'complete' });
	expect(causalProvenance(finished.playback).dispatches.every(entry => entry.status === 'played')).toBe(true);
	await assertNoMicrophone(page);
	expect(finished.playback.generated!.bassEvents.some((event) => event.absBeat >= 204)).toBe(true);
	expect(await sourceStarts(page)).toBeGreaterThan(100);
	const lastAudio = await page.evaluate(() => (window as unknown as { __listeningAudio: { lastScheduledTime: number } }).__listeningAudio.lastScheduledTime);
	expect(lastAudio - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(51);
	const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(review).toHaveAttribute('max', '51');
	const finishedStarts = await sourceStarts(page);
	await review.press('Home');
	await expect(page.getByTestId('musician-piano')).toHaveAttribute('data-bar-index', '0');
	const revisited = await exportTake(page);
	const { review: selected, ...unchanged } = revisited;
	expect(selected?.barIndex).toBe(0);
	expect(unchanged).toEqual(finished);
	expect(await sourceStarts(page)).toBe(finishedStarts);

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
	expect(original.completion).toBe('partial');
	expect(original.playback.provenance).toMatchObject({ engine: 'fixed', committedBars: 52, totalBars: 52 });
	expect(original.playback.generated!.ensemblePlan).toBeUndefined();
	const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(review).toHaveAttribute('max', String(original.playback.barIndex));
	await review.press('Home');
	await expect(page.getByTestId('musician-piano')).not.toContainText('Planned performance arc');
	const revisited = await exportTake(page);
	const { review: selected, ...unchanged } = revisited;
	expect(selected?.barIndex).toBe(0);
	expect(unchanged).toEqual(original);
	expect(await sourceStarts(page)).toBe(stoppedStarts);

	await expect(page.getByTestId('listening-performance-arc')).not.toBeVisible();
	await page.getByTestId('listening-mode').selectOption('coordinated');
	await expect(review).toHaveCount(0);
	await playToBar(page);
	await assertDecisionClock(page);
	await page.getByTestId('listening-stop').click();
	const coordinated = await exportTake(page);
	expect(coordinated.playback.generated!.ensemblePlan).toBeDefined();
	expect(coordinated.playback.provenance?.engine).toBe('causal-rolling');
	expect(coordinated.playback.provenance!.committedBars).toBeLessThan(52);
	const coordinatedStarts = await sourceStarts(page);
	await page.waitForTimeout(1_200);
	expect(await sourceStarts(page)).toBe(coordinatedStarts);
	await assertNoMicrophone(page);
	expect(coordinated.playback.params).toEqual({ ...original.playback.params, orchestration: 'coordinated' });
	expect(coordinated.playback.startAudioTime).toBeGreaterThan(original.playback.startAudioTime!);
});

for (const style of ['bossa-nova', 'ballad', 'straight'] as const) {
	test(`${style} keeps its native rhythm throughout the complete generated tune`, async ({ page, browserName }) => {
		test.setTimeout(90_000);
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
		const early = await exportTake(page);
		expect(early.playback.provenance!.committedBars).toBeLessThan(52);
		await expect(page.getByTestId('listening-status')).toContainText(/complete/i, { timeout: 65_000 });
		const { playback } = await exportTake(page);
		assertCommittedPrefix(early.playback, playback);
		assertActualFeedback(playback);
		expect(playback.provenance).toMatchObject({ engine: 'causal-rolling', committedBars: 52, sessionStatus: 'complete' });
		expect(playback.audioTime! - playback.startAudioTime!).toBeGreaterThanOrEqual(54.5);
		expect(causalProvenance(playback).dispatches.every(entry => entry.status === 'played')).toBe(true);
		await assertNoMicrophone(page);
		expect(playback.params!.style).toBe(style);
		expect(playback.durationBeats).toBe(208);
		const generated = playback.generated!;
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await expect(review).toHaveAttribute('max', '51');
		await review.press('Home');
		const revisited = await exportTake(page);
		expect(revisited.playback).toEqual(playback);
		expect(revisited.review?.barIndex).toBe(0);
		if (style === 'bossa-nova') await expect(page.getByTestId('musician-drums')).toContainText('bossa');
		if (style === 'ballad') await expect(page.getByTestId('musician-drums')).toContainText('ballad');

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
		await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
		await page.getByTestId('listening-stop').click();
		release();
		await page.unroute('https://smpldsnds.github.io/**', holdSamples);
		await page.waitForTimeout(1_200);
		await expect(page.getByTestId('listening-status')).toContainText(/stopped/i);
		expect(await soundingBar(page)).toBe(-1);
		await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
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


test('shows a real previous drum statement and the pianist breathing in the current sounding bar', async ({ page }) => {
	test.setTimeout(60_000);
	await setup(page);
	// The real Blues chart and ordinary saved Swing setting produce this
	// deterministic exchange at 180 BPM; no synthetic soloist or microphone.
	await page.getByTestId('listening-tempo').fill('180');
	await playToBar(page);
	await expect.poll(() => soundingBar(page), { timeout: 38_000, intervals: [50] }).toBe(21);
	await expect(page.getByTestId('musician-piano')).toContainText('Drum statement in bar 21:');
	await expect(page.getByTestId('musician-piano')).toContainText('Scheduled result: no new chord attack');
	const { playback } = await exportTake(page);
	expect(playback.barIndex).toBe(21);
	assertActualFeedback(playback);
	expect(playback.generated!.ensembleDevelopment!.pianoFeedback![21]).toMatchObject({
		barIndex: 21, action: 'yield', reason: 'drum_statement', source: { barIndex: 20 }, acceptedAttacks: []
	});
	await assertDecisionClock(page, playback, 180);
	await assertNoMicrophone(page);
	await page.getByTestId('listening-stop').click();
});

test('a missed scheduling deadline stops the take without reporting completion or dispatching a catch-up burst', async ({ page }) => {
	await setup(page);
	await playToBar(page);
	// Simulate a blocked browser task while its real audio clock keeps running.
	// This is an actual missed scheduling horizon, not a changed completion badge.
	await page.evaluate(() => { const until = performance.now() + 1_300; while (performance.now() < until) { /* blocked UI task */ } });
	await expect(page.getByTestId('listening-status')).toHaveText('Unable to play');
	const failed = await exportTake(page);
	expect(failed.playback.status).toBe('error');
	expect(failed.completion).toBe('partial');
	expect(failed.playback.provenance?.engine).toBe('causal-rolling');
	expect(failed.playback.provenance!.committedBars).toBeLessThan(52);
	const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(review).toHaveAttribute('max', String(Math.min(failed.playback.barIndex!, failed.playback.provenance!.committedBars - 1)));
	await review.press('Home');
	const revisited = await exportTake(page);
	const { review: selected, ...unchanged } = revisited;
	expect(selected?.barIndex).toBe(0);
	expect(unchanged).toEqual(failed);

	const stoppedStarts = await sourceStarts(page);
	await page.waitForTimeout(1_200);
	expect(await sourceStarts(page)).toBe(stoppedStarts);
	await assertNoMicrophone(page);
	await playToBar(page);
	await page.getByTestId('listening-stop').click();
});

for (const style of ['swing', 'straight'] as const) {
	test(`${style} explains an actual shared piano arrival in the sounding bar`, async ({ page }) => {
		await setup(page);
		await page.getByTestId('listening-key').selectOption('F#');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		await playToBar(page, 4);
		expect(await soundingBar(page)).toBe(4);
		await expect(page.getByTestId('musician-piano')).toContainText('Chord 1 arrival: shared catch with bass and drums');
		await assertDecisionClock(page, undefined, 140);
		const take = await exportTake(page);
		causalProvenance(take.playback);
		const generated = take.playback.generated!;
		const plan = generated.ensemblePlan!.bars[4];
		expect(plan.piano).toMatchObject({ maxAttacks: 1, arrival: { action: 'catch', accentId: 'arrival:4' } });
		expect(generated.ensemblePlan!.bars[3].setupFor).toEqual(plan.coordinatedAccent);
		const caught = generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 4);
		expect(caught).toHaveLength(1);
		expect(caught[0].absBeat).toBe(16);
		const bass = generated.bassEvents.find(event => event.absBeat === 16)!;
		expect(caught[0].time).toBe(bass.time);
		const accents = generated.drumEvents.filter(event => event.absBeat === 16 && event.role === 'accent');
		expect(accents.length).toBeGreaterThan(0);
		expect(accents.every(event => event.time === caught[0].time)).toBe(true);
		expect(generated.ensembleDevelopment!.pianoVoicings!.filter(entry => entry.arrivalId === 'arrival:4'))
			.toMatchObject([{ time: caught[0].time, absBeat: 16, notes: caught[0].notes }]);
		await page.getByTestId('listening-stop').click();
		await assertNoMicrophone(page);
	});
}

test('explains an actual scalar bass continuation across a real chord change', async ({ page }) => {
	test.setTimeout(50_000);
	await setup(page);
	await page.getByTestId('listening-key').selectOption('F');
	await page.getByTestId('listening-tempo').fill('200');
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 40_000 }).toBe(23);
	await expect(page.getByTestId('musician-bass')).toContainText('Quarter-note line continues downward through the chord change');
	await assertDecisionClock(page, undefined, 200);
	const take = await exportTake(page);
	causalProvenance(take.playback);
	const generated = take.playback.generated!;
	const trace = generated.ensembleDevelopment!.bassContinuations!.find(entry => entry.barIndex === 23)!;
	expect(trace).toMatchObject({ barIndex: 23, boundaryAbsBeat: 92, direction: 'down' });
	expect(trace.notes.map(note => [note.absBeat, note.midi])).toEqual([[91, 39], [92, 38], [93, 36]]);
	for (const note of trace.notes) {
		expect(generated.bassEvents).toContainEqual(expect.objectContaining({ ...note }));
	}
	expect(generated.bassEvents.filter(event => event.absBeat >= 91 && event.absBeat <= 93).map(event => event.absBeat))
		.toEqual([91, 92, 93]);
	await page.getByTestId('listening-stop').click();
	await assertNoMicrophone(page);
});

for (const style of ['swing', 'straight'] as const) {
	test(`${style} shows one accepted piano reply and the drummer's commentary space`, async ({ page }) => {
		test.setTimeout(50_000);
		await setup(page);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('F#');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 40_000 }).toBe(18);
		await expect(page.getByTestId('musician-piano')).toContainText('Answer the drum phrase from bar 18 with one chord');
		await expect(page.getByTestId('musician-drums')).toContainText('Leave commentary space for the piano answer');
		await assertDecisionClock(page, undefined, 140);
		const take = await exportTake(page);
		causalProvenance(take.playback);
		const generated = take.playback.generated!;
		const answer = generated.ensembleDevelopment!.pianoAnswers!.find(entry => entry.barIndex === 18)!;
		expect(answer).toMatchObject({ version: 1, barIndex: 18, source: { barIndex: 17 }, replyOffset: 2.5, drumCommentary: 'space' });
		expect(answer.source.hits.map(hit => hit.absBeat)).toEqual([69.5, 71.5]);
		for (const hit of answer.source.hits) expect(generated.drumEvents).toContainEqual(hit);
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 18)).toEqual([answer.attack]);
		expect(answer.attack.absBeat).toBe(74.5);
		expect(answer.attack.velocity).toBe(65);
		expect(answer.attack.duration).toBeCloseTo(style === 'swing' ? 0.3 : 0.20535714285714288);
		expect(generated.drumEvents.filter(event => Math.floor(event.absBeat / 4) === 18 && event.role === 'commentary')).toEqual([]);
		await page.getByTestId('listening-stop').click();
		await assertNoMicrophone(page);
	});
}

test('shows the actual piano top and its phrase target in the returning head', async ({ page }) => {
	test.setTimeout(125_000);
	await setup(page);
	await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
	await page.getByTestId('listening-key').selectOption('Eb');
	await page.getByTestId('listening-tempo').fill('140');
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 110_000 }).toBe(57);
	await expect(page.getByTestId('musician-piano')).toContainText('Chord 1 top-note target: B♭3; actual top: C4');
	await assertDecisionClock(page, undefined, 140);
	const take = await exportTake(page);
	causalProvenance(take.playback);
	const generated = take.playback.generated!;
	const trace = generated.ensembleDevelopment!.pianoVoicings!.find(entry => entry.absBeat === 231.5)!;
	expect(trace.notes).toEqual([51, 53, 58, 60]);
	expect(trace.decision).toMatchObject({
		requestedFamily: 'rootless-b', resolvedFamily: 'rootless-b',
		guideMotion: 2, commonTones: [60], totalMovement: 26,
		topLine: { targetMidi: 58, actualMidi: 60, distance: 2, eligible: true }
	});
	expect(generated.compEvents).toContainEqual(expect.objectContaining({ time: trace.time, absBeat: trace.absBeat, notes: trace.notes }));
	expect(generated.compEvents.find(event => event.absBeat === 223.5)?.notes).toEqual([55, 60]);
	await page.getByTestId('listening-stop').click();
	await assertNoMicrophone(page);
});

for (const style of ['swing', 'straight'] as const) {
	test(`${style} leaves a piano breath for the actual returning drum phrase`, async ({ page }) => {
		test.setTimeout(55_000);
		await setup(page);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('F#');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(19);
		await expect(page.getByTestId('musician-piano')).toContainText('Leave a breath while the drum phrase returns');
		await assertDecisionClock(page, undefined, 140);
		const take = await exportTake(page);
		causalProvenance(take.playback);
		const generated = take.playback.generated!;
		const recovery = generated.ensembleDevelopment!.pianoRecoveries!.find(entry => entry.barIndex === 19)!;
		expect(recovery).toMatchObject({
			barIndex: 19, action: 'space', reason: 'after_drum_reply', originalMaxAttacks: 1, effectiveMaxAttacks: 0,
			source: { barIndex: 18 }, returningDrums: { motifId: 'drum-motif:16:17', sourceBar: 17 }, acceptedAttacks: []
		});
		const answer = generated.ensembleDevelopment!.pianoAnswers!.find(entry => entry.barIndex === 18)!;
		expect(answer.source.barIndex).toBe(17);
		expect(answer.source.hits.map(hit => hit.absBeat)).toEqual([69.5, 71.5]);
		for (const hit of answer.source.hits) expect(generated.drumEvents).toContainEqual(hit);
		expect(recovery.source.attack).toEqual(answer.attack);
		expect(generated.compEvents).toContainEqual(recovery.source.attack);
		expect(recovery.source.attack.absBeat).toBe(74.5);
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 19)).toEqual([]);
		expect(recovery.returningDrums!.hits.map(hit => [hit.absBeat, hit.drum])).toEqual([[77.5, 'snare'], [79.5, 'kick']]);
		for (const hit of recovery.returningDrums!.hits) expect(generated.drumEvents).toContainEqual(hit);
		await page.getByTestId('listening-stop').click();
		await assertNoMicrophone(page);
	});
}

test('shows Bossa native chord targets without importing Swing dialogue', async ({ page }) => {
	test.setTimeout(55_000);
	await setup(page);
	await page.getByTestId('listening-tune').selectOption('ls-mankunku-blues');
	await page.getByTestId('listening-key').selectOption('F#');
	await page.getByTestId('listening-style').selectOption('bossa-nova');
	await page.getByTestId('listening-tempo').fill('140');
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(19);
	const piano = page.getByTestId('musician-piano');
	await expect(piano).toContainText('Chord 1 top-note target: B♭4; actual top: B4');
	await expect(piano).toContainText('Chord 2 top-note target: B♭4; actual top: B♭4');
	await expect(piano).toContainText('The native bossa comping pattern keeps its rhythmic character.');
	await expect(piano).not.toContainText('Answer the drum phrase');
	await expect(piano).not.toContainText('Leave a breath while the drum phrase returns');
	await assertDecisionClock(page, undefined, 140);
	const take = await exportTake(page);
	causalProvenance(take.playback);
	const generated = take.playback.generated!;
	const first = generated.ensembleDevelopment!.pianoVoicings!.find(entry => entry.absBeat === 77)!;
	const second = generated.ensembleDevelopment!.pianoVoicings!.find(entry => entry.absBeat === 78.5)!;
	expect(first.notes).toEqual([56, 63, 64, 71]);
	expect(first.decision).toMatchObject({ requestedFamily: 'rootless-a', resolvedFamily: 'rootless-a',
		guideMotion: null, commonTones: [56], totalMovement: 16,
		topLine: { targetMidi: 70, actualMidi: 71, distance: 1, eligible: true } });
	expect(second.notes).toEqual([56, 63, 64, 70]);
	expect(second.decision).toMatchObject({ requestedFamily: 'rootless-b', resolvedFamily: 'rootless-b',
		guideMotion: 1, commonTones: [56, 63, 64], totalMovement: 1,
		topLine: { targetMidi: 70, actualMidi: 70, distance: 0, eligible: true } });
	for (const trace of [first, second]) expect(generated.compEvents)
		.toContainEqual(expect.objectContaining({ time: trace.time, absBeat: trace.absBeat, notes: trace.notes }));
	expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 19).map(event => event.absBeat)).toEqual([77, 78.5]);
	expect(generated.compEvents.find(event => event.absBeat === 73.5)?.notes).toEqual([56, 61, 66]);
	expect(generated.ensembleDevelopment!.pianoAnswers).toBeUndefined();
	expect(generated.ensembleDevelopment!.pianoRecoveries).toBeUndefined();
	await page.getByTestId('listening-stop').click();
	await assertNoMicrophone(page);
});


test('reviews a marked Bossa passage after stopping without changing the take or restarting audio', async ({ page }) => {
	test.setTimeout(75_000);
	await setup(page);
	await page.getByTestId('listening-key').selectOption('F#');
	await page.getByTestId('listening-style').selectOption('bossa-nova');
	await page.getByTestId('listening-tempo').fill('140');
	await page.getByTestId('listening-play').click();
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(19);
	const atMark = await exportTake(page);
	await page.getByLabel('Listening note', { exact: true }).fill('Bossa top line');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	await expect.poll(() => soundingBar(page), { timeout: 12_000 }).toBeGreaterThanOrEqual(23);
	await page.getByTestId('listening-stop').click();
	const before = await exportTake(page);
	expect(before.marks).toEqual([{ barIndex: 19, elapsedBeats: expect.any(Number), note: 'Bossa top line' }]);
	expect(before.review).toBeUndefined();
	expect(before.playback.barIndex).toBeGreaterThanOrEqual(23);
	const starts = await sourceStarts(page);
	const slider = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(slider).toBeVisible({ timeout: 1_500 });
	const maximum = Math.min(before.playback.barIndex!, before.playback.provenance!.committedBars - 1, 51);
	await expect(slider).toHaveAttribute('max', String(maximum));
	await page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true }).click();
	await expect(slider).toBeFocused();
	await expect(slider).toHaveValue('19');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 20.*Solo 1/);
	await expect(page.getByText('Reviewing bar 20 · Scheduled evidence', { exact: true })).toBeVisible();
	await expect(page.getByTestId('musician-piano')).toContainText('Chord 1 top-note target: B♭4; actual top: B4');
	await expect(page.getByTestId('musician-piano')).toContainText('Chord 2 top-note target: B♭4; actual top: B♭4');
	await expect(page.getByRole('button', { name: 'Mark this bar', exact: true })).toBeDisabled();
	const marked = await exportTake(page);
	expect(marked.review).toEqual({ barIndex: 19, decisions: atMark.decisions });
	const { review: _review, ...unchanged } = marked;
	expect(unchanged).toEqual(before);
	await slider.fill('15');
	await slider.press('ArrowRight');
	await expect(slider).toHaveValue('16');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 17.*Solo 1/);
	const silent = Array.from({ length: maximum }, (_, index) => index + 1).find(bar =>
		!before.playback.generated!.compEvents.some(event => Math.floor(parseInt(event.time, 10) / before.playback.ppq / 4) === bar));
	expect(silent).toBeDefined();
	await slider.fill(String(silent! - 1));
	await slider.press('ArrowRight');
	await expect(page.getByTestId('musician-piano')).toContainText('0 scheduled events');
	await slider.press('Home');
	await expect(slider).toHaveValue('0');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 1.*Head in/);
	await slider.press('End');
	await expect(slider).toHaveValue(String(maximum));
	const final = await exportTake(page);
	const { review: _lastReview, ...stillUnchanged } = final;
	expect(stillUnchanged).toEqual(before);
	await page.waitForTimeout(700);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
	await page.getByTestId('listening-play').click();
	await expect(slider).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true })).toHaveCount(0);
	await expect.poll(() => soundingBar(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
	await assertDecisionClock(page, undefined, 140);
	await page.getByTestId('listening-stop').click();
	await page.getByTestId('listening-tempo').fill('180');
	await page.getByTestId('listening-tempo').press('Tab');
	await expect(slider).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toHaveText('Ready to listen');
});


test('listens to an existing local AABA tune book chart with captured bridge evidence', async ({ page }) => {
	test.setTimeout(45_000);
	await seedTunes(page, [LOCAL_LISTENING_AABA]);
	await setup(page);
	const picker = page.getByTestId('listening-tune');
	await expect(picker.locator(`option[value="${LOCAL_LISTENING_AABA.id}"]`))
		.toHaveText(LOCAL_LISTENING_AABA.title, { timeout: 2000 });
	await picker.selectOption(LOCAL_LISTENING_AABA.id);
	await page.getByTestId('listening-key').selectOption('D');
	await expect(page.locator('.transport')).toContainText('128 bars');
	await expect(page.locator('.chords')).toContainText('DΔ7');
	await expect(page.locator('.chords')).toContainText('GΔ7');
	await playToBar(page);
	const opening = await exportTake(page);
	const phrase = opening.playback.params!.phrase;
	expect(phrase.name).toBe(LOCAL_LISTENING_AABA.title);
	expect(phrase.source).toBe('user');
	expect(opening.session.source).toEqual({ id: LOCAL_LISTENING_AABA.id, title: LOCAL_LISTENING_AABA.title, composer: LOCAL_LISTENING_AABA.composer, source: 'user' });
	expect(phrase.key).toBe('D');
	expect(phrase.notes).toEqual([]);
	expect(phrase.performanceForm!.totalBars).toBe(128);
	expect(phrase.performanceForm!.choruses.map(({ role, startBar, endBarExclusive }) => ({ role, startBar, endBarExclusive })))
		.toEqual([
			{ role: 'head', startBar: 0, endBarExclusive: 32 },
			{ role: 'solo', startBar: 32, endBarExclusive: 64 },
			{ role: 'solo', startBar: 64, endBarExclusive: 96 },
			{ role: 'head', startBar: 96, endBarExclusive: 128 }
		]);
	expect(opening.session.bars.filter(bar => bar.context.isSectionFirstBar).map(bar => bar.sectionLabel))
		.toEqual(Array.from({ length: 4 }, () => ['A', 'A', 'B', 'A']).flat());
	expect(opening.playback.provenance!.committedBars).toBeLessThan(128);
	// A later edit of the stored chart cannot rewrite the already captured take.
	await page.evaluate((original) => {
		const edited = structuredClone(original);
		edited.title = 'Later library edit';
		edited.sections[2].label = 'Changed bridge';
		edited.sections[2].harmony[0].chord.root = 'B';
		localStorage.setItem('mankunku:user-tunes', JSON.stringify([edited]));
	}, LOCAL_LISTENING_AABA);
	await expect.poll(() => soundingBar(page), { timeout: 20_000, intervals: [25] }).toBe(16);
	await assertDecisionClock(page);
	await page.getByLabel('Listening note', { exact: true }).fill('First bridge');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	await expect.poll(() => soundingBar(page), { timeout: 5000, intervals: [25] }).toBeGreaterThanOrEqual(18);
	await page.getByTestId('listening-stop').click();
	const stopped = await exportTake(page);
	assertCommittedPrefix(opening.playback, stopped.playback);
	expect(stopped.playback.params).toEqual(opening.playback.params);
	expect(stopped.session).toEqual(opening.session);
	expect(stopped.marks).toEqual([{ barIndex: 16, elapsedBeats: expect.any(Number), note: 'First bridge' }]);
	const starts = await sourceStarts(page);
	await page.getByRole('button', { name: 'Bar 17 · First bridge', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveValue('16');
	await expect(page.getByTestId('listening-position')).toContainText('Head in · B');
	const reviewed = await exportTake(page);
	const { review, ...unchanged } = reviewed;
	expect(unchanged).toEqual(stopped);
	expect(review!.barIndex).toBe(16);
	expect(review!.decisions).toHaveLength(3);
	expect(stopped.session.bars[16].chordSymbols).toEqual(['GΔ7']);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
});

test('explains unavailable local arrangements without truncating or starting audio', async ({ page }) => {
	const invalidMeter = { ...LOCAL_LISTENING_AABA, id: 'e2e-listening-waltz', title: 'Local waltz', timeSignature: [3, 4] };
	const malformed = { ...LOCAL_LISTENING_AABA, id: 'e2e-listening-invalid', title: 'Local incomplete chart', sections: [] };
	await seedTunes(page, [LOCAL_LISTENING_AABA, invalidMeter, malformed]);
	await setup(page);
	const picker = page.getByTestId('listening-tune');
	await picker.selectOption(LOCAL_LISTENING_AABA.id);
	const solos = page.getByTestId('listening-choruses');
	for (const count of ['3', '4']) {
		await solos.selectOption(count);
		await expect(solos).toHaveValue(count);
		await expect(page.getByTestId('listening-unavailable')).toContainText(/128/);
		await expect(page.getByTestId('listening-play')).toBeDisabled();
	}
	await solos.selectOption('1');
	await expect(page.locator('.transport')).toContainText('96 bars');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await solos.selectOption('2');
	await expect(page.locator('.transport')).toContainText('128 bars');
	for (const [id, reason] of [[invalidMeter.id, /4\/4/], [malformed.id, /chart|section|valid/i]] as const) {
		await picker.selectOption(id);
		await expect(page.getByTestId('listening-unavailable')).toContainText(reason);
		await expect(page.getByTestId('listening-play')).toBeDisabled();
		await expect(page.getByRole('region', { name: 'Tune form', exact: true })).toHaveCount(0);
	}
	expect(await sourceStarts(page)).toBe(0);
	await assertNoMicrophone(page);
	await picker.selectOption('ls-mankunku-blues');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await expect(page.getByTestId('listening-unavailable')).toHaveCount(0);
	await expect(page.locator('.transport')).toContainText('52 bars');
	await page.getByTestId('blind-open').click();
	await expect(page.locator(`option[value="${LOCAL_LISTENING_AABA.id}"]`)).toHaveCount(0);
});

test('completes all 128 bars of a local tune book AABA on the real audio clock', async ({ page }) => {
	test.setTimeout(165_000);
	await seedTunes(page, [LOCAL_LISTENING_AABA]);
	await setup(page);
	await page.getByTestId('listening-tune').selectOption(LOCAL_LISTENING_AABA.id);
	await playToBar(page);
	const opening = await exportTake(page);
	for (const boundary of [32, 64, 96]) {
		await expect.poll(() => soundingBar(page), { timeout: 36_000 }).toBeGreaterThanOrEqual(boundary);
		await assertDecisionClock(page);
	}
	await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 36_000 });
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 5000 });
	const complete = await exportTake(page);
	assertCommittedPrefix(opening.playback, complete.playback);
	expect(complete.playback.provenance!.committedBars).toBe(128);
	expect(complete.playback.barIndex).toBe(127);
	expect(complete.playback.elapsedBeats).toBe(512);
	expect(complete.playback.durationBeats).toBe(512);
	expect(complete.playback.audioTime! - complete.playback.startAudioTime!).toBeGreaterThanOrEqual(130.5);
	expect(complete.completion).toBe('complete');
	expect(complete.session.bars).toHaveLength(128);
	const starts = await sourceStarts(page);
	const slider = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(slider).toHaveAttribute('max', '127');
	await slider.fill('112');
	await expect(page.getByTestId('listening-position')).toContainText('Head out · B');
	const reviewed = await exportTake(page);
	const { review, ...unchanged } = reviewed;
	expect(unchanged).toEqual(complete);
	expect(review!.barIndex).toBe(112);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
});

for (const style of ['swing', 'straight']) {
	test(`${style} recalls an actually played piano cell across solo phrases and preserves its review evidence`, async ({ page }) => {
		test.setTimeout(70_000);
		await setup(page);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('Eb');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(20);
		const source = await exportTake(page);
		const sourceEvents = source.playback.generated!.compEvents.filter(event => Math.floor(event.absBeat / 4) === 20);
		expect(sourceEvents).toHaveLength(1);
		expect(sourceEvents[0].absBeat).toBe(81.5);
		expect(source.playback.generated!.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 20)?.recall).toBeUndefined();
		await expect.poll(() => soundingBar(page), { timeout: 12_000 }).toBe(24);
		await expect(page.getByTestId('musician-piano')).toContainText('Recall the piano cell from bar 21');
		await assertDecisionClock(page, undefined, 140);
		const recalled = await exportTake(page);
		assertCommittedPrefix(source.playback, recalled.playback);
		const generated = recalled.playback.generated!;
		const trace = generated.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 24)!;
		expect(trace.recall).toMatchObject({ source: { barIndex: 20, phraseStartBar: 20, figureId: 'and2-only', attacks: sourceEvents } });
		expect(trace.recall!.attacks).toEqual(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 24));
		expect(trace.recall!.attacks.map(event => event.absBeat)).toEqual([97.5]);
		for (const attack of [...trace.recall!.source.attacks, ...trace.recall!.attacks]) expect(generated.compEvents).toContainEqual(attack);
		await page.getByTestId('listening-stop').click();
		const stopped = await exportTake(page);
		const starts = await sourceStarts(page);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await review.fill('20');
		await expect(page.getByTestId('musician-piano')).not.toContainText('Recall the piano cell from bar 21');
		await review.fill('24');
		await expect(page.getByTestId('musician-piano')).toContainText('Recall the piano cell from bar 21');
		const reviewed = await exportTake(page);
		expect(reviewed.playback).toEqual(stopped.playback);
		expect(reviewed.review?.barIndex).toBe(24);
		expect(await sourceStarts(page)).toBe(starts);
		await assertNoMicrophone(page);
	});
}

for (const style of ['swing', 'straight']) {
	test(`${style} keeps the Blues bass approach anchored through live playback and review`, async ({ page }) => {
		test.setTimeout(70_000);
		await setup(page);
		await page.getByTestId('listening-tune').selectOption('ls-mankunku-blues');
		await page.getByTestId('listening-key').selectOption('C');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 55_000 }).toBe(26);
		await assertDecisionClock(page, undefined, 140);
		const current = await exportTake(page);
		await expect.poll(() => soundingBar(page), { timeout: 5_000 }).toBe(27);
		await page.getByTestId('listening-stop').click();
		const stopped = await exportTake(page);
		assertCommittedPrefix(current.playback, stopped.playback);
		const route = stopped.playback.generated!.bassEvents.filter(event => event.absBeat >= 104 && event.absBeat <= 108);
		expect(route.map(event => event.absBeat)).toEqual([104, 105, 106, 107, 108]);
		expect([route[0].midi, route[3].midi, route[4].midi]).toEqual([48, 37, 36]);
		for (let i = 1; i < route.length; i++) expect(Math.abs(route[i].midi - route[i - 1].midi)).toBeLessThanOrEqual(5);
		expect([0, 2, 3, 4, 7, 9]).toContain(route[1].midi % 12);
		expect([0, 4, 7, 10]).toContain(route[2].midi % 12);
		expect(causalProvenance(stopped.playback).dispatches.filter(dispatch =>
			dispatch.status === 'late' || dispatch.status === 'failed')).toEqual([]);
		const starts = await sourceStarts(page);
		await page.getByRole('slider', { name: 'Review decisions', exact: true }).fill('26');
		const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
		const notes = route.slice(0, 4).map(event => `${names[event.midi % 12]}${Math.floor(event.midi / 12) - 1}`);
		await expect(page.getByTestId('musician-bass')).toContainText(`Notes: ${notes.join(' · ')}`);
		const reviewed = await exportTake(page);
		expect(reviewed.playback).toEqual(stopped.playback);
		expect(reviewed.review?.barIndex).toBe(26);
		expect(await sourceStarts(page)).toBe(starts);
		await assertNoMicrophone(page);
	});
}

test('keeps terminal arrangement opt-in and resets it outside supported listening styles', async ({ page }) => {
	await setup(page);
	const ending = page.getByTestId('listening-ending');
	await expect(ending).toBeVisible();
	await expect(ending).toHaveValue('continue');
	await ending.selectOption({ label: 'Hold & release' });
	await expect(ending).toHaveValue('hold-release');
	for (const style of ['bossa-nova']) {
		await page.getByTestId('listening-style').selectOption(style);
		await expect(ending).toHaveCount(0);
		await expect(page.getByTestId('listening-play')).toBeEnabled();
	}
	await page.getByTestId('listening-style').selectOption('ballad');
	await expect(ending).toBeVisible();
	await expect(ending).toHaveValue('continue');
	await ending.selectOption('hold-release');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-style').selectOption('swing');
	await expect(ending).toHaveValue('continue');
	await ending.selectOption({ label: 'Hold & release' });
	await page.getByTestId('listening-mode').selectOption('original');
	await expect(ending).toHaveCount(0);
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-mode').selectOption('coordinated');
	await expect(ending).toHaveValue('continue');
	expect(await sourceStarts(page)).toBe(0);
	await assertNoMicrophone(page);
});

for (const style of ['swing', 'straight'] as const) {
	test(`${style} completes the declared form and reviews an actual shared terminal hold`, async ({ page }) => {
		test.setTimeout(90_000);
		await setup(page);
		await page.getByTestId('listening-key').selectOption('C');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-ending').selectOption('hold-release');
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 65_000 }).toBeGreaterThanOrEqual(49);
		const beforeEnding = await exportTake(page);
		expect(beforeEnding.playback.status).toBe('playing');
		expect(beforeEnding.completion).toBe('partial');
		expect(beforeEnding.playback.durationBeats).toBe(208);
		expect(beforeEnding.playback.params!.ending).toBe('hold-release');
		await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 10_000 });
		await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
		await expect(page.getByTestId('listening-status')).toContainText(/complete/i, { timeout: 10_000 });
		const finished = await exportTake(page);
		expect(finished.completion).toBe('complete');
		expect(finished.playback.status).toBe('completed');
		expect(finished.playback.elapsedBeats).toBe(208);
		expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(54.5);
		expect(causalProvenance(finished.playback)).toMatchObject({ committedBars: 52, totalBars: 52,
			committedThroughTick: 39936, sessionStatus: 'complete' });
		expect(causalProvenance(finished.playback).dispatches.every(entry => entry.status === 'played')).toBe(true);
		assertCommittedPrefix(beforeEnding.playback, finished.playback);
		const generated = finished.playback.generated!;
		const bass = generated.bassEvents.filter(event => event.absBeat >= 204);
		const piano = generated.compEvents.filter(event => event.absBeat >= 204);
		const drums = generated.drumEvents.filter(event => event.absBeat >= 204);
		expect(bass).toHaveLength(1);
		expect(piano).toHaveLength(1);
		expect(drums.map(event => event.drum)).toEqual(['ride', 'kick']);
		expect([...bass, ...piano, ...drums].map(event => event.time)).toEqual(Array(4).fill('39168i'));
		expect(bass[0].midi % 12).toBe(0);
		expect(bass[0].duration).toBe(.5);
		expect(piano[0].duration).toBe(.5);
		expect(generated.ensembleDevelopment!.terminalArrangements).toEqual([
			expect.objectContaining({ status: 'accepted', barIndex: 51, bass: bass[0], piano: piano[0], drums })
		]);
		const starts = await sourceStarts(page);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await review.press('Home');
		await expect(page.getByTestId('musician-piano')).not.toContainText('Scheduled ending: shared final chord, then space');
		await review.press('End');
		await expect(page.getByTestId('musician-piano')).toContainText('Scheduled ending: shared final chord, then space');
		await expect(page.getByTestId('musician-bass')).toContainText('Hold the final chord');
		await expect(page.getByTestId('musician-bass').locator('.player-title small')).toHaveText('Mark the form');
		await expect(page.getByTestId('musician-drums')).toContainText('Catch the final chord');
		const reviewed = await exportTake(page);
		expect(reviewed.review?.barIndex).toBe(51);
		expect(reviewed.playback).toEqual(finished.playback);
		expect(await sourceStarts(page)).toBe(starts);
		await assertNoMicrophone(page);
		const capture = process.env.MUSICALITY_TERMINAL_CAPTURE_DIR;
		if (capture) {
			for (const instrument of ['bass', 'piano', 'drums']) {
				const details = page.getByTestId(`musician-${instrument}`).locator('details');
				if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
			}
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${capture}/final-role-desktop.png`, fullPage: true });
			await page.getByTestId('musician-bass').screenshot({ path: `${capture}/final-role-bass-card.png` });
			await page.setViewportSize({ width: 390, height: 844 });
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${capture}/final-role-mobile.png`, fullPage: true });
		}
	});
}

test('explains an unavailable terminal hold without blocking ordinary tune-book listening', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	const tune = structuredClone(LOCAL_LISTENING_AABA);
	tune.id = 'e2e-split-ending';
	tune.title = 'Split final harmony';
	const last = tune.sections.at(-1)!;
	last.harmony[last.harmony.length - 1].duration = [1, 2];
	last.harmony.push({ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian',
		startOffset: [15, 2], duration: [1, 2], symbol: 'G7' });
	await seedTunes(page, [tune]);
	await observeAudio(page);
	await stubCdnInstrumentSamples(page);
	await page.goto('/musicality');
	await page.getByTestId('listening-tune').selectOption(tune.id);
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-ending').selectOption('hold-release');
	await expect(page.getByTestId('listening-ending-unavailable')).toBeVisible();
	await expect(page.getByTestId('listening-play')).toBeDisabled();
	expect(await sourceStarts(page)).toBe(0);
	await page.getByTestId('listening-ending').selectOption('continue');
	await expect(page.getByTestId('listening-ending-unavailable')).toHaveCount(0);
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	expect(await sourceStarts(page)).toBe(0);
	await assertNoMicrophone(page);
});

test('Ballad completes its native quiet terminal hold and preserves review evidence', async ({ page }) => {
	test.setTimeout(90_000);
	await setup(page);
	await page.getByTestId('listening-key').selectOption('C');
	await page.getByTestId('listening-style').selectOption('ballad');
	await page.getByTestId('listening-ending').selectOption('hold-release');
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 65_000 }).toBeGreaterThanOrEqual(49);
	const beforeEnding = await exportTake(page);
	expect(beforeEnding.playback.status).toBe('playing');
	expect(beforeEnding.completion).toBe('partial');
	expect(beforeEnding.playback.durationBeats).toBe(208);
	expect(beforeEnding.playback.params!.ending).toBe('hold-release');
	await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 10_000 });
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toContainText(/complete/i, { timeout: 10_000 });
	const finished = await exportTake(page);
	expect(finished.completion).toBe('complete');
	expect(finished.playback.status).toBe('completed');
	expect(finished.playback.elapsedBeats).toBe(208);
	expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(54.5);
	expect(causalProvenance(finished.playback)).toMatchObject({ committedBars: 52, totalBars: 52,
		committedThroughTick: 39936, sessionStatus: 'complete' });
	expect(causalProvenance(finished.playback).dispatches.every(entry => entry.status === 'played')).toBe(true);
	assertCommittedPrefix(beforeEnding.playback, finished.playback);
	const generated = finished.playback.generated!;
	const bass = generated.bassEvents.filter(event => event.absBeat >= 204);
	const piano = generated.compEvents.filter(event => event.absBeat >= 204);
	const drums = generated.drumEvents.filter(event => event.absBeat >= 204);
	expect(bass).toHaveLength(1);
	expect(piano).toHaveLength(1);
	expect(drums.filter(event => event.drum === 'ride')).toHaveLength(1);
	expect(drums.filter(event => event.drum === 'kick').length).toBeLessThanOrEqual(1);
	expect(drums.every(event => ['ride', 'kick'].includes(event.drum) && event.velocity < .3)).toBe(true);
	expect(piano[0].velocity).toBeLessThanOrEqual(56);
	expect(generated.ensemblePlan!.bars[51].terminalArrangement?.profile).toBe('ballad-v1');
	expect(generated.ensembleDevelopment!.pianoVoicings!.every(voice => !voice.decision.topLine)).toBe(true);
	expect(generated.ensembleDevelopment).not.toHaveProperty('pianoAnswers');
	expect(generated.ensembleDevelopment).not.toHaveProperty('pianoRecoveries');
	expect([...bass, ...piano, ...drums].map(event => event.time)).toEqual(Array(2 + drums.length).fill('39168i'));
	expect(bass[0].midi % 12).toBe(0);
	expect(bass[0].duration).toBe(.5);
	expect(piano[0].duration).toBe(.5);
	expect(generated.ensembleDevelopment!.terminalArrangements).toEqual([
		expect.objectContaining({ status: 'accepted', barIndex: 51, bass: bass[0], piano: piano[0], drums })
	]);
	const starts = await sourceStarts(page);
	const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await review.press('Home');
	await expect(page.getByTestId('musician-piano')).not.toContainText('Scheduled ending: shared final chord, then space');
	await review.press('End');
	await expect(page.getByTestId('musician-piano')).toContainText('Scheduled ending: shared final chord, then space');
	await expect(page.getByTestId('musician-bass')).toContainText('Hold the final chord');
	await expect(page.getByTestId('musician-bass').locator('.player-title small')).toHaveText('Mark the form');
	await expect(page.getByTestId('musician-drums')).toContainText('Catch the final chord');
	const reviewed = await exportTake(page);
	expect(reviewed.review?.barIndex).toBe(51);
	expect(reviewed.playback).toEqual(finished.playback);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
	const capture = process.env.MUSICALITY_BALLAD_TERMINAL_CAPTURE_DIR;
	if (capture) {
		for (const instrument of ['bass', 'piano', 'drums']) {
			const details = page.getByTestId(`musician-${instrument}`).locator('details');
			if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
		}
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({ path: `${capture}/final-role-desktop.png`, fullPage: true });
		await page.getByTestId('musician-bass').screenshot({ path: `${capture}/final-role-bass-card.png` });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.screenshot({ path: `${capture}/final-role-mobile.png`, fullPage: true });
	}
});
