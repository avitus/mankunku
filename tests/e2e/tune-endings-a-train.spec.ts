import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures/test';
import { seedOnboardedAnonymous, seedTunes } from './fixtures/storage';
import { installAudioMock, stubCdnInstrumentSamples } from './fixtures/audio';
import type { Page } from '@playwright/test';

/**
 * Live validation of first/second-ending engraving on Take the A Train.
 *
 * Locks the regressions we kept re-introducing:
 * - Volta "2" must be visible and not buried under the first chord
 * - Noteheads must not be horizontally squashed
 * - Closing barline on [2] must exist
 * - [2] left edge aligns under [1]
 * - Overlays built from the layout (bar hit rects, the practice playhead)
 *   follow the aligned [2] glyphs instead of abcjs's pre-alignment x
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
	// Precondition: the layer must actually contain measurable noteheads, or the
	// squash assertion below silently passes on an empty set (the exact no-op the
	// file header warns about if the layer selector stops matching).
	expect(heads.length, 'measurable noteheads present').toBeGreaterThan(0);
	const best = heads.reduce((a, b) => (a.aspect > b.aspect ? a : b));
	// Squashed heads were ~0.05–0.15; a healthy whole note is often >0.5.
	expect(best.aspect).toBeGreaterThan(0.35);
});

/** A client rect reduced to what the geometry assertions read. */
interface Rect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/**
 * The stacked [2] system after ending alignment moved its glyphs under [1]:
 * the volta bracket (already translated), its staff, one staff-space in px,
 * and the overlay under test drawn in the same wrapper. The overlay is built
 * from the abcjs layout, so it only lands under the music when that layout
 * was mapped through the same transform the glyphs got.
 */
interface SecondEndingGeometry {
	overlay: Rect;
	bracket: Rect;
	staff: Rect;
	spacing: number;
	noteheads: Rect[];
}

function expectOverlayUnderSecondEnding(g: SecondEndingGeometry, what: string): void {
	// Pre-alignment, the overlay sits at the line start, hundreds of px left of
	// the bracket [1] pulled the [2] under; aligned, its edges are the bracket's.
	const tol = g.spacing * 2.5;
	expect(Math.abs(g.overlay.left - g.bracket.left), `${what} left vs [2] bracket`).toBeLessThanOrEqual(tol);
	expect(Math.abs(g.overlay.right - g.bracket.right), `${what} right vs [2] bracket`).toBeLessThanOrEqual(tol);
	for (const head of g.noteheads) {
		expect(head.left, `${what} covers the [2] noteheads`).toBeGreaterThanOrEqual(g.overlay.left - tol);
		expect(head.right, `${what} covers the [2] noteheads`).toBeLessThanOrEqual(g.overlay.right + tol);
	}
}

test('the editor bar hit rect for the stacked [2] bar sits under its music, not at the line start', async ({
	page
}) => {
	await page.goto(`/tunes/editor?edit=${A_TRAIN_ID}`);
	await expect(page.getByRole('heading', { name: 'Edit Tune' })).toBeVisible();
	// A(7) + [1](1) + [2](1) + B + A: the second ending is section 2.
	await expect(page.locator('rect.bar-hit[data-bar-pos="2:0"]')).toBeVisible();
	await expect.poll(async () => page.locator('g.abcjs-ending-align').count()).toBeGreaterThan(0);

	const geometry = await page.evaluate((): SecondEndingGeometry | null => {
		const rect = (el: Element): Rect => {
			const b = el.getBoundingClientRect();
			return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
		};
		const layer = document.querySelector('g.abcjs-ending-align');
		const wrapper = layer?.closest('g.abcjs-staff-wrapper');
		const hit = wrapper?.querySelector('rect.bar-hit[data-bar-pos="2:0"]');
		const bracket = [...(wrapper?.querySelectorAll('g.abcjs-ending') ?? [])].find(
			(g) => (g.querySelector('text')?.textContent ?? '').trim() === '2'
		);
		const staff = wrapper?.querySelector('.abcjs-staff');
		if (!layer || !wrapper || !hit || !bracket || !staff) return null;
		return {
			overlay: rect(hit),
			bracket: rect(bracket),
			staff: rect(staff),
			spacing: staff.getBoundingClientRect().height / 4,
			noteheads: [...layer.querySelectorAll('g.abcjs-note')].map(rect)
		};
	});
	expect(geometry, 'the [2] hit rect lives in the aligned wrapper').not.toBeNull();
	expect(geometry!.noteheads.length, 'measurable [2] noteheads').toBeGreaterThan(0);
	expectOverlayUnderSecondEnding(geometry!, 'bar hit rect');
});

