import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous } from './fixtures/storage';

/**
 * Rhythm Changes, the curated chart added 2026-10-25, is the first with
 * beamed eighths in a stacked [2] and with a bar of high beamed eighths under
 * two chords. Its first render showed both engraving faults those exposed.
 * Settings seed a tenor sax, so the chart is written in C.
 */

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await page.goto('/tunes/ls-rhythm-changes');
	await expect(page.getByRole('heading', { name: 'Rhythm Changes', exact: true })).toBeVisible();
	await expect.poll(async () => page.locator('g.abcjs-ending-align').count()).toBeGreaterThan(0);
});

test('beams in the stacked [2] meet the stems they join', async ({ page }) => {
	// The alignment pass selected `g.abcjs-beam`, which abcjs never draws: the
	// beam stayed where abcjs put it, two hundred px left of its two eighths.
	const misses = await page.evaluate(() => {
		const system = document.querySelector('g.abcjs-ending-align')!.closest('g.abcjs-staff-wrapper')!;
		const notes = [...system.querySelectorAll('g.abcjs-note')].map((n) => n.getBoundingClientRect());
		const onNote = (x: number): boolean => notes.some((n) => x >= n.left - 1 && x <= n.right + 1);
		const beams = [...system.querySelectorAll('path.abcjs-beam-elem')].map((b) => b.getBoundingClientRect());
		return {
			beams: beams.length,
			ends: beams.flatMap((b) => [b.left, b.right]).filter((x) => !onNote(x))
		};
	});
	expect(misses.beams, 'the [2] has a beamed pair').toBeGreaterThan(0);
	expect(misses.ends, 'beam ends off their stems').toEqual([]);
});

test('chords over a bar of high beamed eighths stay on their beats', async ({ page }) => {
	// Bar 4 (written D-7 G7 over `cBGE DFAc`): the chords were lifted clear of
	// the beams, then shoved right past every note within a staff space below,
	// to the barline and beyond.
	const bars = await page.evaluate(() => {
		const wrapper = document.querySelector('g.abcjs-staff-wrapper')!;
		const lines = [...wrapper.querySelectorAll('g.abcjs-bar')]
			.map((b) => b.getBoundingClientRect().left)
			.sort((a, b) => a - b);
		const chords = [...wrapper.querySelectorAll('text.abcjs-chord')].map((c) => c.getBoundingClientRect().left);
		return lines.slice(0, -1).map((left, i) => {
			const right = lines[i + 1];
			return chords.filter((x) => x >= left && x < right).map((x) => (x - left) / (right - left));
		});
	});
	// Four bars of I-vi | ii-V | iii-VI | ii-V: two chords each, on beats 1 and 3.
	expect(bars).toHaveLength(4);
	for (const [i, seats] of bars.entries()) {
		expect(seats, `bar ${i + 1} chord seats`).toHaveLength(2);
		expect(seats[0], `bar ${i + 1} first chord`).toBeLessThan(0.3);
		expect(seats[1], `bar ${i + 1} second chord`).toBeGreaterThan(0.35);
		expect(seats[1], `bar ${i + 1} second chord`).toBeLessThan(0.75);
	}
});
