import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { setup, exportTake, causalProvenance, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts, assertDecisionClock } from './fixtures/musicality-listening';

for (const style of ['swing', 'straight']) {
	test(`${style} recalls an actually played piano cell across solo phrases and preserves its review evidence`, async ({ page }) => {
		test.setTimeout(95_000);
		await seedTunes(page, [WHEN_THE_SAINTS]);
		// Saints in C at 120 under seed 1: the first take found in which the released
		// accompaniment recalls a cell (336 of the 8,064 takes scanned do).
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
		expect(sourceEvents.map(event => event.absBeat)).toEqual([97.5, 98.5]);
		expect(source.playback.generated!.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 24)?.recall).toBeUndefined();
		await expect.poll(() => soundingBar(page), { timeout: 14_000 }).toBe(28);
		await expect(page.getByTestId('musician-piano')).toContainText('Recall the piano cell from bar 25');
		await assertDecisionClock(page, undefined, 120);
		const recalled = await exportTake(page);
		assertCommittedPrefix(source.playback, recalled.playback);
		const generated = recalled.playback.generated!;
		const trace = generated.ensembleDevelopment!.pianoMotifs!.find(motif => motif.barIndex === 28)!;
		expect(trace.recall).toMatchObject({ source: { barIndex: 24, phraseStartBar: 24, figureId: 'offbeat-hold', attacks: sourceEvents } });
		expect(trace.recall!.attacks).toEqual(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 28));
		expect(trace.recall!.attacks.map(event => event.absBeat)).toEqual([113.5, 114.5]);
		for (const attack of [...trace.recall!.source.attacks, ...trace.recall!.attacks]) expect(generated.compEvents).toContainEqual(attack);
		await page.getByTestId('listening-stop').click();
		const stopped = await exportTake(page);
		const starts = await sourceStarts(page);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await review.fill('24');
		await expect(page.getByTestId('musician-piano')).not.toContainText('Recall the piano cell from bar 25');
		await review.fill('28');
		await expect(page.getByTestId('musician-piano')).toContainText('Recall the piano cell from bar 25');
		const reviewed = await exportTake(page);
		expect(reviewed.playback).toEqual(stopped.playback);
		expect(reviewed.review?.barIndex).toBe(28);
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
