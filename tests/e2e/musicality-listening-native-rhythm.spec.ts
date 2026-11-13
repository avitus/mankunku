import { test, expect } from './fixtures/test';
import { setup, exportTake, causalProvenance, assertCommittedPrefix, assertActualFeedback, assertNoMicrophone, playToBar, assertDecisionClock } from './fixtures/musicality-listening';

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