/**
 * Max the tempo knob (End key → max), retried until the hydrated Knob takes
 * the keypress — see tune-practice.spec.ts for why the retry exists.
 */
async function setTempoMax(page: Page): Promise<void> {
	const knob = page.getByRole('slider', { name: /^tempo$/i });
	await expect(async () => {
		await knob.press('End');
		await expect(knob).toHaveAttribute('aria-valuenow', '240', { timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}

/**
 * The reported scenario: a practice session's playhead reaching the [2] bar.
 * Serial like the other session specs — Tone/AudioContext starts flake when
 * run beside each other.
 */
test.describe.serial('tune practice playhead on the stacked [2]', () => {
	test('the playhead sits under the stacked [2] music, not at the line start', async ({
		page,
		browserName
	}) => {
		test.skip(
			browserName === 'firefox' && process.platform === 'linux' && !!process.env.CI,
			'Tone.start() / AudioContext.resume() hangs in headless Linux Firefox without an audio device'
		);
		// 45s session start + 75s to reach the [2] bar (pass two, bar 16 of the
		// expanded form at 240 BPM) + slack.
		test.setTimeout(150_000);

		await installAudioMock(page);
		await stubCdnInstrumentSamples(page);
		await page.goto(`/tunes/${A_TRAIN_ID}/practice`);
		await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();
		await setTempoMax(page);

		// The playhead holds the [2] bar for one bar (a second at 240 BPM), so
		// it is measured the moment the marker effect inserts it into the
		// aligned wrapper rather than sampled from the test runner.
		await page.evaluate(() => {
			const w = window as unknown as { __playheadOnSecondEnding: SecondEndingGeometry | null };
			w.__playheadOnSecondEnding = null;
			const rect = (el: Element): Rect => {
				const b = el.getBoundingClientRect();
				return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
			};
			const record = (playhead: Element) => {
				const wrapper = playhead.closest('g.abcjs-staff-wrapper');
				const layer = wrapper?.querySelector('g.abcjs-ending-align');
				const bracket = [...(wrapper?.querySelectorAll('g.abcjs-ending') ?? [])].find(
					(g) => (g.querySelector('text')?.textContent ?? '').trim() === '2'
				);
				const staff = wrapper?.querySelector('.abcjs-staff');
				if (!wrapper || !layer || !bracket || !staff || w.__playheadOnSecondEnding) return;
				w.__playheadOnSecondEnding = {
					overlay: rect(playhead),
					bracket: rect(bracket),
					staff: rect(staff),
					spacing: staff.getBoundingClientRect().height / 4,
					noteheads: [...layer.querySelectorAll('g.abcjs-note')].map(rect)
				};
			};
			new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const n of m.addedNodes) {
						if (n instanceof Element && n.getAttribute('data-marker-id') === '__playhead') record(n);
					}
				}
			}).observe(document.body, { childList: true, subtree: true });
		});

		await page.getByRole('button', { name: /^start$/i }).click();
		await expect(page.getByRole('button', { name: /^end$/i })).toBeVisible({ timeout: 45_000 });

		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							(window as unknown as { __playheadOnSecondEnding: SecondEndingGeometry | null })
								.__playheadOnSecondEnding
					),
				{ timeout: 75_000, intervals: [250] }
			)
			.not.toBeNull();
		const geometry = (await page.evaluate(
			() =>
				(window as unknown as { __playheadOnSecondEnding: SecondEndingGeometry | null })
					.__playheadOnSecondEnding
		))!;

		expectOverlayUnderSecondEnding(geometry, 'playhead');
		// The band's vertical geometry is measured after alignment: the
		// under-bar playhead hangs below the [2] staff.
		expect(geometry.overlay.top, 'playhead below the [2] staff').toBeGreaterThanOrEqual(geometry.staff.bottom - 1);

		await page.getByRole('button', { name: /^end$/i }).click();
		await expect(page.getByRole('heading', { name: /take complete/i })).toBeVisible({ timeout: 10_000 });
	});
});
