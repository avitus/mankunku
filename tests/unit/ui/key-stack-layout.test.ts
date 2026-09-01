/**
 * Pure scroll math for the lick-practice key stack once rows can differ in
 * height (a struggling key's row grows into a lead-sheet system):
 *
 * - the active row HOLDS one "slot" below the top (the previous row's
 *   height — or the standard slot height before row 0) for its whole
 *   duration, with the previous row fully visible above it; the stack steps
 *   at each key boundary (the component animates the step). It does not
 *   drift: a staff crawling upward a pixel per frame strobes;
 * - the viewport reserves two of the tallest rows, so it never resizes
 *   between cycles, and is never shorter than the fixed-height stack was.
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

	it('reserves the viewport for TWO of the tallest rows whenever any row is tall', () => {
		// A row and its predecessor are both on screen while it plays, and the
		// height must not depend on where the tall rows sit — the next cycle
		// re-sorts them, and a viewport that resized per cycle would shove the ring.
		const TALL = 200;
		expect(keyStackLayout([SLOT, TALL, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(2 * TALL);
		expect(keyStackLayout([TALL, TALL], 0, SLOT, VISIBLE).viewportHeight).toBe(2 * TALL);
		expect(keyStackLayout([TALL, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(2 * TALL);
		// Never shorter than the fixed-height stack was.
		expect(keyStackLayout([SLOT, 120, SLOT], 0, SLOT, VISIBLE).viewportHeight).toBe(SLOT * VISIBLE);
	});

	it('handles an empty stack', () => {
		expect(keyStackLayout([], 0, SLOT, VISIBLE)).toEqual({
			translateY: SLOT,
			currentRow: 0,
			viewportHeight: SLOT * VISIBLE
		});
	});
});
