import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Chord-symbol height regression (MuseScore reference): abcjs anchors every
 * chord in a system above the tallest element of the WHOLE line, so one high
 * bar used to lift every chord in its system ~3+ staff-spaces. The adapter's
 * post-render pass (`chordSymbolDeltas`) drops each chord to MuseScore's
 * default — baseline 2.5 spacings above the top staff line — pushing a chord
 * up only when ink under its own x-span intrudes (half-spacing clearance).
 *
 * The seeded tune (tenor sax, written = concert + 14) puts bars 1–3 of the
 * A section inside the staff and bar 4 at written A5–C6 (ledger lines above),
 * so the A system exercises the push case and the flat-bar case TOGETHER;
 * the B section is entirely flat. All measurements are made with
 * getBoundingClientRect (transforms included) and normalized to staff-space
 * units, so they are scale- and viewport-independent.
 */

const HIGH_BAR_TUNE = {
	id: 'e2e-chord-height-tune',
	title: 'Chord Height Regression',
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
				{ pitch: 48, duration: [1, 2], offset: [0, 1] },
				{ pitch: 50, duration: [1, 2], offset: [1, 2] },
				{ pitch: 52, duration: [1, 2], offset: [1, 1] },
				{ pitch: 53, duration: [1, 2], offset: [3, 2] },
				{ pitch: 55, duration: [1, 2], offset: [2, 1] },
				{ pitch: 53, duration: [1, 2], offset: [5, 2] },
				// Bar 4: written A5–C6 on tenor — ledger-line ink above the staff.
				{ pitch: 69, duration: [1, 4], offset: [3, 1] },
				{ pitch: 70, duration: [1, 4], offset: [13, 4] },
				{ pitch: 69, duration: [1, 4], offset: [7, 2] },
				{ pitch: 67, duration: [1, 4], offset: [15, 4] }
			],
			harmony: [
				{ chord: { root: 'D', quality: 'min7' }, scaleId: 'major.dorian', startOffset: [0, 1], duration: [1, 1], symbol: 'Dm7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [1, 1], duration: [1, 1], symbol: 'G7' },
				{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [2, 1], duration: [1, 1], symbol: 'Cmaj7' },
				{ chord: { root: 'A', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [3, 1], duration: [1, 1], symbol: 'Am7' }
			]
		},
		{
			label: 'B',
			bars: 4,
			notes: [
				{ pitch: 48, duration: [1, 1], offset: [0, 1] },
				{ pitch: 50, duration: [1, 1], offset: [1, 1] },
				{ pitch: 52, duration: [1, 1], offset: [2, 1] },
				{ pitch: 48, duration: [1, 1], offset: [3, 1] }
			],
			harmony: [
				{ chord: { root: 'F', quality: 'maj7' }, scaleId: 'major.lydian', startOffset: [0, 1], duration: [2, 1], symbol: 'Fmaj7' },
				{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [2, 1], duration: [2, 1], symbol: 'G7' }
			]
		}
	],
	source: 'user'
};

interface MeasuredChord {
	/** Chord BASELINE (y attr + translate dy) → top staff line, in staff
	 * spaces (+ = above). Attribute-derived, so free of per-browser font
	 * metrics — a baseline at MuseScore's default reads exactly 2.5. */
	baselineGapSp: number;
	/** Chord ink bottom → top staff line, in staff spaces (+ = above). */
	bboxGapSp: number;
	/** Top of the tallest non-chord ink under the chord's x-span that rises
	 * ABOVE the staff, as spaces above the top line; null when nothing does. */
	inkTopSp: number | null;
	text: string;
}

