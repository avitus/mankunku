/**
 * Pure scroll math for the lick-practice key stack once rows can differ in
 * height (a struggling key's row grows into a lead-sheet system). The
 * contract the fixed-height stack always had, now stated for any heights:
 *
 * - the active row starts one "slot" below the top (the previous row's
 *   height — or the standard slot height before row 0) and slides up by
 *   exactly that amount over its own duration, so it ends at y = 0;
 * - therefore the active row is fully visible for its whole duration and
 *   the next row starts exactly where it ends, whatever their heights;
 * - the viewport is tall enough for the previous row plus the active row,
 *   and never shorter than the fixed-height stack was.
 */

import { describe, it, expect } from 'vitest';
import { keyStackLayout } from '$lib/ui/key-stack-layout';

const SLOT = 105;
const VISIBLE = 3;

describe('keyStackLayout', () => {
	it('reproduces the fixed-height stack when every row is one slot tall', () => {
		const heights = [SLOT, SLOT, SLOT];
		// (1 - s) * SLOT, as the component always computed.
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout(heights, 0.5, SLOT, VISIBLE).translateY).toBe(0.5 * SLOT);
		expect(keyStackLayout(heights, 1, SLOT, VISIBLE).translateY).toBe(0);
		expect(keyStackLayout(heights, 2.25, SLOT, VISIBLE).translateY).toBe(-1.25 * SLOT);
		expect(keyStackLayout(heights, 0, SLOT, VISIBLE).viewportHeight).toBe(SLOT * VISIBLE);
	});

	it('clamps a pre-start (negative) scroll to the start position', () => {
		expect(keyStackLayout([SLOT, SLOT], -0.4, SLOT, VISIBLE).translateY).toBe(SLOT);
		expect(keyStackLayout([SLOT, SLOT], -0.4, SLOT, VISIBLE).currentRow).toBe(0);
	});

	it('reports the active row like the component did (floor, clamped to the last row)', () => {
		const heights = [SLOT, SLOT, SLOT];
		expect(keyStackLayout(heights, 1.9, SLOT, VISIBLE).currentRow).toBe(1);
		expect(keyStackLayout(heights, 3, SLOT, VISIBLE).currentRow).toBe(2);
	});

	it('slides a tall active row up by the PREVIOUS row height so it ends at y = 0', () => {
		const TALL = 200;
		const heights = [SLOT, TALL, SLOT];
		// Row 1 (tall) starts where row 0 ends: one slot down.
		const start = keyStackLayout(heights, 1, SLOT, VISIBLE);
		expect(start.translateY + SLOT).toBe(SLOT); // row 1 top = t_1 + translateY
		// Halfway through, it has slid up half of row 0's height, not its own.
		const mid = keyStackLayout(heights, 1.5, SLOT, VISIBLE);
		expect(mid.translateY + SLOT).toBe(SLOT / 2);
		// At the end its top is at 0 and row 2 starts at exactly TALL.
		const end = keyStackLayout(heights, 2, SLOT, VISIBLE);
		expect(end.translateY + SLOT).toBe(0);
		expect(end.translateY + SLOT + TALL).toBe(TALL);
	});

	it('starts the row AFTER a tall row one tall-row down, then slides it up by that much', () => {
		const TALL = 200;
		const heights = [TALL, SLOT];
		const start = keyStackLayout(heights, 1, SLOT, VISIBLE);
		expect(start.translateY + TALL).toBe(TALL); // row 1 top
		const end = keyStackLayout(heights, 2, SLOT, VISIBLE);
		expect(end.translateY + TALL).toBe(0);
	});

	it('reserves the viewport for TWO of the tallest rows whenever any row is tall', () => {
		// A handover between two tall rows needs both on screen, and the height
		// must not depend on where the tall rows sit — the next cycle re-sorts
		// them, and a viewport that resized per cycle would shove the ring.
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
