import { test, expect } from './fixtures/test';
import { seedTunes } from './fixtures/storage';
import { requireRealtimeAudio } from './fixtures/realtime-audio';
import { LOCAL_LISTENING_AABA } from '../fixtures/musicality-local-aaba';
import { assertTopNoteLines, setup, exportTake, assertCommittedPrefix, assertNoMicrophone, soundingBar, sourceStarts, playToBar, assertDecisionClock } from './fixtures/musicality-listening';

test('reviews a marked Bossa passage after stopping without changing the take or restarting audio', async ({ page }) => {
	test.setTimeout(75_000);
	await setup(page);
	await page.getByTestId('listening-key').selectOption('F#');
	await page.getByTestId('listening-style').selectOption('bossa-nova');
	await page.getByTestId('listening-tempo').fill('140');
	requireRealtimeAudio(page);
	await page.getByTestId('listening-play').click();
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect.poll(() => soundingBar(page), { timeout: 45_000 }).toBe(19);
	const atMark = await exportTake(page);
	// The card's own top-note lines for the marked bar, as exported while it sounded.
	const markedLines = atMark.decisions.find(card => card.instrument === 'piano')!.evidence.filter(line => /top-note target/.test(line));
	expect(markedLines).toHaveLength(2);
	assertTopNoteLines(markedLines.join(' '), atMark.playback, 19);
	await page.getByLabel('Listening note', { exact: true }).fill('Bossa top line');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	await expect.poll(() => soundingBar(page), { timeout: 12_000 }).toBeGreaterThanOrEqual(23);
	await page.getByTestId('listening-stop').click();
	const before = await exportTake(page);
	expect(before.marks).toEqual([{ barIndex: 19, elapsedBeats: expect.any(Number), note: 'Bossa top line' }]);
	expect(before.review).toBeUndefined();
	expect(before.playback.barIndex).toBeGreaterThanOrEqual(23);
	const starts = await sourceStarts(page);
	const slider = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(slider).toBeVisible({ timeout: 1_500 });
	const maximum = Math.min(before.playback.barIndex!, before.playback.provenance!.committedBars - 1, 51);
	await expect(slider).toHaveAttribute('max', String(maximum));
	await page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true }).click();
	await expect(slider).toBeFocused();
	await expect(slider).toHaveValue('19');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 20.*Solo 1/);
	await expect(page.getByText('Reviewing bar 20 · Scheduled evidence', { exact: true })).toBeVisible();
	for (const line of markedLines) await expect(page.getByTestId('musician-piano')).toContainText(line);
	await expect(page.getByRole('button', { name: 'Mark this bar', exact: true })).toBeDisabled();
	const marked = await exportTake(page);
	expect(marked.review).toEqual({ barIndex: 19, decisions: atMark.decisions });
	const { review: _review, ...unchanged } = marked;
	expect(unchanged).toEqual(before);
	await slider.fill('15');
	await slider.press('ArrowRight');
	await expect(slider).toHaveValue('16');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 17.*Solo 1/);
	const silent = Array.from({ length: maximum }, (_, index) => index + 1).find(bar =>
		!before.playback.generated!.compEvents.some(event => Math.floor(parseInt(event.time, 10) / before.playback.ppq / 4) === bar));
	expect(silent).toBeDefined();
	await slider.fill(String(silent! - 1));
	await slider.press('ArrowRight');
	await expect(page.getByTestId('musician-piano')).toContainText('0 scheduled events');
	await slider.press('Home');
	await expect(slider).toHaveValue('0');
	await expect(slider).toHaveAttribute('aria-valuetext', /Bar 1.*Head in/);
	await slider.press('End');
	await expect(slider).toHaveValue(String(maximum));
	const final = await exportTake(page);
	const { review: _lastReview, ...stillUnchanged } = final;
	expect(stillUnchanged).toEqual(before);
	await page.waitForTimeout(700);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
	requireRealtimeAudio(page);
	await page.getByTestId('listening-play').click();
	await expect(slider).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true })).toHaveCount(0);
	await expect.poll(() => soundingBar(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
	await assertDecisionClock(page, undefined, 140);
	await page.getByTestId('listening-stop').click();
	await page.getByTestId('listening-tempo').fill('180');
	await page.getByTestId('listening-tempo').press('Tab');
	await expect(slider).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Bar 20 · Bossa top line', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toHaveText('Ready to listen');
});


