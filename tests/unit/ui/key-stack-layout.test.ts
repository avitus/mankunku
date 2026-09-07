/**
 * Pure scroll math for the lick-practice key stack once rows can differ in
 * height (a struggling key's row grows into a lead-sheet system):
 *
 * - row 0 parks at the TOP of the viewport. There is no previous row to keep
 *   visible above it, so the "slot" the original rule reserved there was an
 *   empty band the height of a chart row — Andy (2026-09-06): "wasted space
 *   above the top of the first progression";
 * - from row 1 on, the active row HOLDS one "slot" below the top (the
 *   previous row's height) for its whole duration, with the previous row
 *   fully visible above it, and the stack steps at each key boundary after
 *   the first — row 0 already sits where row 1's previous row must sit, so
 *   the first boundary moves nothing but the highlight (the component
 *   animates each step). It does not drift: a staff crawling upward a pixel
 *   per frame strobes;
 * - the viewport reserves the tallest row plus its neighbour, so it never
 *   resizes between cycles, and is never shorter than the fixed-height
 *   stack was;
 * - a lead-sheet row NEXT gets no special parking: it steps into the slot
 *   when its own key arrives, and the reading pause before that key
 *   (`cyclePositionAt` in the rotation module) is what gives the step time
 *   to land before anything has to be read. Read-ahead parking — the
 *   active row at the top so the sheet sat lit a whole key early — was
 *   tried and withdrawn: the sheet must not appear until the previous key
 *   has been played.
 */

import { describe, it, expect } from 'vitest';
import { keyStackLayout } from '$lib/ui/key-stack-layout';

const SLOT = 105;
const VISIBLE = 3;

/** Top edge (px, viewport coordinates) of row `i` under a layout. */
function rowTop(heights: readonly number[], i: number, translateY: number): number {
	let top = 0;
	for (let k = 0; k < i; k++) top += heights[k];
	return top + translateY;
}

