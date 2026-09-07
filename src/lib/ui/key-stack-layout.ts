/**
 * Pure scroll math for the lick-practice key stack (UpcomingKeysDisplay)
 * with rows of DIFFERENT heights — a struggling key's row grows into a
 * lead-sheet system while the others stay one chord-chart row tall.
 *
 * The stack STEPS, it does not drift. Row 0 parks at the TOP of the
 * viewport; from row 1 on, the active row holds one slot below the top —
 * the previous row's height — for its whole duration (a revealed row's
 * duration is its reading pause and all of its passes — `cyclePositionAt`
 * in the rotation module maps the transport onto row units), so the
 * previous row (and its score flash) stays fully visible above it and the
 * row being read never moves; at each key boundary after the first the
 * translate jumps by the finished row's height and the component animates
 * the step. The first boundary moves nothing: row 0 already sits where row
 * 1's previous row must sit, so only the highlight steps. The original
 * stack drifted continuously (a pixel or so per frame); a chord box
 * survives that, an engraved staff does not — five one-pixel lines crawling
 * upward strobe, whether the translate is fractional (resampled) or
 * snapped (each line hopping a row).
 *
 * Row 0 used to hold the same slot as every other row, with nothing above
 * it: a faithful reading of "the previous row's height" for a row that has
 * no previous row, and a chart-row-tall empty band at the top of the
 * viewport for the first key of every lick and every cycle (Andy,
 * 2026-09-06: "wasted space above the top of the first progression").
 *
 * A lead-sheet row NEXT gets no special treatment: it waits under the
 * active row like any chord row (dimmed, its top on screen) and steps into
 * the slot when its own key arrives. Read-ahead parking — the active row at
 * the top so the sheet sat lit a whole key early — was tried (2026-09-03)
 * and withdrawn the same week: the sheet must not appear until the previous
 * key has been played. What gives the step time to land before the sheet is
 * read is the reading PAUSE the session lays before that key
 * (`LEAD_SHEET_PAUSE_BARS`, `cyclePositionAt` in the rotation module), during
 * which the row is already current.
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
 * @param scrollFraction position in ROW units (0 = start of row 0, 1 = start of row 1 …);
 *                       only its integer part matters — the stack holds within a row
 * @param slotHeight    the standard one-chart row height — the unit the viewport's
 *                       floor is counted in, and the neighbour reserved beside a tall row
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
	// it is on screen above it — a standard row above the one tall row, then
	// the tall row above the next standard one (or, for a tall row 0, the
	// standard row under it). General over any heights, and independent of
	// WHERE the tall row sits, since the next cycle re-sorts the rows.
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
	// Row `currentRow` sits at y = activeTop for its whole key: top + translateY.
	// Row 0 at the top; every later row under the row before it. (Kept as a
	// subtraction of two non-negative numbers: a `-prefix(...)` form would
	// hand rows 0 and 1 a `-0`, which `Object.is` — and so vitest — tells apart.)
	const activeTop = currentRow === 0 ? 0 : heights[currentRow - 1];
	const translateY = activeTop - top;

	return { translateY, currentRow, viewportHeight };
}
