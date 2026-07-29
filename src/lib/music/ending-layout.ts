/**
 * Pure layout policy for first/second endings (voltas).
 *
 * Goals (Sibelius / Real Book):
 * - [1] continues the approach system when there is room (inline).
 * - [2] always opens a fresh system with NO musical pad bars; alignment
 *   under [1] is a post-render indent, not invisible measures inside the volta.
 * - When [1] would start at the left margin, both endings start at column 0.
 * - Stacked [2] music glyphs are **repositioned**, never horizontally scaled
 *   (scaling noteheads/chords was the source of squash + "2"/chord collisions).
 */

export interface EndingSectionShape {
	/** Length of the section in bars. */
	bars: number;
	/** 1 | 2 when this section is a numbered ending. */
	ending?: 1 | 2;
}

export interface EndingPlacement {
	/** Open a new system before this section. */
	startsNewLine: boolean;
	/**
	 * Column (0-based bars into the system) where this section's music starts.
	 * Used for reflow accounting only — never emitted as pad bars for [2].
	 */
	startColumn: number;
	/**
	 * True when this is a stacked second ending that should be aligned under
	 * the preceding first ending after SVG render.
	 */
	alignUnderFirstEnding: boolean;
	/**
	 * Column where the matching [1] started (for align hints / tests).
	 * Only set when alignUnderFirstEnding is true.
	 */
	alignToColumn?: number;
}

export interface EndingLayoutState {
	/** Bars already filled on the current open system (0 after a break). */
	lineColumn: number;
	/** Column where the open system ends after the previous section. */
	prevEndColumn: number;
	/** Column where the current [1] bracket started. */
	endingOneColumn: number;
}

export function initialEndingLayoutState(): EndingLayoutState {
	return { lineColumn: 0, prevEndColumn: 0, endingOneColumn: 0 };
}

/**
 * Decide how to place one section given prior state and bars-per-line.
 * Pure and side-effect free — the caller updates state via {@link advanceEndingLayout}.
 */
export function placeEndingSection(
	sec: EndingSectionShape,
	prev: EndingSectionShape | null,
	state: EndingLayoutState,
	barsPerLine: number
): EndingPlacement {
	const bpl = Math.max(1, barsPerLine);

	// Second ending: always a fresh system, no pad measures. Align under [1]
	// when [1] did not start at the left margin (column 0).
	if (sec.ending === 2) {
		const alignTo = state.endingOneColumn;
		return {
			startsNewLine: true,
			startColumn: 0,
			alignUnderFirstEnding: alignTo > 0,
			alignToColumn: alignTo > 0 ? alignTo : undefined
		};
	}

	// First ending: continue the approach system when there is remaining room.
	if (sec.ending === 1) {
		const canInline =
			prev !== null &&
			state.prevEndColumn > 0 &&
			state.prevEndColumn < bpl;
		if (canInline) {
			return {
				startsNewLine: false,
				startColumn: state.prevEndColumn,
				alignUnderFirstEnding: false
			};
		}
		return {
			startsNewLine: true,
			startColumn: 0,
			alignUnderFirstEnding: false
		};
	}

	// Ordinary section: always a new system (form break / double bar).
	return {
		startsNewLine: true,
		startColumn: 0,
		alignUnderFirstEnding: false
	};
}

/**
 * Advance layout state after a section has been placed and its bars emitted.
 * `startColumn` is the column where the section began (from {@link placeEndingSection}).
 */
export function advanceEndingLayout(
	sec: EndingSectionShape,
	placement: EndingPlacement,
	state: EndingLayoutState,
	barsPerLine: number
): EndingLayoutState {
	const bpl = Math.max(1, barsPerLine);
	const lineColumn = placement.startsNewLine ? 0 : placement.startColumn;

	// Where [1] starts on its system — used to know whether [2] needs indent.
	let endingOneColumn = state.endingOneColumn;
	if (sec.ending === 1) {
		// Only reset when this is a new first ending, not a continuation.
		// (We treat each ending:1 section as the [1] start for the following [2].)
		endingOneColumn = placement.startColumn;
	}

	// Column after this section's last bar within its last system line.
	const prevEndColumn =
		lineColumn === 0
			? sec.bars % bpl === 0
				? bpl
				: sec.bars % bpl
			: (lineColumn + sec.bars) % bpl;

	return {
		lineColumn,
		prevEndColumn,
		endingOneColumn
	};
}

