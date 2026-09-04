/**
 * Pure scroll math for the lick-practice key stack once rows can differ in
 * height (a struggling key's row grows into a lead-sheet system):
 *
 * - the active row HOLDS one "slot" below the top (the previous row's
 *   height — or the standard slot height before row 0) for its whole
 *   duration, with the previous row fully visible above it; the stack steps
 *   at each key boundary (the component animates the step). It does not
 *   drift: a staff crawling upward a pixel per frame strobes;
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

describe('keyStackLayout', () => {
	it('holds the active row one slot below the top for its whole duration', () => {
		// The stack does NOT drift: a staff crawling upward a pixel per frame
		// strobes. The active row sits still at its slot while it is read, and
		// the stack steps one row at each key change (animated by CSS).
		const heights = [SLOT, SLOT, SLOT];
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout(heights, 0.5, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout(heights, 0.99, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).viewportHeight).toBe(SLOT * VISIBLE);
	});

	it('steps by the previous row height at each key boundary', () => {
		const heights = [SLOT, SLOT, SLOT];
		// Row 1 starts where row 0 ends (one slot down): translate = SLOT - t_1.
		expect(keyStackLayout(heights, 1, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 1.75, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 2, SLOT, VISIBLE).translateY).toBe(-SLOT);
	});

	it('clamps a pre-start (negative) scroll to the start position', () => {
		expect(keyStackLayout([SLOT, SLOT], -0.4, SLOT, VISIBLE).translateY).toBe(SLOT);
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
		// A lone tall row still needs the empty slot above it.
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
		// A two-row stack whose second row is the sheet steps too.
		expect(keyStackLayout([SLOT, LEAD], 0.5, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout([SLOT, LEAD], 1, SLOT, VISIBLE).translateY).toBe(0);
	});

	it('handles an empty stack', () => {
		expect(keyStackLayout([], 0, SLOT, VISIBLE)).toEqual({
			translateY: SLOT,
			currentRow: 0,
			viewportHeight: SLOT * VISIBLE
		});
	});
});

