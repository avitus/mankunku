import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedUserLicks, seedStorage } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';

for (const splitBar of [false, true]) {
	test(`practice chart widths follow beats with ${splitBar ? 'half-bar chords' : 'three full bars'}`, async ({ page }) => {
		await seedOnboardedAnonymous(page);
		const id = 'e2e-bar-widths';
		const bars = splitBar ? 2 : 3;
		await seedUserLicks(page, [{
			id, name: 'Bar width regression', timeSignature: [4, 4], key: 'C',
			// Uneven engraving density must not become uneven chord-chart timing.
			notes: [
				{ pitch: 60, duration: [1, 1], offset: [0, 1] },
				...(!splitBar ? [{ pitch: 64, duration: [1, 1], offset: [1, 1] }] : []),
				...Array.from({ length: 8 }, (_, i) => ({
					pitch: [60, 62, 64, 65, 67, 69, 71, 72][i], duration: [1, 8], offset: [(bars - 1) * 8 + i, 8]
				}))
			],
			harmony: [],
			difficulty: { level: 20, pitchComplexity: 20, rhythmComplexity: 20, lengthBars: bars },
			category: splitBar ? 'short-ii-V-I-major' : 'major-chord', tags: [], source: 'user-entered'
		}]);
		await seedStorage(page, {
			'user-lick-tags': { [id]: [splitBar ? 'prog:ii-V-I-major' : 'prog:major-vamp'] },
			'lick-unlock-count': { [id]: 2 },
			'lick-practice-progress': { [id]: {
				C: { currentTempo: 60, passCount: 3 },
				Bb: { currentTempo: 60, passCount: 0, rollingScore: 0.5 }
			} }
		});
		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto(`/licks/${id}`);
		await page.getByRole('button', { name: 'Practice', exact: true }).click();
		// A neighbouring sheet supplies the unequal bar geometry that used to
		// override every chord-only row in the stack.
		await expect(page.getByTestId('lead-sheet-row').locator('.abcjs-notehead').first()).toBeVisible();
		const cells = page.locator('.row[data-key="C"] .chord-cell');
		const beats = splitBar ? [2, 2, 4] : [4, 4, 4];
		await expect(cells).toHaveCount(beats.length);
		expect(await cells.evaluateAll(elements => elements.map(element =>
			element.querySelectorAll('.beat-dots > div').length
		))).toEqual(beats);
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 1000 });
			await expect.poll(async () => cells.evaluateAll((elements, durations) => {
				const rowWidth = elements[0].parentElement!.getBoundingClientRect().width;
				return Math.max(...elements.map((element, i) => Math.abs(
					element.getBoundingClientRect().width - rowWidth * durations[i] / durations.reduce((total, beats) => total + beats, 0)
				)));
			}, beats)).toBeLessThan(0.1);
			await page.screenshot({ path: test.info().outputPath(`bar-widths-${width}.png`) });
		}
	});
}