/**
 * Plan placements for a full form. Convenience for tests and callers that
 * want the whole sequence at once.
 */
export function planEndingPlacements(
	sections: readonly EndingSectionShape[],
	barsPerLine: number
): EndingPlacement[] {
	let state = initialEndingLayoutState();
	const out: EndingPlacement[] = [];
	for (let i = 0; i < sections.length; i++) {
		const sec = sections[i];
		const prev = i > 0 ? sections[i - 1] : null;
		const placement = placeEndingSection(sec, prev, state, barsPerLine);
		out.push(placement);
		state = advanceEndingLayout(sec, placement, state, barsPerLine);
	}
	return out;
}

/**
 * Pure geometry for post-render indent: how far to shift second-ending content
 * so its left edge lines up under the first ending.
 */
export function endingAlignDx(firstEndingLeftX: number, secondEndingLeftX: number): number {
	if (!Number.isFinite(firstEndingLeftX) || !Number.isFinite(secondEndingLeftX)) return 0;
	const dx = firstEndingLeftX - secondEndingLeftX;
	// Ignore tiny jitter; never shift left (would shove [2] under the approach).
	if (dx < 0.5) return 0;
	return dx;
}

/**
 * Map second-ending coordinates onto the first ending's horizontal span.
 *
 * abcjs lays a short [2]-only system across the full staff width, so a plain
 * translate under [1] shoves a full-width volta off the right edge. Music
 * glyphs are repositioned with pure translates ({@link endingGlyphTranslateDx});
 * only line art (volta path) uses the scale term.
 *
 *   x' = sx * x + tx    where  sx = w1/w2,  tx = x1 - sx * x2
 */
export interface EndingAlignTransform {
	/** Horizontal scale for line art (1 = translate-only). */
	sx: number;
	/** Translation term in x' = sx * x + tx. */
	tx: number;
}

export function endingAlignTransform(
	first: { x: number; width: number },
	second: { x: number; width: number }
): EndingAlignTransform | null {
	if (
		!Number.isFinite(first.x) ||
		!Number.isFinite(first.width) ||
		!Number.isFinite(second.x) ||
		!Number.isFinite(second.width) ||
		first.width < 1 ||
		second.width < 1
	) {
		return null;
	}

	let sx = first.width / second.width;
	// Guard against pathological ratios (corrupt boxes / single-glyph endings).
	// 0.15 floor still allows a 2-bar [2] that was stretched full-staff (~500u)
	// to compress onto a compact [1] span (~100u).
	if (!Number.isFinite(sx) || sx < 0.15 || sx > 3) {
		sx = 1;
	}

	const tx = first.x - sx * second.x;
	// No-op when already aligned and same width.
	if (Math.abs(sx - 1) < 0.02 && Math.abs(tx) < 0.5 && Math.abs(first.x - second.x) < 0.5) {
		return null;
	}
	// Never expand a translate-only shift leftward.
	if (sx === 1 && tx < 0.5) return null;

	return { sx, tx };
}

/** SVG matrix(sx 0 0 1 tx 0) string for {@link endingAlignTransform} (line art only). */
export function endingAlignMatrix(t: EndingAlignTransform): string {
	return `matrix(${t.sx.toFixed(5)} 0 0 1 ${t.tx.toFixed(2)} 0)`;
}