test('listens to an existing local AABA tune book chart with captured bridge evidence', async ({ page }) => {
	test.setTimeout(45_000);
	await seedTunes(page, [LOCAL_LISTENING_AABA]);
	await setup(page);
	const picker = page.getByTestId('listening-tune');
	await expect(picker.locator(`option[value="${LOCAL_LISTENING_AABA.id}"]`))
		.toHaveText(LOCAL_LISTENING_AABA.title, { timeout: 2000 });
	await picker.selectOption(LOCAL_LISTENING_AABA.id);
	await page.getByTestId('listening-key').selectOption('D');
	await expect(page.locator('.transport')).toContainText('128 bars');
	await expect(page.getByTestId('listening-score')).toContainText('DΔ7');
	await expect(page.getByTestId('listening-score')).toContainText('GΔ7');
	await playToBar(page);
	const opening = await exportTake(page);
	const phrase = opening.playback.params!.phrase;
	expect(phrase.name).toBe(LOCAL_LISTENING_AABA.title);
	expect(phrase.source).toBe('user');
	expect(opening.session.source).toEqual({ id: LOCAL_LISTENING_AABA.id, title: LOCAL_LISTENING_AABA.title, composer: LOCAL_LISTENING_AABA.composer, source: 'user' });
	expect(phrase.key).toBe('D');
	expect(phrase.notes).toEqual([]);
	expect(phrase.performanceForm!.totalBars).toBe(128);
	expect(phrase.performanceForm!.choruses.map(({ role, startBar, endBarExclusive }) => ({ role, startBar, endBarExclusive })))
		.toEqual([
			{ role: 'head', startBar: 0, endBarExclusive: 32 },
			{ role: 'solo', startBar: 32, endBarExclusive: 64 },
			{ role: 'solo', startBar: 64, endBarExclusive: 96 },
			{ role: 'head', startBar: 96, endBarExclusive: 128 }
		]);
	expect(opening.session.bars.filter(bar => bar.context.isSectionFirstBar).map(bar => bar.sectionLabel))
		.toEqual(Array.from({ length: 4 }, () => ['A', 'A', 'B', 'A']).flat());
	expect(opening.playback.provenance!.committedBars).toBeLessThan(128);
	// A later edit of the stored chart cannot rewrite the already captured take.
	await page.evaluate((original) => {
		const edited = structuredClone(original);
		edited.title = 'Later library edit';
		edited.sections[2].label = 'Changed bridge';
		edited.sections[2].harmony[0].chord.root = 'B';
		localStorage.setItem('mankunku:user-tunes', JSON.stringify([edited]));
	}, LOCAL_LISTENING_AABA);
	await expect.poll(() => soundingBar(page), { timeout: 20_000, intervals: [25] }).toBe(16);
	await assertDecisionClock(page);
	await page.getByLabel('Listening note', { exact: true }).fill('First bridge');
	await page.getByRole('button', { name: 'Mark this bar', exact: true }).click();
	await expect.poll(() => soundingBar(page), { timeout: 5000, intervals: [25] }).toBeGreaterThanOrEqual(18);
	await page.getByTestId('listening-stop').click();
	const stopped = await exportTake(page);
	assertCommittedPrefix(opening.playback, stopped.playback);
	expect(stopped.playback.params).toEqual(opening.playback.params);
	expect(stopped.session).toEqual(opening.session);
	expect(stopped.marks).toEqual([{ barIndex: 16, elapsedBeats: expect.any(Number), note: 'First bridge' }]);
	const starts = await sourceStarts(page);
	await page.getByRole('button', { name: 'Bar 17 · First bridge', exact: true }).click();
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveValue('16');
	await expect(page.getByTestId('listening-position')).toContainText('Head in · B');
	const reviewed = await exportTake(page);
	const { review, ...unchanged } = reviewed;
	expect(unchanged).toEqual(stopped);
	expect(review!.barIndex).toBe(16);
	expect(review!.decisions).toHaveLength(3);
	expect(stopped.session.bars[16].chordSymbols).toEqual(['GΔ7']);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
});