/** Measure every chord of every system, normalized to staff spaces. */
async function measureChords(page: import('@playwright/test').Page): Promise<MeasuredChord[][]> {
	return page.evaluate(() => {
		const EXCLUDE = '.abcjs-chord, .abcjs-ending, .abcjs-part, .abcjs-tempo, .abcjs-rest, .hit-zone';
		const systems: MeasuredChord[][] = [];
		const svg = document.querySelector('.abcjs-container svg');
		if (!svg) return systems;
		for (const wrapper of svg.querySelectorAll('g.abcjs-staff-wrapper')) {
			const staff = wrapper.querySelector('.abcjs-staff');
			if (!staff) continue;
			const staffRect = staff.getBoundingClientRect();
			const spacing = staffRect.height / 4;
			if (!(spacing > 0)) continue;
			// Client px per SVG user unit, for attribute-space conversions.
			const staffBox = (staff as SVGGraphicsElement).getBBox();
			const scale = staffRect.height / staffBox.height;
			const ink: DOMRect[] = [];
			for (const leaf of wrapper.querySelectorAll('path, ellipse, rect, circle, polygon, line, text')) {
				if (leaf.closest(EXCLUDE) || leaf.classList.contains('abcjs-staff')) continue;
				const r = leaf.getBoundingClientRect();
				if (r.width > 0 && r.top < staffRect.top - 0.25 * spacing) ink.push(r);
			}
			const chords: MeasuredChord[] = [];
			for (const chordEl of wrapper.querySelectorAll<SVGTextElement>('text.abcjs-chord')) {
				const c = chordEl.getBoundingClientRect();
				let inkTop: number | null = null;
				for (const r of ink) {
					if (r.left >= c.right || r.right <= c.left) continue;
					inkTop = inkTop === null ? r.top : Math.min(inkTop, r.top);
				}
				const dy = chordEl.transform.baseVal.consolidate()?.matrix.f ?? 0;
				const baselineUser = Number.parseFloat(chordEl.getAttribute('y') ?? '') + dy;
				const baselineClient = staffRect.top - (staffBox.y - baselineUser) * scale;
				chords.push({
					baselineGapSp: (staffRect.top - baselineClient) / spacing,
					bboxGapSp: (staffRect.top - c.bottom) / spacing,
					inkTopSp: inkTop === null ? null : (staffRect.top - inkTop) / spacing,
					text: chordEl.textContent ?? ''
				});
			}
			if (chords.length > 0) systems.push(chords);
		}
		return systems;
	});
}

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [HIGH_BAR_TUNE]);
});

test('chords sit 2.5 spaces above the staff regardless of high bars elsewhere in the system', async ({ page }) => {
	await page.goto('/tunes/e2e-chord-height-tune');
	await expect(page.locator('.abcjs-container svg').first()).toBeVisible();
	await expect(page.locator('.abcjs-container svg text.abcjs-chord').first()).toBeVisible();

	const systems = await measureChords(page);
	const all = systems.flat();
	// 6 chords across the A (high-bar) and B (flat) systems.
	expect(all).toHaveLength(6);

	// A chord is "unobstructed" when no ink under its span reaches the zone the
	// chord box needs (bottom ≈ 2.05 sp above the line, + half-space clearance).
	const unobstructed = all.filter((c) => c.inkTopSp === null || c.inkTopSp < 1.55);
	const obstructed = all.filter((c) => c.inkTopSp !== null && c.inkTopSp >= 1.55);
	// Bars 1–3 of A (sharing the system with the high bar 4) + both B chords.
	expect(unobstructed.length).toBeGreaterThanOrEqual(5);
	expect(obstructed.length).toBeGreaterThanOrEqual(1);

	for (const c of unobstructed) {
		// MuseScore's default baseline: 2.5 spaces above the top line. The
		// old uniform-row bug parked flat bars of the A system ≈ 7.5 sp up.
		expect(c.baselineGapSp, `${c.text} too high`).toBeLessThanOrEqual(2.6);
		expect(c.baselineGapSp, `${c.text} too close to the staff`).toBeGreaterThanOrEqual(2.4);
		// Rendered-ink cross-check (client rects see ANCESTOR transforms the
		// y-attr baseline can't — e.g. the rest-group drag this fix removed
		// from normalizeChordVoiceRests). Loose bounds absorb font descent.
		expect(c.bboxGapSp, `${c.text} rendered ink drifted from its baseline`).toBeLessThanOrEqual(2.6);
		expect(c.bboxGapSp, `${c.text} rendered ink drifted from its baseline`).toBeGreaterThanOrEqual(0.8);
	}

	// Uniformity: every unobstructed chord shares one baseline across systems.
	const gaps = unobstructed.map((c) => c.baselineGapSp);
	expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.1);

	// The chord over the high bar is pushed clear of its ink: the algorithm
	// puts the chord's bbox bottom half a spacing above the intruder, so the
	// BASELINE clears it by 0.5 + descent (baseline is attr-exact in every
	// engine; client-rect descent varies too much per browser to assert on).
	for (const c of obstructed) {
		expect(c.baselineGapSp, `${c.text} must clear its ink`).toBeGreaterThanOrEqual(
			(c.inkTopSp ?? 0) + 0.4
		);
		// Rendered-ink sanity: nothing visually overlapping.
		expect(c.bboxGapSp, `${c.text} overlaps its ink`).toBeGreaterThanOrEqual(
			(c.inkTopSp ?? 0) - 0.2
		);
	}
});