/**
 * Pure horizontal translate that maps a glyph's center `cx` to the compressed
 * position `sx * cx + tx` **without scaling the glyph**.
 *
 * This is the correct treatment for noteheads, barlines, and chord text:
 * spacing compresses to fit under [1], but ovals stay oval and "2" stays
 * readable. Do **not** put these elements under a parent scale matrix.
 */
export function endingGlyphTranslateDx(sx: number, tx: number, cx: number): number {
	if (!Number.isFinite(sx) || !Number.isFinite(tx) || !Number.isFinite(cx)) return 0;
	const dx = (sx - 1) * cx + tx;
	return Math.abs(dx) < 0.5 ? 0 : dx;
}

export function endingGlyphTranslate(sx: number, tx: number, cx: number): string | null {
	const dx = endingGlyphTranslateDx(sx, tx, cx);
	if (dx === 0) return null;
	return `translate(${dx.toFixed(2)},0)`;
}

/** Minimum gap (SVG user units) between volta number and first chord. */
export const ENDING_LABEL_CHORD_MIN_GAP = 8;

/**
 * Minimum gap between the volta's **left hook** and the number ("2").
 * abcjs places the digit ~5u inside the hook; after we scale the path but
 * keep the digit full-size, that inset collapses and the digit sits on the
 * bracket — this pad restores a readable clearance.
 */
export const ENDING_LABEL_HOOK_MIN_GAP = 5;

/**
 * After pure-translate alignment, screen span of a rigid glyph (width unchanged).
 */
export function rigidGlyphScreenSpanAfterTranslate(
	sx: number,
	tx: number,
	localX: number,
	localWidth: number
): { left: number; right: number; cx: number } {
	const cx = localX + localWidth / 2;
	const screenCx = sx * cx + tx;
	const half = localWidth / 2;
	return { cx: screenCx, left: screenCx - half, right: screenCx + half };
}

/**
 * Extra +dx so a full-size volta number clears the (scaled) left hook.
 * `hookX` is the hook's x after the line-art matrix; `labelLeft` is the
 * number's left after pure-translate center mapping.
 */
export function endingLabelHookNudge(
	hookX: number,
	labelLeft: number,
	minGap: number = ENDING_LABEL_HOOK_MIN_GAP
): number {
	if (!Number.isFinite(hookX) || !Number.isFinite(labelLeft)) return 0;
	const need = hookX + minGap - labelLeft;
	return need > 0.5 ? need : 0;
}

/**
 * Vertical correction so stacked-[2] chords sit on the same row as [1].
 *
 * Inputs are **gaps above the staff top** (positive = above the staff), in
 * any consistent unit (user units or CSS px). If [2] floats higher than [1]
 * (`secondGap > firstGap`), returns a positive SVG `translate(0, dy)` amount
 * that drops [2] (SVG y increases downward). Never raises [2] above [1].
 */
export function endingChordVerticalMatchDy(
	firstGapAboveStaff: number,
	secondGapAboveStaff: number
): number {
	if (!Number.isFinite(firstGapAboveStaff) || !Number.isFinite(secondGapAboveStaff)) {
		return 0;
	}
	// second higher on screen ⇒ larger gap ⇒ need positive dy to drop.
	const dy = secondGapAboveStaff - firstGapAboveStaff;
	// Ignore sub-pixel noise; never pull [2] *up* to match a lower [1]
	// outlier (would re-introduce the "too high" look on the other side).
	if (dy < 0.5) return 0;
	return dy;
}

/** Mean of finite numbers, or null when empty. */
export function meanFinite(values: readonly number[]): number | null {
	let sum = 0;
	let n = 0;
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		sum += v;
		n += 1;
	}
	return n === 0 ? null : sum / n;
}

/**
 * Uniform extra +dx (already in the same space as glyph translates) so every
 * chord clears the volta label by {@link ENDING_LABEL_CHORD_MIN_GAP}.
 * Relative chord spacing is preserved.
 */
