import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { setup, exportTake, causalProvenance, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts, assertDecisionClock } from './fixtures/musicality-listening';

for (const style of ['swing', 'straight']) {
	test(`${style} displaces the played piano cell within its solo phrase and preserves its review evidence`, async ({ page }) => {
		test.setTimeout(95_000);
		await seedTunes(page, [WHEN_THE_SAINTS]);
		await setup(page, 1);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('C');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('120');
		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 65_000 }).toBe(24);
		const source = await exportTake(page);
		const sourceEvents = source.playback.generated!.compEvents.filter(event => Math.floor(event.absBeat / 4) === 24);
		// Common tones can split one chord onset across two separately gated voices.
		expect([...new Set(sourceEvents.map(event => event.absBeat))]).toEqual([97.5, 98.5]);
		const statement = source.playback.generated!.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 24)!;
		expect(statement).toMatchObject({ transform: 'statement', sourceFigureId: 'offbeat-hold' });
		expect(statement.motifId).toBeTruthy();
		await expect.poll(() => soundingBar(page), { timeout: 14_000 }).toBe(26);
		const piano = page.getByTestId('musician-piano');
		await expect(piano).toContainText('Shift the comping idea');
		await assertDecisionClock(page, undefined, 120);
		const displaced = await exportTake(page);
		assertCommittedPrefix(source.playback, displaced.playback);
		const generated = displaced.playback.generated!;
		const trace = generated.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 26)!;
		expect(trace).toMatchObject({ motifId: statement.motifId, sourceFigureId: statement.sourceFigureId, transform: 'displace', displacementBeats: -0.5 });
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 26).map(event => event.absBeat)).toEqual([105, 106]);
		await page.getByTestId('listening-stop').click();
		const stopped = await exportTake(page);
		const starts = await sourceStarts(page);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await review.fill('24');
		await expect(piano).toContainText('Development: statement');
		await review.fill('26');
		await expect(piano).toContainText('Shift the comping idea');
		const reviewed = await exportTake(page);
		expect(reviewed.playback).toEqual(stopped.playback);
		expect(reviewed.review?.barIndex).toBe(26);
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
		requireRealtimeAudio(page);
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
