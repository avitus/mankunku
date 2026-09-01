/**
 * Pure scroll math for the lick-practice key stack (UpcomingKeysDisplay)
 * with rows of DIFFERENT heights — a struggling key's row grows into a
 * lead-sheet system while the others stay one chord-chart row tall.
 *
 * The fixed-height stack had one invariant worth keeping: the active row
 * starts one slot below the top and slides up by exactly one slot over its
 * own duration, so it is fully visible throughout and ends at y = 0 as the
 * next row arrives. Generalised: the active row starts where the PREVIOUS
 * row ends (the previous row's height; the standard slot before row 0) and
 * slides up by that previous height — not its own — so its top lands on 0
 * exactly when its duration is up and the next row starts at its bottom.
 * With equal heights this is `(1 - scrollFraction) * slot`, byte for byte.
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
 *                       negative values clamp to the start
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
	const frac = n === 0 ? 0 : Math.min(1, s - currentRow);

	let top = 0;
	for (let i = 0; i < currentRow; i++) top += heights[i];
	const prevHeight = currentRow === 0 ? slotHeight : heights[currentRow - 1];
	// Row `currentRow` must sit at y = prevHeight * (1 - frac): top + translateY.
	const translateY = prevHeight * (1 - frac) - top;

	let tallest = 0;
	for (const h of heights) tallest = Math.max(tallest, h);
	const viewportHeight = Math.max(slotHeight * visibleRows, 2 * tallest);

	return { translateY, currentRow, viewportHeight };
}
