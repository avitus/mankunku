import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { WHEN_THE_SAINTS } from '../fixtures/tunes/when-the-saints';
import { setup, exportTake, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts, assertDecisionClock } from './fixtures/musicality-listening';

for (const witness of [
	// Seeds: the first in 0–299 whose take holds each color (11 and 102 of 300 do).
	{ tempo: 70, seed: 19, sourceBar: 16, replyBar: 17, sourceBeat: 66.5, drum: 'snare', velocity: 46 },
	{ tempo: 80, seed: 2, sourceBar: 17, replyBar: 18, sourceBeat: 71, drum: 'crossstick', velocity: 42 }
]) {
	test(`Ballad ${witness.tempo} answers its actual ${witness.drum} color with a native late pad and silent review`, async ({ page }) => {
		test.setTimeout(100_000);
		await seedTunes(page, [WHEN_THE_SAINTS]);
		await setup(page, witness.seed);
		await page.getByTestId('listening-tune').selectOption('ls-when-the-saints');
		await page.getByTestId('listening-key').selectOption('D');
		await page.getByTestId('listening-style').selectOption('ballad');
		await page.getByTestId('listening-tempo').fill(String(witness.tempo));
		requireRealtimeAudio(page);
		await page.getByTestId('listening-play').click();
		await expect.poll(() => soundingBar(page), { timeout: 75_000 }).toBe(witness.sourceBar);
		const before = await exportTake(page);
		const label = `Answer the drum color from bar ${witness.sourceBar + 1} with a late pad`;
		await expect(page.getByTestId('musician-piano')).not.toContainText(label);
		await expect.poll(() => soundingBar(page), { timeout: 10_000 }).toBe(witness.replyBar);
		await expect(page.getByTestId('musician-piano')).toContainText(label);
		await expect.poll(async () => page.evaluate(tempo => {
			const origin = Number(document.querySelector('[data-testid="listening-position"]')!.getAttribute('data-start-audio-time'));
			const contexts = (window as unknown as { __listeningAudio: { contexts: BaseAudioContext[] } }).__listeningAudio.contexts;
			return ((contexts.at(-1)?.currentTime ?? 0) - origin) * tempo / 60;
		}, witness.tempo), { timeout: 6_000 }).toBeGreaterThan(witness.replyBar * 4 + 2.2);
		await assertDecisionClock(page, undefined, witness.tempo);
		const replied = await exportTake(page);
		assertCommittedPrefix(before.playback, replied.playback);
		const generated = replied.playback.generated!;
		const receipt = generated.ensembleDevelopment!.nativeBalladReplies!.find(entry => entry.barIndex === witness.replyBar)!;
		expect(receipt).toMatchObject({ profile: 'ballad-late-pad-v1', source: { barIndex: witness.sourceBar,
			hit: { absBeat: witness.sourceBeat, drum: witness.drum, role: 'commentary' } }, drumCommentary: 'space' });
		expect(generated.drumEvents).toContainEqual(receipt.source.hit);
		expect(generated.compEvents.filter(event => Math.floor(event.absBeat / 4) === witness.replyBar)).toEqual([receipt.attack]);
		expect(receipt.attack.absBeat).toBe(witness.replyBar * 4 + 2);
		expect(receipt.attack.velocity).toBe(witness.velocity);
		expect(receipt.attack.duration).toBeCloseTo(1.8 * 60 / witness.tempo, 10);
		expect(generated.drumEvents.filter(event => Math.floor(event.absBeat / 4) === witness.replyBar && event.role === 'commentary')).toEqual([]);
		const sourceTrace = generated.ensembleDevelopment!.drumPhrases.find(entry => entry.barIndex === witness.sourceBar)!;
		expect(sourceTrace.commentary).toMatchObject({ source: 'vocabulary', sourceId: 'ballad-color', transform: 'fallback' });
		for (const field of ['pianoAnswers', 'pianoRecoveries'] as const) expect(generated.ensembleDevelopment![field] ?? []).toEqual([]);
		await page.getByTestId('listening-stop').click();
		const stopped = await exportTake(page);
		const starts = await sourceStarts(page);
		const review = page.getByRole('slider', { name: 'Review decisions', exact: true });
		await review.fill(String(witness.sourceBar));
		await expect(page.getByTestId('musician-piano')).not.toContainText(label);
		await review.fill(String(witness.replyBar));
		await expect(page.getByTestId('musician-piano')).toContainText(label);
		const reviewed = await exportTake(page);
		expect(reviewed.playback).toEqual(stopped.playback);
		expect(reviewed.review?.barIndex).toBe(witness.replyBar);
		expect(await sourceStarts(page)).toBe(starts);
		await assertNoMicrophone(page);
	});
}
