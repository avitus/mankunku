import { test, expect } from './fixtures/test';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import bossaTerminalBefore from '../fixtures/audio/bossa-terminal-before.json' with { type: 'json' };
import { setup, exportTake, causalProvenance, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts } from './fixtures/musicality-listening';

for (const key of ['C', 'F#'] as const) {
	test(`Bossa ${key} completes its selected native clave-side terminal hold and preserves review evidence`, async ({ page }) => {
		test.setTimeout(125_000);
		await setup(page);
		await page.getByTestId('listening-key').selectOption(key);
		await page.getByTestId('listening-style').selectOption('bossa-nova');
		await page.getByTestId('listening-tempo').fill('140');
		await page.getByTestId('listening-ending').selectOption('hold-release');
		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 105_000 }).toBeGreaterThanOrEqual(49);
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
		expect(finished.playback.audioTime! - finished.playback.startAudioTime!).toBeGreaterThanOrEqual(208 * 60 / 140 + 2.5);
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
		const native = bossaTerminalBefore.witnesses.find(row => row.key === key && row.engine === 'rolling')!;
		expect(drums.map(event => ({ drum: event.drum, velocity: event.velocity }))).toEqual(
			native.lastTwoBars.drumEvents.filter(event => event.absBeat === 204).map(event => ({ drum: event.drum, velocity: event.velocity })));
		expect(drums.map(event => event.drum)).toEqual(key === 'C' ? ['kick', 'hihat', 'crossstick'] : ['kick', 'hihat']);
		expect(generated.drumEvents.filter(event => event.absBeat >= 200 && event.absBeat < 204))
			.toEqual(native.lastTwoBars.drumEvents.filter(event => event.absBeat < 204));
		expect(piano[0].velocity).toBeGreaterThanOrEqual(50);
		expect(piano[0].velocity).toBeLessThanOrEqual(60);
		expect(generated.ensemblePlan!.bars[51].terminalArrangement?.profile).toBe('bossa-v1');
		expect(generated.ensembleDevelopment!.pianoVoicings!.some(voice => voice.decision.topLine)).toBe(true);
		const drumTrace = generated.ensembleDevelopment!.drumPhrases.at(-1)!;
		expect(drumTrace.ride).toMatchObject({ mode: 'none', onsets: [] });
		expect(drumTrace.ride).not.toHaveProperty('voice');
		expect(generated.ensembleDevelopment).not.toHaveProperty('pianoAnswers');
		expect(generated.ensembleDevelopment).not.toHaveProperty('pianoRecoveries');
		expect([...bass, ...piano, ...drums].map(event => event.time)).toEqual(Array(2 + drums.length).fill('39168i'));
		expect(bass[0].midi % 12).toBe(key === 'C' ? 0 : 6);
		expect(bass[0].duration).toBe(120 / 140);
		expect(piano[0].duration).toBe(120 / 140);
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
		await expect(page.getByTestId('musician-drums')).toContainText(key === 'C'
			? 'Kick, stick hat and crossstick catch the closing chord.' : 'Kick and stick hat catch the closing chord.');
		const reviewed = await exportTake(page);
		expect(reviewed.review?.barIndex).toBe(51);
		expect(reviewed.playback).toEqual(finished.playback);
		expect(await sourceStarts(page)).toBe(starts);
		await assertNoMicrophone(page);
		const capture = process.env.MUSICALITY_BOSSA_TERMINAL_CAPTURE_DIR;
		if (capture) {
			for (const instrument of ['bass', 'piano', 'drums']) {
				const details = page.getByTestId(`musician-${instrument}`).locator('details');
				if (!(await details.evaluate(element => (element as HTMLDetailsElement).open))) await details.locator('summary').click();
			}
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${capture}/${key}-final-role-desktop.png`, fullPage: true });
			await page.getByTestId('musician-bass').screenshot({ path: `${capture}/${key}-final-role-bass-card.png` });
			await page.setViewportSize({ width: 390, height: 844 });
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${capture}/${key}-final-role-mobile.png`, fullPage: true });
		}
	});

}
