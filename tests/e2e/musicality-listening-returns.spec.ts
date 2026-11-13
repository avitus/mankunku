import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { awaitPianoEvidence, assertTopNoteLines, setup, exportTake, causalProvenance, assertCommittedPrefix, assertNoMicrophone, soundingBar, assertDecisionClock } from './fixtures/musicality-listening';

test('shows the actual piano top and its phrase target in the returning head', async ({ page }) => {
	test.setTimeout(125_000);
	await seedTunes(page, [WHEN_THE_SAINTS]);
	await setup(page);
	await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
	await page.getByTestId('listening-key').selectOption('Eb');
	await page.getByTestId('listening-tempo').fill('140');
	requireRealtimeAudio(page);
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
	const opening = await exportTake(page);
	const headOut = opening.playback.params!.phrase.performanceForm!.choruses.at(-1)!;
	expect(headOut.role).toBe('head');
	// The first returning-head bar whose chord missed its phrase target: the card
	// must say so, naming the top that actually sounded.
	const missed = /Chord \d top-note target: ([A-G]♭?\d); actual top: (?!\1)[A-G]♭?\d/;
	const shown = await awaitPianoEvidence(page, missed, headOut.startBar, 110_000);
	expect(shown.bar).toBeLessThan(headOut.endBarExclusive);
	await assertDecisionClock(page, undefined, 140);
	const take = await exportTake(page);
	causalProvenance(take.playback);
	assertCommittedPrefix(opening.playback, take.playback);
	const lines = assertTopNoteLines(shown.text, take.playback, shown.bar);
	expect(lines.some(line => line.target !== line.actual)).toBe(true);
	await page.getByTestId('listening-stop').click();
	await assertNoMicrophone(page);
});

for (const style of ['swing', 'straight'] as const) {
	test(`${style} keeps the piano out while the actual drum phrase returns after its reply`, async ({ page }) => {
		test.setTimeout(55_000);
		await seedTunes(page, [WHEN_THE_SAINTS]);
		// The same Saints-in-G take as the piano reply above. Under the released
		// accompaniment the bar after a reply is already planned silent (phrase
		// resolution), so the recovery has nothing to withhold: none of 12,960
		// scanned takes produced the older "Leave a breath" space, and the card
		// must not claim one.
		await setup(page, 6);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('G');
		await page.getByTestId('listening-style').selectOption(style);
		await page.getByTestId('listening-tempo').fill('140');
		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(18);
		const piano = page.getByTestId('musician-piano');
		await expect(piano).toContainText('No new chord attack');
		await expect(piano).toContainText('Comping decision: ensemble silence');
		await expect(piano).not.toContainText('Leave a breath while the drum phrase returns');
		await assertDecisionClock(page, undefined, 140);
		const take = await exportTake(page);
		causalProvenance(take.playback);
		const generated = take.playback.generated!;
		const recovery = generated.ensembleDevelopment!.pianoRecoveries!.find(entry => entry.barIndex === 18)!;
		expect(recovery).toMatchObject({
			barIndex: 18, action: 'none', reason: 'already_silent', originalMaxAttacks: 0, effectiveMaxAttacks: 0,
			source: { barIndex: 17 }, returningDrums: { motifId: 'drum-motif:16:16', sourceBar: 16 }, acceptedAttacks: []
		});
		const answer = generated.ensembleDevelopment!.pianoAnswers!.find(entry => entry.barIndex === 17)!;
		expect(answer.source.barIndex).toBe(16);
		expect(answer.source.hits.map(hit => hit.absBeat)).toEqual([64.5, 66.5]);
		for (const hit of answer.source.hits) expect(generated.drumEvents).toContainEqual(hit);
		expect(recovery.source.attack).toEqual(answer.attack);
		expect(generated.compEvents).toContainEqual(recovery.source.attack);
		expect(recovery.source.attack.absBeat).toBe(69.5);
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === 18)).toEqual([]);
		expect(recovery.returningDrums!.hits.map(hit => [hit.absBeat, hit.drum])).toEqual([[73.5, 'snare'], [75.5, 'snare']]);
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
	requireRealtimeAudio(page);
	await page.getByTestId('listening-play').click();
	await expect.poll(() => soundingBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
	const opening = await exportTake(page);
	const firstSolo = opening.playback.params!.phrase.performanceForm!.choruses.find(chorus => chorus.role === 'solo')!;
	// The first solo bar whose two native chords both carry a phrase target.
	const shown = await awaitPianoEvidence(page, /Chord 1 top-note target: .*Chord 2 top-note target: /s, firstSolo.startBar, 45_000);
	expect(shown.text).toContain('The native bossa comping pattern keeps its rhythmic character.');
	expect(shown.text).not.toContain('Answer the drum phrase');
	expect(shown.text).not.toContain('Leave a breath while the drum phrase returns');
	await assertDecisionClock(page, undefined, 140);
	const take = await exportTake(page);
	causalProvenance(take.playback);
	assertCommittedPrefix(opening.playback, take.playback);
	const generated = take.playback.generated!;
	const lines = assertTopNoteLines(shown.text, take.playback, shown.bar);
	expect(lines.map(line => line.chord)).toEqual([1, 2]);
	// Bossa's two-chord cell: the bar holds exactly the chords the card listed.
	expect(generated.compEvents.filter(event => Math.floor(parseInt(event.time, 10) / take.playback.ppq / 4) === shown.bar)).toHaveLength(2);
	expect(generated.ensembleDevelopment!.pianoAnswers).toBeUndefined();
	expect(generated.ensembleDevelopment!.pianoRecoveries).toBeUndefined();
	await page.getByTestId('listening-stop').click();
	await assertNoMicrophone(page);
});
