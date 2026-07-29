import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Stem-direction regression: abcjs's two-voice `%%score (M H)` layout used to
 * force EVERY melody stem up (parse-time splice in createVoice when voice H is
 * declared without an explicit `stem=`). With `V:H stem=down` in the header,
 * the melody follows the standard single-voice rules: head below the middle
 * line → stem up; at/above the middle line → stem down (abcjs decides beamed
 * groups by the group's average pitch, entirely-one-side groups here so the
 * per-note rule and the group rule coincide).
 *
 * The assertion applies the rule itself to every rendered stem, classifying
 * each notehead by its y against the middle staff line — no per-bar mapping,
 * scale- and browser-independent.
 */

const STEM_TUNE = {
	id: 'e2e-stem-direction-tune',
	title: 'Stem Direction Regression',
	composer: 'E2E',
	key: 'C',
	timeSignature: [4, 4],
	style: 'Medium Swing',
	tags: ['e2e'],
	sections: [
		{
			label: 'A',
			bars: 4,
			notes: [
				// Bar 1 (quarters): written D4, E4, B4 (ON the middle line), G4.
				{ pitch: 48, duration: [1, 4], offset: [0, 1] },
				{ pitch: 50, duration: [1, 4], offset: [1, 4] },
				{ pitch: 57, duration: [1, 4], offset: [1, 2] },
				{ pitch: 53, duration: [1, 4], offset: [3, 4] },
				// Bar 2 (quarters): written A5, C6, B5, A5 — all above the middle.
				{ pitch: 69, duration: [1, 4], offset: [1, 1] },
				{ pitch: 70, duration: [1, 4], offset: [5, 4] },
				{ pitch: 69, duration: [1, 4], offset: [3, 2] },
				{ pitch: 67, duration: [1, 4], offset: [7, 4] },
				// Bar 3 (eighths, beamed): written D4–A4, all below the middle.
				{ pitch: 48, duration: [1, 8], offset: [2, 1] },
				{ pitch: 50, duration: [1, 8], offset: [17, 8] },
				{ pitch: 52, duration: [1, 8], offset: [9, 4] },
				{ pitch: 53, duration: [1, 8], offset: [19, 8] },
				{ pitch: 55, duration: [1, 8], offset: [5, 2] },
				{ pitch: 53, duration: [1, 8], offset: [21, 8] },
				{ pitch: 52, duration: [1, 8], offset: [11, 4] },
				{ pitch: 50, duration: [1, 8], offset: [23, 8] },
				// Bar 4 (eighths, beamed): written A5–D6, all above the middle.
				{ pitch: 67, duration: [1, 8], offset: [3, 1] },
				{ pitch: 69, duration: [1, 8], offset: [25, 8] },
				{ pitch: 70, duration: [1, 8], offset: [13, 4] },
				{ pitch: 72, duration: [1, 8], offset: [27, 8] },
				{ pitch: 70, duration: [1, 8], offset: [7, 2] },
				{ pitch: 69, duration: [1, 8], offset: [29, 8] },
				{ pitch: 70, duration: [1, 8], offset: [15, 4] },
				{ pitch: 72, duration: [1, 8], offset: [31, 8] }
			],
			harmony: [
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [4, 1], symbol: 'Dm7' }
			]
		}
	],
	source: 'user'
};

interface MeasuredStem {
	/** Which way the rule says this stem must point, from its head's position. */
	expected: 'up' | 'down';
	/** Which way the rendered stem actually points. */
	actual: 'up' | 'down';
	/** Head center, in staff spaces above the middle line (for diagnostics). */
	headAboveMiddleSp: number;
}

/** Pair every rendered stem with its notehead and classify both directions. */
async function measureStems(page: import('@playwright/test').Page): Promise<MeasuredStem[]> {
	return page.evaluate(() => {
		const out: MeasuredStem[] = [];
		const svg = document.querySelector('.abcjs-container svg');
		if (!svg) return out;
		for (const wrapper of svg.querySelectorAll('g.abcjs-staff-wrapper')) {
			const staff = wrapper.querySelector('.abcjs-staff');
			if (!staff) continue;
			const staffRect = staff.getBoundingClientRect();
			const spacing = staffRect.height / 4;
			if (!(spacing > 0)) continue;
			const middleY = staffRect.top + 2 * spacing;
			const heads = [...wrapper.querySelectorAll('.abcjs-notehead')].map((h) =>
				h.getBoundingClientRect()
			);
			for (const stemEl of wrapper.querySelectorAll('.abcjs-stem')) {
				const s = stemEl.getBoundingClientRect();
				// The stem attaches at its head's edge: nearest x-overlapping head.
				let head: DOMRect | null = null;
				let best = Infinity;
				for (const h of heads) {
					if (s.right < h.left - 1 || s.left > h.right + 1) continue;
					const d = Math.abs((s.top + s.bottom) / 2 - (h.top + h.bottom) / 2);
					if (d < best) {
						best = d;
						head = h;
					}
				}
				if (!head) continue;
				const headCenter = (head.top + head.bottom) / 2;
				const aboveSp = (middleY - headCenter) / spacing;
				// Rule: below the middle line → up; at (within 0.25 sp) or above → down.
				const expected = aboveSp < -0.25 ? 'up' : 'down';
				const extendsAbove = head.top - s.top;
				const extendsBelow = s.bottom - head.bottom;
				const actual = extendsAbove > extendsBelow ? 'up' : 'down';
				out.push({ expected, actual, headAboveMiddleSp: aboveSp });
			}
		}
		return out;
	});
}

test('melody stems follow the single-voice direction rules despite the chord voice', async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [STEM_TUNE]);
	await page.goto('/tunes/e2e-stem-direction-tune');
	await expect(page.locator('.abcjs-container svg .abcjs-notehead').first()).toBeVisible();

	const stems = await measureStems(page);
	// 24 stemmed notes seeded (4 + 4 quarters, 8 + 8 eighths).
	expect(stems.length).toBeGreaterThanOrEqual(20);

	// Fixture sanity: the chart genuinely exercises both directions.
	expect(stems.filter((s) => s.expected === 'up').length).toBeGreaterThanOrEqual(8);
	expect(stems.filter((s) => s.expected === 'down').length).toBeGreaterThanOrEqual(8);

	const wrong = stems.filter((s) => s.actual !== s.expected);
	expect(
		wrong,
		`stems violating the direction rule (head position in spaces above middle line): ${wrong
			.map((s) => `${s.headAboveMiddleSp.toFixed(1)}sp→${s.actual}`)
			.join(', ')}`
	).toEqual([]);
});
