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
 * - a row can span several uniform time slots (a revealed key plays three
 *   passes in one held row), so `rowScrollFraction` maps the transport's
 *   slot-unit scroll onto row units before the layout sees it.
 */

import { describe, it, expect } from 'vitest';
import { keyStackLayout, rowScrollFraction } from '$lib/ui/key-stack-layout';

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

	it('handles an empty stack', () => {
		expect(keyStackLayout([], 0, SLOT, VISIBLE)).toEqual({
			translateY: SLOT,
			currentRow: 0,
			viewportHeight: SLOT * VISIBLE
		});
	});
});

describe('rowScrollFraction', () => {
	it('is the identity when every row spans one slot', () => {
		expect(rowScrollFraction(0, [1, 1, 1])).toBe(0);
		expect(rowScrollFraction(1.5, [1, 1, 1])).toBe(1.5);
		expect(rowScrollFraction(2.25, [1, 1, 1])).toBe(2.25);
	});

	it('holds a multi-pass row for all its slots, advancing within the row', () => {
		// Row 1 plays three passes: slots 1, 2 and 3 all belong to it.
		const spans = [1, 3, 1];
		expect(rowScrollFraction(1, spans)).toBe(1);
		expect(rowScrollFraction(2.5, spans)).toBe(1.5);
		expect(rowScrollFraction(3.99, spans)).toBeCloseTo(1 + 2.99 / 3, 9);
		// The row after it starts at slot 4.
		expect(rowScrollFraction(4, spans)).toBe(2);
		expect(rowScrollFraction(4.5, spans)).toBe(2.5);
	});

	it('reports the pass a multi-pass row is on through its fraction', () => {
		const spans = [3];
		// Pass n = floor(fraction × passes) + 1.
		expect(Math.floor((rowScrollFraction(0.2, spans) % 1) * 3) + 1).toBe(1);
		expect(Math.floor((rowScrollFraction(1.2, spans) % 1) * 3) + 1).toBe(2);
		expect(Math.floor((rowScrollFraction(2.9, spans) % 1) * 3) + 1).toBe(3);
	});

	it('clamps a pre-start scroll to the first row and a past-the-end scroll to the row count', () => {
		expect(rowScrollFraction(-0.4, [1, 3])).toBe(0);
		expect(rowScrollFraction(4, [1, 3])).toBe(2);
		expect(rowScrollFraction(9, [1, 3])).toBe(2);
		expect(rowScrollFraction(2, [])).toBe(0);
	});
});
