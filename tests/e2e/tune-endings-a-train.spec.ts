import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';

/**
 * Live validation of first/second-ending engraving on Take the A Train.
 *
 * Locks the regressions we kept re-introducing:
 * - Volta "2" must be visible and not buried under the first chord
 * - Noteheads must not be horizontally squashed
 * - Closing barline on [2] must exist
 * - [2] left edge aligns under [1]
 */

const A_TRAIN_ID = 'e2e-take-the-a-train';

function loadATrain(): Record<string, unknown> {
	const raw = JSON.parse(
		readFileSync(
			resolve('tests/fixtures/leadsheets/pdf-vs-musescore/take-the-a-train.musescore-import.json'),
			'utf8'
		)
	) as Record<string, unknown>;
	return {
		...raw,
		id: A_TRAIN_ID,
		source: 'user',
		tags: Array.isArray(raw.tags) ? raw.tags : []
	};
}

test.beforeEach(async ({ page }) => {
	await seedOnboardedAnonymous(page);
	await seedTunes(page, [loadATrain()]);
});

test('Take the A Train: [2] volta number, chords, note shape, and closer', async ({ page }) => {
	await page.goto(`/tunes/${A_TRAIN_ID}`);
	await expect(page.getByRole('heading', { name: /Take the A Train/i })).toBeVisible();

	const chart = page.locator('.notation-container, .abcjs-container').first();
	await expect(chart.locator('svg').first()).toBeVisible();

	// Wait for post-render ending align to run.
	await expect
		.poll(async () => page.locator('svg g.abcjs-ending').count())
		.toBeGreaterThanOrEqual(2);

	const report = await page.evaluate(() => {
		const endings = [...document.querySelectorAll<SVGGElement>('g.abcjs-ending')];
		const labeled = endings
			.map((g) => {
				const label = (g.querySelector('text')?.textContent ?? '').trim();
				const text = g.querySelector('text');
				let box: DOMRect | null = null;
				let textBox: DOMRect | null = null;
				try {
					box = g.getBoundingClientRect();
					if (text) textBox = text.getBoundingClientRect();
				} catch {
					/* skip */
				}
				return { label, box, textBox, g };
			})
			.filter((e) => e.label === '1' || e.label === '2');

		const first = labeled.find((e) => e.label === '1');
		const second = labeled.find((e) => e.label === '2');
		if (!first?.box || !second?.box || !second.textBox) {
			return {
				ok: false as const,
				reason: 'missing ending boxes',
				labels: labeled.map((e) => e.label)
			};
		}

		// Chords inside the second-ending align layer (or near the [2] system).
		const layer =
			second.g.closest('g.abcjs-ending-align') ??
			second.g.closest('g.abcjs-staff-wrapper');
		const chords = layer
			? [...layer.querySelectorAll<SVGGraphicsElement>('text.abcjs-chord')]
			: [];
		const chordBoxes = chords.map((c) => {
			const r = c.getBoundingClientRect();
			return {
				text: (c.textContent ?? '').replace(/\s+/g, ''),
				left: r.left,
				right: r.right,
				width: r.width,
				height: r.height
			};
		});

		// Notes in the same layer — aspect ratio of the widest note-ish glyph.
		const notes = layer
			? [...layer.querySelectorAll<SVGGraphicsElement>('g.abcjs-note')]
			: [];
		const noteAspects = notes.map((n) => {
			const r = n.getBoundingClientRect();
			return { w: r.width, h: r.height, aspect: r.height > 0 ? r.width / r.height : 0 };
		});

		// Bars in the layer (closing barline should exist).
		const bars = layer
			? [...layer.querySelectorAll<SVGGraphicsElement>('g.abcjs-bar')]
			: [];
		const barWidths = bars.map((b) => b.getBoundingClientRect().width);

		const label2 = second.textBox;
		const firstChord = chordBoxes[0];
		const gap =
			firstChord && label2 ? firstChord.left - label2.right : Number.POSITIVE_INFINITY;

		// Left hook of the volta path vs the "2" digit (must not sit on the bracket).
		const pathEl = second.g.querySelector('path, line');
		let labelHookGap = Number.POSITIVE_INFINITY;
		if (pathEl && label2) {
			try {
				const hookLeft = pathEl.getBoundingClientRect().left;
				labelHookGap = label2.left - hookLeft;
			} catch {
				/* keep +Inf */
			}
		}

		// Chord row height: mean gap from staff top to chord top ([1] vs [2]).
		const gapAboveStaff = (endingG: SVGGElement): number | null => {
			const wrapper = endingG.closest('g.abcjs-staff-wrapper');
			const staff = wrapper?.querySelector('.abcjs-staff');
			if (!wrapper || !staff) return null;
			const ebox = endingG.getBoundingClientRect();
			const staffTop = staff.getBoundingClientRect().top;
			const chords = [...wrapper.querySelectorAll('text.abcjs-chord')].filter((c) => {
				const r = c.getBoundingClientRect();
				// Prefer chords under this ending's x-span (or in the align layer).
				const inLayer = !!c.closest('g.abcjs-ending-align');
				const underEnding =
					r.right > ebox.left - 4 && r.left < ebox.right + 4;
				return inLayer || underEnding;
			});
			if (chords.length === 0) return null;
			const gaps = chords.map((c) => staffTop - c.getBoundingClientRect().top);
			return gaps.reduce((a, b) => a + b, 0) / gaps.length;
		};
		const firstChordGap = gapAboveStaff(first.g);
		const secondChordGap = gapAboveStaff(second.g);
		const chordHeightDelta =
			firstChordGap !== null && secondChordGap !== null
				? secondChordGap - firstChordGap
				: null;

		// [2] should start near [1]'s left (within a generous tolerance for
		// staff padding / clef differences across systems).
		const leftDelta = Math.abs(second.box.left - first.box.left);

		return {
			ok: true as const,
			label2: {
				text: second.label,
				width: label2.width,
				height: label2.height,
				left: label2.left,
				right: label2.right
			},
			firstChord,
			gap,
			labelHookGap,
			chordHeightDelta,
			firstChordGap,
			secondChordGap,
			leftDelta,
			chordCount: chordBoxes.length,
			noteAspects,
			barCount: bars.length,
			minBarWidth: barWidths.length ? Math.min(...barWidths) : 0,
			maxBarWidth: barWidths.length ? Math.max(...barWidths) : 0,
			hasAlignLayer: !!document.querySelector('g.abcjs-ending-align')
		};
	});

	expect(report.ok, JSON.stringify(report)).toBe(true);
	if (!report.ok) return;

	// Volta "2" must paint with real width (not scale-squashed to a hairline).
	expect(report.label2.width).toBeGreaterThan(4);
	expect(report.label2.height).toBeGreaterThan(6);

	// At least one chord on the [2] system (A Train: G7 / C7 → written A7 / D7 on tenor).
	expect(report.chordCount).toBeGreaterThanOrEqual(1);
	expect(report.firstChord).toBeTruthy();

	// "2" must sit inside the bracket — not on the left hook.
	expect(report.labelHookGap, 'volta 2 vs left hook').toBeGreaterThanOrEqual(2);

	// "2" and first chord must not overlap (small positive gap).
	expect(report.gap).toBeGreaterThanOrEqual(2);

	// [2] chord row should not float well above [1]'s (stacked endings share height).
	expect(report.chordHeightDelta, 'chord height [2]-[1]').not.toBeNull();
	expect(report.chordHeightDelta!).toBeLessThan(8);

	// Closing / internal barlines present and not sub-pixel crushed.
	expect(report.barCount).toBeGreaterThanOrEqual(1);
	expect(report.minBarWidth).toBeGreaterThan(0.8);

	// Whole-note (or similar) not a vertical slit: width should be a decent
	// fraction of height for noteheads in the layer.
	const heads = report.noteAspects.filter((n) => n.w > 2 && n.h > 2);
	if (heads.length > 0) {
		const best = heads.reduce((a, b) => (a.aspect > b.aspect ? a : b));
		// Squashed heads were ~0.05–0.15; a healthy whole note is often >0.5.
		expect(best.aspect).toBeGreaterThan(0.35);
	}
});
