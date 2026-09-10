import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Pickup (anacrusis) bars. A tune whose first section is the lone unlabeled
 * one-bar section every importer writes for a pickup must engrave that bar
 * SHORT, hanging off the front of the form's first system — not as a full
 * bar justified across a system of its own — with the printed bar numbers
 * excluding it and the boxed section letter seated over the first full bar.
 */

/** The import shape BEFORE the `pickupLength` field existed: legacy rows must render right too. */
const LEGACY_PICKUP_TUNE = [
	{
		id: 'e2e-pickup-tune',
		title: 'Pickup Test',
		key: 'C',
		timeSignature: [4, 4],
		tags: [],
		sections: [
			{ label: '', bars: 1, notes: [{ pitch: 55, duration: [1, 4], offset: [3, 4] }], harmony: [] },
			{
				label: 'A',
				bars: 8,
				notes: Array.from({ length: 8 }, (_, b) => ({ pitch: 60, duration: [1, 1], offset: [b, 1] })),
				harmony: [
					{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [8, 1], symbol: 'CΔ7' }
				]
			}
		],
		source: 'imported-musescore'
	}
];

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
});

test('a legacy imported pickup shares the first system and bar numbers skip it', async ({ page }) => {
	await seedTunes(page, LEGACY_PICKUP_TUNE);
	await page.goto('/tunes/e2e-pickup-tune');
	const svg = page.locator('.abcjs-container svg').first();
	await expect(svg).toBeVisible();

	const report = await page.evaluate(() => {
		const wrappers = [...document.querySelectorAll('.abcjs-container svg g.abcjs-staff-wrapper')];
		return wrappers.map((w) => ({
			bars: w.querySelectorAll('g.abcjs-bar').length,
			barNumber: (w.querySelector('.abcjs-bar-number, text.abcjs-bar-number')?.textContent ?? '').trim()
		}));
	});
	// Pickup + A1–A4, then A5–A8: two systems, not three.
	expect(report).toHaveLength(2);
	// System 1 holds the pickup's barline plus four full bars' barlines.
	expect(report[0].bars).toBe(5);
	// abcjs counts the anacrusis as bar 1 by default; the restamp fixes it.
	expect(report[1].barNumber).toBe('5');
});

test('the editor adds a pickup that fills no column and seats the letter over the first full bar', async ({ page }) => {
	await page.goto('/tunes/editor');
	await expect(page.locator('[data-bar-pos="0:0"]')).toBeVisible();

	// Hit rects are inserted at the front of the wrapper, so read them left → right by x.
	const firstSystemBars = () =>
		page.evaluate(() => {
			const wrapper = document.querySelector('.abcjs-container svg g.abcjs-staff-wrapper');
			return [...(wrapper?.querySelectorAll('rect.bar-hit') ?? [])]
				.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
				.map((r) => r.getAttribute('data-bar-pos'));
		});
	// The density auto-pick decides how many full bars share the first line
	// (six for an empty sheet); the pickup must not displace any of them.
	const before = await firstSystemBars();
	const fullBars = before.length;

	// The section list lives in the collapsed Setup card.
	await page.getByRole('button', { name: /Setup Key/ }).click();
	await page.getByLabel('Pickup bar length').selectOption('1/4');
	// The pickup is a new unlabeled section 0; the form's A section is now index 1.
	await expect(page.locator(`[data-bar-pos="1:${fullBars - 1}"]`)).toBeVisible();

	expect(await firstSystemBars()).toEqual([
		'0:0',
		...Array.from({ length: fullBars }, (_, b) => `1:${b}`)
	]);

	const geometry = await page.evaluate(() => {
		const wrapper = document.querySelector('.abcjs-container svg g.abcjs-staff-wrapper');
		if (!wrapper) return null;
		const pickup = wrapper.querySelector('rect.bar-hit[data-bar-pos="0:0"]')?.getBoundingClientRect();
		const firstFull = wrapper.querySelector('rect.bar-hit[data-bar-pos="1:0"]')?.getBoundingClientRect();
		const part = (wrapper.querySelector('g.abcjs-part') ?? wrapper.querySelector('text.abcjs-part'))?.getBoundingClientRect();
		return pickup && firstFull && part
			? { pickupWidth: pickup.width, firstFullWidth: firstFull.width, firstFullLeft: firstFull.left, partLeft: part.left }
			: null;
	});
	expect(geometry).not.toBeNull();
	// The one-beat pickup engraves narrower than a full bar…
	expect(geometry!.pickupWidth).toBeLessThan(geometry!.firstFullWidth * 0.75);
	// …and the boxed A sits over the first FULL bar, not over the pickup.
	expect(geometry!.partLeft).toBeGreaterThanOrEqual(geometry!.firstFullLeft - 1);
});
