import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { setup, exportTake, causalProvenance, assertCommittedPrefix, assertActualFeedback, assertNoMicrophone, soundingBar, sourceStarts, playToBar, assertDecisionClock } from './fixtures/musicality-listening';

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
	// A chord the keyboard decorations rebuilt (a 9–1 resolution once its root
	// sounds, a fourth stack, a spread voicing) carries no rootless receipt
	// since 0.10; every receipt that IS there must count the notes that sounded.
	const textured = voicings!.filter(entry => entry.decision.rootlessTexture);
	expect(textured.length).toBeGreaterThan(voicings!.length / 2);
	for (const entry of textured) {
		expect(entry.decision.rootlessTexture!.noteCount).toBe(entry.notes.length);
		if (entry.decision.rootlessTexture!.applied === 'three') expect(entry.notes).toHaveLength(3);
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
	await page.getByTestId('listening-mode').getByRole('button', {name:'Original',exact:true}).click();
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
	await page.getByTestId('listening-mode').getByRole('button', {name:'Coordinated',exact:true}).click();
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
		requireRealtimeAudio(page);
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
	test.setTimeout(75_000);
	await seedTunes(page, [WHEN_THE_SAINTS]);
	// Saints in F at 160 under seed 4. Since the accompaniment policy (engine
	// 0.3, 2026-11-08) a drum statement usually THINS the piano to one light
	// chord (1,301 of the 1,349 yields in 12,960 scanned takes); this is one of
	// the 48 where the bar had a single attack to give up and falls silent.
	// No synthetic soloist or microphone.
	await setup(page, 4);
	await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
	await page.getByTestId('listening-key').selectOption('F');
	await page.getByTestId('listening-tempo').fill('160');
	await playToBar(page);
	await expect.poll(() => soundingBar(page), { timeout: 50_000, intervals: [50] }).toBe(25);
	await expect(page.getByTestId('musician-piano')).toContainText('Drum statement in bar 25:');
	await expect(page.getByTestId('musician-piano')).toContainText('Scheduled result: no new chord attack');
	const { playback } = await exportTake(page);
	expect(playback.barIndex).toBe(25);
	assertActualFeedback(playback);
	expect(playback.generated!.ensembleDevelopment!.pianoFeedback![25]).toMatchObject({
		barIndex: 25, action: 'yield', reason: 'drum_statement', source: { barIndex: 24 },
		originalMaxAttacks: 1, effectiveMaxAttacks: 0, acceptedAttacks: []
	});
	await assertDecisionClock(page, undefined, 160);
	await assertNoMicrophone(page);
	await page.getByTestId('listening-stop').click();
});

test('an early committed bar survives a bounded UI stall across the former decision window', async ({ page }) => {
	test.setTimeout(100_000);
	await setup(page);
	await playToBar(page);
	const initial = await exportTake(page);
	const barStart = initial.playback.startAudioTime! + 11; // 240 BPM: one second per bar.
	const stall = await page.evaluate(async (barStart) => {
		const contexts = (window as unknown as { __listeningAudio: { contexts: BaseAudioContext[] } }).__listeningAudio.contexts;
		const context = contexts.find(context => context.state === 'running');
		if (!context) throw new Error('No running audio clock');
		return await new Promise<{ before: number; after: number }>(resolve => {
			setTimeout(() => {
				const before = context.currentTime;
				const until = performance.now() + 180;
				while (performance.now() < until) { /* bounded UI task, real audio clock continues */ }
				resolve({ before, after: context.currentTime });
			}, Math.max(0, (barStart - 0.28 - context.currentTime) * 1000));
		});
	}, barStart);
	await test.info().attach('bounded-pump-stall', { body: JSON.stringify({ barStart, ...stall }), contentType: 'application/json' });
	// Prove that the interruption covers the OLD trigger (.235 s before bar)
	// and passes the unchanged render-safe deadline (.160 s before bar).
	expect(stall.before).toBeLessThan(barStart - .235);
	expect(stall.before).toBeGreaterThan(barStart - .36);
	expect(stall.after).toBeGreaterThan(barStart - .160);
	await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 65_000 });
	const completed = await exportTake(page);
	expect(completed.playback.status).toBe('completed');
	expect(completed.playback.provenance!.committedBars).toBe(52);
	expect(causalProvenance(completed.playback).dispatches.every(dispatch => dispatch.status === 'played')).toBe(true);
	assertCommittedPrefix(initial.playback, completed.playback);
	await expect(page.getByRole('alert')).toHaveCount(0);
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