test('explains unavailable local arrangements without truncating or starting audio', async ({ page }) => {
	const invalidMeter = { ...LOCAL_LISTENING_AABA, id: 'e2e-listening-waltz', title: 'Local waltz', timeSignature: [3, 4] };
	const malformed = { ...LOCAL_LISTENING_AABA, id: 'e2e-listening-invalid', title: 'Local incomplete chart', sections: [] };
	await seedTunes(page, [LOCAL_LISTENING_AABA, invalidMeter, malformed]);
	await setup(page);
	const picker = page.getByTestId('listening-tune');
	await picker.selectOption(LOCAL_LISTENING_AABA.id);
	const solos = page.getByTestId('listening-choruses');
	for (const count of ['3', '4']) {
		await solos.selectOption(count);
		await expect(solos).toHaveValue(count);
		await expect(page.getByTestId('listening-unavailable')).toContainText(/128/);
		await expect(page.getByTestId('listening-play')).toBeDisabled();
	}
	await solos.selectOption('1');
	await expect(page.locator('.transport')).toContainText('96 bars');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await solos.selectOption('2');
	await expect(page.locator('.transport')).toContainText('128 bars');
	for (const [id, reason] of [[invalidMeter.id, /4\/4/], [malformed.id, /chart|section|valid/i]] as const) {
		await picker.selectOption(id);
		await expect(page.getByTestId('listening-unavailable')).toContainText(reason);
		await expect(page.getByTestId('listening-play')).toBeDisabled();
		await expect(page.getByRole('region', { name: 'Tune form', exact: true })).toHaveCount(0);
	}
	expect(await sourceStarts(page)).toBe(0);
	await assertNoMicrophone(page);
	await picker.selectOption('ls-mankunku-blues');
	await expect(page.getByTestId('listening-play')).toBeEnabled();
	await expect(page.getByTestId('listening-unavailable')).toHaveCount(0);
	await expect(page.locator('.transport')).toContainText('52 bars');
	await page.getByTestId('blind-open').click();
	await expect(page.locator(`option[value="${LOCAL_LISTENING_AABA.id}"]`)).toHaveCount(0);
});

test('completes all 128 bars of a local tune book AABA on the real audio clock', async ({ page }) => {
	test.setTimeout(165_000);
	await seedTunes(page, [LOCAL_LISTENING_AABA]);
	await setup(page);
	await page.getByTestId('listening-tune').selectOption(LOCAL_LISTENING_AABA.id);
	await playToBar(page);
	const opening = await exportTake(page);
	for (const boundary of [32, 64, 96]) {
		await expect.poll(() => soundingBar(page), { timeout: 36_000 }).toBeGreaterThanOrEqual(boundary);
		await assertDecisionClock(page);
	}
	await expect(page.getByTestId('listening-status')).toHaveText('Letting the last chord ring', { timeout: 36_000 });
	await expect(page.getByRole('slider', { name: 'Review decisions', exact: true })).toHaveCount(0);
	await expect(page.getByTestId('listening-status')).toHaveText('Take complete', { timeout: 5000 });
	const complete = await exportTake(page);
	assertCommittedPrefix(opening.playback, complete.playback);
	expect(complete.playback.provenance!.committedBars).toBe(128);
	expect(complete.playback.barIndex).toBe(127);
	expect(complete.playback.elapsedBeats).toBe(512);
	expect(complete.playback.durationBeats).toBe(512);
	expect(complete.playback.audioTime! - complete.playback.startAudioTime!).toBeGreaterThanOrEqual(130.5);
	expect(complete.completion).toBe('complete');
	expect(complete.session.bars).toHaveLength(128);
	const starts = await sourceStarts(page);
	const slider = page.getByRole('slider', { name: 'Review decisions', exact: true });
	await expect(slider).toHaveAttribute('max', '127');
	await slider.fill('112');
	await expect(page.getByTestId('listening-position')).toContainText('Head out · B');
	const reviewed = await exportTake(page);
	const { review, ...unchanged } = reviewed;
	expect(unchanged).toEqual(complete);
	expect(review!.barIndex).toBe(112);
	expect(await sourceStarts(page)).toBe(starts);
	await assertNoMicrophone(page);
});