export function endingChordGroupNudge(
	label: { left: number; right: number },
	chords: readonly { left: number; right: number }[],
	minGap: number = ENDING_LABEL_CHORD_MIN_GAP
): number {
	if (!Number.isFinite(label.right) || chords.length === 0) return 0;
	let need = 0;
	for (const c of chords) {
		if (!Number.isFinite(c.left)) continue;
		const n = label.right + minGap - c.left;
		if (n > need) need = n;
	}
	return need > 0.5 ? need : 0;
}

/**
 * Full plan for stacked-[2] rigid glyphs after align transform.
 *
 * Invariants (locked by tests):
 * 1. Glyph screen width equals local width (no horizontal squash).
 * 2. Glyph centers map to sx*cx+tx (compressed under [1]).
 * 3. Volta number clears the left hook (labelExtraDx).
 * 4. Volta label and chords do not overlap (uniform chord nudge).
 *
 * @param hookLocalX  Pre-align local x of the volta left hook (ending left).
 *                    After the line-art matrix the hook sits at `sx*hookLocalX+tx`.
 */
export function planStackedEndingRigidGlyphs(
	xform: EndingAlignTransform,
	label: { x: number; width: number } | null,
	chords: readonly { x: number; width: number }[],
	hookLocalX?: number
): {
	/** Extra translate on the volta number after center mapping. */
	labelExtraDx: number;
	/** Extra translate applied to every chord on top of the center map. */
	chordExtraDx: number;
	labelScreen: { left: number; right: number } | null;
	chordScreens: { left: number; right: number }[];
	hookScreenX: number | null;
} {
	const { sx, tx } = xform;
	const hookScreenX =
		hookLocalX !== undefined && Number.isFinite(hookLocalX) ? sx * hookLocalX + tx : null;

	const rawLabel = label
		? rigidGlyphScreenSpanAfterTranslate(sx, tx, label.x, label.width)
		: null;
	const labelExtraDx =
		rawLabel && hookScreenX !== null
			? endingLabelHookNudge(hookScreenX, rawLabel.left)
			: 0;
	const labelScreen = rawLabel
		? {
				left: rawLabel.left + labelExtraDx,
				right: rawLabel.right + labelExtraDx
			}
		: null;

	const rawChordScreens = chords.map((c) =>
		rigidGlyphScreenSpanAfterTranslate(sx, tx, c.x, c.width)
	);
	// Nudge is in the same user space as pure-translate maps (no parent scale
	// on glyphs), so extra dx applies 1:1.
	const chordExtraDx = labelScreen
		? endingChordGroupNudge(labelScreen, rawChordScreens)
		: 0;
	const chordScreens = rawChordScreens.map((s) => ({
		left: s.left + chordExtraDx,
		right: s.right + chordExtraDx
	}));

	return { labelExtraDx, chordExtraDx, labelScreen, chordScreens, hookScreenX };
}

// ─── Deprecated aliases (call sites may still import briefly) ───────────

/** @deprecated Use {@link endingGlyphTranslate}. */
export function endingRigidGlyphCounterScale(sx: number, cx: number): string | null {
	// Old counter-scale API — kept only so accidental imports typecheck.
	// New code must use endingGlyphTranslate (no parent scale on glyphs).
	if (!Number.isFinite(sx) || !Number.isFinite(cx) || Math.abs(sx) < 1e-6) return null;
	if (Math.abs(sx - 1) < 0.02) return null;
	const inv = 1 / sx;
	return `translate(${cx.toFixed(2)},0) scale(${inv.toFixed(5)},1) translate(${(-cx).toFixed(2)},0)`;
}

/** @deprecated */
export const endingBarCounterScale = endingRigidGlyphCounterScale;

/** @deprecated Screen nudge is 1:1 with glyph space under pure-translate. */
export function endingScreenNudgeToLocal(screenDx: number, _sx: number): number {
	return screenDx > 0 ? screenDx : 0;
}

/** @deprecated Use {@link rigidGlyphScreenSpanAfterTranslate}. */
export const rigidGlyphScreenSpan = rigidGlyphScreenSpanAfterTranslate;
