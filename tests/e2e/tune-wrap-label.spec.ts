import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { seg, section, sheet } from '../helpers/tune-fixtures';

// The reported Autumn in New York shape: a last-bar ii-V resolves to the
// opening minor tonic. This small fixture also puts both ends on one system
// at desktop width, and on separate systems at phone width.
const tune = sheet({
	id: 'wrap-label', title: 'Wraparound label', key: 'G',
	sections: [section({ bars: 4, harmony: [
		seg('G', 'min7', [0, 1], [1, 1]),
		seg('Ab', 'maj7', [1, 1], [2, 1]),
		seg('A', 'min7b5', [3, 1], [1, 2]),
		seg('D', '7', [7, 2], [1, 2])
	] })]
});

for (const width of [1440, 390]) {
	test(`wraparound progression is named in its final-bar start at ${width}px`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 1000 });
		await seedOnboardedAnonymous(page);
		await seedTunes(page, [tune]);
		await page.goto('/tunes/wrap-label/practice');
		const label = page.locator('svg text.range-marker-label').filter({ hasText: /^Short ii/ });
		await expect(label).toHaveCount(1);
		const placement = await label.evaluate(el => {
			const wrapper = el.closest('.abcjs-staff-wrapper')!;
			const barlines = [...wrapper.querySelectorAll<SVGGElement>('g.abcjs-bar')];
			return {
				x: Number(el.getAttribute('x')),
				barlines: barlines.map(bar => bar.getBBox().x).sort((a, b) => a - b),
				lastSystem: wrapper === [...el.closest('svg')!.querySelectorAll('.abcjs-staff-wrapper')].at(-1)
			};
		});
		expect(placement.lastSystem).toBe(true);
		expect(placement.x).toBeGreaterThanOrEqual(placement.barlines.at(-2)!);
		expect(placement.x).toBeLessThan(placement.barlines.at(-1)!);
		await page.screenshot({ path: info.outputPath(`wrap-label-${width}.png`), fullPage: true });
	});
}
