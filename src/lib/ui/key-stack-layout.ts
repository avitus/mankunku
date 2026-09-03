/**
 * Pure scroll math for the lick-practice key stack (UpcomingKeysDisplay)
 * with rows of DIFFERENT heights — a struggling key's row grows into a
 * lead-sheet system while the others stay one chord-chart row tall.
 *
 * The stack STEPS, it does not drift. The active row holds one slot below
 * the top — the previous row's height, or the standard slot before row 0 —
 * for its whole duration (a revealed row's duration is all of its passes,
 * see `rowScrollFraction`), so the previous row (and its score flash) stays
 * fully visible above it and the row being read never moves; at each key
 * boundary the translate jumps by the finished row's height and the
 * component animates the step. The original stack drifted continuously
 * (a pixel or so per frame); a chord box survives that, an engraved staff
 * does not — five one-pixel lines crawling upward strobe, whether the
 * translate is fractional (resampled) or snapped (each line hopping a row).
 *
 * One exception — READ-AHEAD. A lead-sheet row is read, not glanced at, so
 * it must be wholly on screen a key BEFORE it is played; parked under the
 * usual slot it straddles the viewport (107 of 212 px) and only slides into
 * place at its own downbeat, which is when the player must already be
 * reading it. So when the NEXT row is taller than the slot and the three
 * rows would not fit, the active row parks at the TOP instead: the sheet
 * sits fully inside the viewport for the whole preceding key, and the
 * stack does not move at all when the sheet's key arrives. The cost is the
 * just-played row scrolling out (its score flash is only glimpsed during the
 * step; the ring keeps the score). A tall ACTIVE row keeps its usual slot.
 */

export interface KeyStackLayout {
	/** translateY (px) for the whole stack. */
	translateY: number;
	/** Index of the row being played (floor of the scroll, clamped to the last row). */
	currentRow: number;
	/** Fixed viewport height (px): never shorter than the fixed-height stack, and
	 *  room for TWO of the tallest rows whenever any row is tall — a handover
	 *  between two tall rows needs both on screen, and the height must not
	 *  depend on where the tall rows sit, since the next cycle re-sorts them. */
	viewportHeight: number;
}

/**
 * @param heights       per-row pixel heights, in playback order
 * @param scrollFraction position in key units (0 = start of row 0, 1 = start of row 1 …);
 *                       only its integer part matters — the stack holds within a key
 * @param slotHeight    the standard one-chart row height — also the empty slot above row 0
 * @param visibleRows   how many standard rows the fixed-height viewport showed
 */
export function keyStackLayout(
	heights: readonly number[],
	scrollFraction: number,
	slotHeight: number,
	visibleRows: number
): KeyStackLayout {
	const n = heights.length;
	const s = Math.max(0, scrollFraction);
	const currentRow = n === 0 ? 0 : Math.min(n - 1, Math.floor(s));

	// The tallest row plus its neighbour: while a row plays, the row before
	// it is on screen above it — a standard row (or the empty slot) above the
	// one tall row, then the tall row above the next standard one. General
	// over any heights, and independent of WHERE the tall row sits, since the
	// next cycle re-sorts the rows.
	let tallest = 0;
	let second = 0;
	for (const h of heights) {
		if (h > tallest) {
			second = tallest;
			tallest = h;
		} else if (h > second) {
			second = h;
		}
	}
	const viewportHeight = Math.max(slotHeight * visibleRows, tallest + Math.max(slotHeight, second));

	let top = 0;
	for (let i = 0; i < currentRow; i++) top += heights[i];
	const prevHeight = currentRow === 0 ? slotHeight : heights[currentRow - 1];
	const current = heights[currentRow] ?? 0;
	const next = currentRow + 1 < n ? heights[currentRow + 1] : 0;
	// Read-ahead: a lead-sheet row NEXT would straddle the viewport under the
	// usual slot, so the active row parks at the top and the sheet sits fully
	// on screen a key early. The component lights that row (`.ahead`) on the
	// same condition — a taller-than-slot row is the one lead sheet per stack.
	const readAhead = next > slotHeight && prevHeight + current + next > viewportHeight;
	// Row `currentRow` sits at y = activeTop for its whole key: top + translateY.
	const activeTop = readAhead ? 0 : prevHeight;
	const translateY = activeTop - top;

	return { translateY, currentRow, viewportHeight };
}

/**
 * Map the transport's scroll in uniform SLOT units (one key window each —
 * `ticks / ticksPerKey`) onto ROW units for `keyStackLayout`, where a row
 * can span several slots: a revealed key plays `LEAD_SHEET_PASSES` windows
 * back to back in ONE held row, so the staff being read never moves between
 * passes. `spans[i]` is the slots row i occupies. Clamped to `[0, rows]`.
 *
 * The fraction within a multi-slot row also says which pass it is on:
 * `floor(frac × spans[row]) + 1`.
 */
export function rowScrollFraction(slotScroll: number, spans: readonly number[]): number {
	let remaining = Math.max(0, slotScroll);
	for (let row = 0; row < spans.length; row++) {
		const span = Math.max(1, spans[row]);
		if (remaining < span) return row + remaining / span;
		remaining -= span;
	}
	return spans.length;
}