describe('keyStackLayout', () => {
	it('parks row 0 at the top of the viewport for its whole duration', () => {
		// No previous row to keep visible above it, so no slot above it either:
		// the first key's chart sits flush with the top and the upcoming rows
		// fill the viewport under it. Still no drift within the key.
		const heights = [SLOT, SLOT, SLOT];
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 0.5, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 0.99, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).viewportHeight).toBe(SLOT * VISIBLE);
	});

	it('holds the active row one slot below the top from row 1 on, stepping at each boundary after the first', () => {
		// The stack does NOT drift: a staff crawling upward a pixel per frame
		// strobes. The active row sits still at its slot while it is read, and
		// the stack steps one row at each key change (animated by CSS).
		const heights = [SLOT, SLOT, SLOT];
		// Row 1 sits under row 0, which is already at the top: the first key
		// boundary moves nothing — the highlight steps, the stack does not.
		expect(keyStackLayout(heights, 1, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 1.75, SLOT, VISIBLE).translateY).toBe(0);
		// Row 2 starts where row 1 ends (one slot down): translate = SLOT - t_2.
		expect(keyStackLayout(heights, 2, SLOT, VISIBLE).translateY).toBe(-SLOT);
	});

	it('clamps a pre-start (negative) scroll to the start position', () => {
		expect(keyStackLayout([SLOT, SLOT], -0.4, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout([SLOT, SLOT], -0.4, SLOT, VISIBLE).currentRow).toBe(0);
	});

	it('reports the active row like the component did (floor, clamped to the last row)', () => {
		const heights = [SLOT, SLOT, SLOT];
		expect(keyStackLayout(heights, 1.9, SLOT, VISIBLE).currentRow).toBe(1);
		expect(keyStackLayout(heights, 3, SLOT, VISIBLE).currentRow).toBe(2);
		// Past the end, the last row holds its slot rather than sliding out.
		expect(keyStackLayout(heights, 3, SLOT, VISIBLE).translateY).toBe(SLOT - 2 * SLOT);
	});

	it('places a tall active row directly under the previous row, and the next row under it', () => {
		const TALL = 200;
		const heights = [SLOT, TALL, SLOT];
		// Row 1 (tall) sits at y = SLOT (row 0's height) for its whole key.
		const during = keyStackLayout(heights, 1.5, SLOT, VISIBLE);
		expect(during.translateY + SLOT).toBe(SLOT); // row 1 top = t_1 + translateY
		// Row 2 then sits at y = TALL (row 1's height).
		const next = keyStackLayout(heights, 2, SLOT, VISIBLE);
		expect(next.translateY + SLOT + TALL).toBe(TALL);
	});

	it('reserves the viewport for the tallest row plus its neighbour, wherever they sit', () => {
		// A row and its predecessor are both on screen while it plays: the tall
		// row under a standard one, then the next standard row under the tall
		// one. The height must not depend on where the tall row sits — the next
		// cycle re-sorts the rows, and a viewport that resized per cycle would
		// shove the ring.
		// (Taller than the fixed-height stack's floor of SLOT × VISIBLE = 315.)
		const TALL = 260;
		expect(keyStackLayout([SLOT, TALL, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(TALL + SLOT);
		expect(keyStackLayout([TALL, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(TALL + SLOT);
		expect(keyStackLayout([SLOT, TALL], 0, SLOT, VISIBLE).viewportHeight).toBe(TALL + SLOT);
		// A lone tall row still reserves the neighbour slot — below it now, so
		// the viewport is the same one the next cycle gets when a row follows.
		expect(keyStackLayout([TALL], 0, SLOT, VISIBLE).viewportHeight).toBe(TALL + SLOT);
		// Two tall rows (not a shape the session builds, but the math is general).
		expect(keyStackLayout([TALL, TALL], 0, SLOT, VISIBLE).viewportHeight).toBe(2 * TALL);
		// Never shorter than the fixed-height stack was.
		expect(keyStackLayout([SLOT, 120, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(SLOT * VISIBLE);
	});

	it('parks a lead-sheet NEXT row under the usual slot like any other row', () => {
		// [chord, chord, sheet]: while row 1 plays, the sheet straddles the
		// viewport bottom exactly as a chord row would (dimmed, its top on
		// screen); when its key arrives it steps into the slot. The reading
		// pause that precedes that key is the time the step needs.
		const LEAD = 212;
		const heights = [SLOT, SLOT, LEAD];
		expect(keyStackLayout(heights, 1, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 1.99, SLOT, VISIBLE).translateY).toBe(0);
		// Row 2 (the sheet) sits at y = SLOT for its whole key: fully inside
		// the 317 px viewport (SLOT + LEAD).
		const during = keyStackLayout(heights, 2, SLOT, VISIBLE);
		expect(during.translateY).toBe(-SLOT);
		expect(2 * SLOT + during.translateY).toBe(SLOT);
		expect(SLOT + LEAD).toBe(during.viewportHeight);
		// A two-row stack whose second row is the sheet: with row 0 at the top
		// the sheet's row is wholly inside the viewport from the start (showing
		// its chord-chart placeholder — the staff stays hidden until its key),
		// and nothing moves at the boundary.
		expect(keyStackLayout([SLOT, LEAD], 0.5, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout([SLOT, LEAD], 1, SLOT, VISIBLE).translateY).toBe(0);
	});

	it('keeps the active row, and the previous row above it, inside the viewport for every shape', () => {
		const L = 212;
		const S = SLOT;
		const shapes = [[S, S, S], [S, L], [S, S, L], [L, S, S], [L], [S], [S, L, S]];
		for (const heights of shapes) {
			for (let scroll = 0; scroll <= heights.length + 1; scroll += 0.5) {
				const l = keyStackLayout(heights, scroll, S, VISIBLE);
				const cur = l.currentRow;
				const top = rowTop(heights, cur, l.translateY);
				// Row 0 is flush with the top while it plays.
				if (cur === 0) expect(top).toBe(0);
				// The active row is wholly on screen.
				expect(top).toBeGreaterThanOrEqual(0);
				expect(top + heights[cur]).toBeLessThanOrEqual(l.viewportHeight);
				// From row 1 on, the previous row is wholly on screen, directly above.
				if (cur > 0) {
					const prevTop = rowTop(heights, cur - 1, l.translateY);
					expect(prevTop).toBeGreaterThanOrEqual(0);
					expect(prevTop + heights[cur - 1]).toBe(top);
				}
			}
		}
	});

	it('handles an empty stack', () => {
		expect(keyStackLayout([], 0, SLOT, VISIBLE)).toEqual({
			translateY: 0,
			currentRow: 0,
			viewportHeight: SLOT * VISIBLE
		});
	});
});
