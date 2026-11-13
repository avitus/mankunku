import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { setup, exportTake, causalProvenance, assertNoMicrophone, soundingBar, playToBar, assertDecisionClock } from './fixtures/musicality-listening';

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
	requireRealtimeAudio(page);
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
		await seedTunes(page, [WHEN_THE_SAINTS]);
		// Saints in G under seed 6: the first take found in which the released
		// accompaniment still answers a drum phrase with a single chord (8 of the
		// 8,064 takes scanned over keys, tempos and seeds 0–23 hold an answer).
		await setup(page, 6);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('G');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 40_000 }).toBe(17);
		await expect(page.getByTestId('musician-piano')).toContainText('Answer the drum phrase from bar 17 with one chord');
		await expect(page.getByTestId('musician-drums')).toContainText('Leave commentary space for the piano answer');
		await assertDecisionClock(page, undefined, 140);
		const take = await exportTake(page);
		causalProvenance(take.playback);
		const generated = take.playback.generated!;
		const answer = generated.ensembleDevelopment!.pianoAnswers!.find(entry => entry.barIndex === 17)!;
		expect(answer).toMatchObject({ version: 1, barIndex: 17, source: { barIndex: 16 }, replyOffset: 1.5, drumCommentary: 'space' });
		expect(answer.source.hits.map(hit => hit.absBeat)).toEqual([64.5, 66.5]);
		for (const hit of answer.source.hits) expect(generated.drumEvents).toContainEqual(hit);
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 17)).toEqual([answer.attack]);
		expect(answer.attack.absBeat).toBe(69.5);
		expect(answer.attack.velocity).toBe(59);
		expect(answer.attack.duration).toBeCloseTo(0.3);
		expect(generated.drumEvents.filter(event => Math.floor(event.absBeat / 4) === 17 && event.role === 'commentary')).toEqual([]);
		await page.getByTestId('listening-stop').click();
		await assertNoMicrophone(page);
	});
}
