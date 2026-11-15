import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { stubCdnInstrumentSamples } from './fixtures/audio';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { LOCAL_LISTENING_AABA } from '../fixtures/musicality-local-aaba';
import { observeAudio, setup, exportTake, causalProvenance, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts } from './fixtures/musicality-listening';

test('keeps terminal arrangement opt-in and resets it across style or mode changes', async ({ page }) => {
	await setup(page);
	const ending = page.getByTestId('listening-ending');
	await expect(ending).toBeVisible();
	await expect(ending).toHaveValue('continue');
	await ending.selectOption({ label: 'Hold & release' });
	await expect(ending).toHaveValue('hold-release');
	await page.getByTestId('listening-style').selectOption('bossa-nova');
	await expect(ending).toBeVisible();
	await expect(ending).toHaveValue('continue');
	await ending.selectOption('hold-release');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-style').selectOption('ballad');
	await expect(ending).toBeVisible();
	await expect(ending).toHaveValue('continue');
	await ending.selectOption('hold-release');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-style').selectOption('swing');
	await expect(ending).toHaveValue('continue');
	await ending.selectOption({ label: 'Hold & release' });
	await page.getByTestId('listening-mode').getByRole('button', {name:'Original',exact:true}).click();
	await expect(ending).toHaveCount(0);
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await page.getByTestId('listening-mode').getByRole('button', {name:'Coordinated',exact:true}).click();
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
		requireRealtimeAudio(page);
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
	requireRealtimeAudio(page);
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
