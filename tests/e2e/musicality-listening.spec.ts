import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import type { CausalListeningProvenance, ListeningSnapshot } from '../../src/lib/musicality/listening-player';

interface ListeningEvidence {
	completion: 'complete' | 'partial';
	playback: ListeningSnapshot;
	marks: { barIndex: number; elapsedBeats: number; note: string }[];
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
	await expect(page.getByTestId('listening-performance-arc')).not.toBeVisible();
	await page.getByTestId('listening-mode').selectOption('coordinated');
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
