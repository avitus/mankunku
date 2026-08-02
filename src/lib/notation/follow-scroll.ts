/**
 * Pure teleprompter-style follow-scroll math for multi-system lead sheets.
 *
 * Given per-system vertical tops and the absolute notation bars each system
 * covers, maps a fractional bar position to a translateY offset that keeps the
 * music near a fixed reading line — continuously, the same way lick-practice
 * drives UpcomingKeysDisplay from transport ticks.
 *
 * No DOM. Callers measure SVG geometry and pass numbers.
 */

/** One rendered staff system and the absolute notation bars it covers. */
export interface FollowSystem {
	/** Absolute notation bar at the start of this system (inclusive). */
	firstBar: number;
	/** Absolute notation bar just past the last bar on this system (exclusive). */
	lastBarExclusive: number;
	/** Top of the system in rendered pixels (already scaled from SVG user space). */
	topPx: number;
}

export interface FollowScrollArgs {
	/** Systems ordered top → bottom. Empty → offset 0. */
	systems: readonly FollowSystem[];
	/**
	 * Fractional absolute notation bar (e.g. 3.42 = 42% through bar 3).
	 * Values before the first system or with no geometry yield 0.
	 */
	barFraction: number;
	/** Viewport height in px (the clipped chart window). */
	viewportPx: number;
	/** Full chart content height in px. */
	contentPx: number;
	/**
	 * Where the current line sits in the viewport, 0 = top, 1 = bottom.
	 * Default matches the previous discrete follow scroll (~28% down).
	 */
	readingLine?: number;
}

/**
 * Compute the `translateY` (negative = content moves up) that places the
 * music for `barFraction` on the reading line.
 *
 * Within a multi-bar system the target Y lerps from this system's top toward
 * the next system's top, so the chart drifts continuously instead of sitting
 * still for a whole line then jumping. The last system holds its top (clamped
 * so we never overscroll past the content end).
 */
export function followOffsetPx(args: FollowScrollArgs): number {
	const { systems, barFraction, viewportPx, contentPx } = args;
	const readingLine = args.readingLine ?? 0.28;
	if (
		systems.length === 0 ||
		!Number.isFinite(barFraction) ||
		!Number.isFinite(viewportPx) ||
		!Number.isFinite(contentPx) ||
		viewportPx <= 0 ||
		contentPx <= 0
	) {
		return 0;
	}
	const maxScroll = Math.max(0, contentPx - viewportPx);
	if (maxScroll === 0) return 0;

	const targetY = targetContentY(systems, barFraction);
	if (!Number.isFinite(targetY)) return 0;
	const offset = targetY - viewportPx * readingLine;
	// Negate for translateY; coerce -0 → 0 so callers can use Object.is-stable zeros.
	const scrolled = -clamp(offset, 0, maxScroll);
	return scrolled === 0 ? 0 : scrolled;
}

/**
 * Content Y (px from chart top) for a fractional bar — the point that should
 * sit on the reading line before clamping.
 */
export function targetContentY(systems: readonly FollowSystem[], barFraction: number): number {
	if (systems.length === 0) return 0;

	// Before the chart: park on the first system.
	if (barFraction < systems[0].firstBar) return systems[0].topPx;

	const last = systems[systems.length - 1];
	// Past the form: park on the last system.
	if (barFraction >= last.lastBarExclusive) return last.topPx;

	const i = systemIndexForBar(systems, barFraction);
	const sys = systems[i];
	const span = sys.lastBarExclusive - sys.firstBar;
	const t = span > 0 ? (barFraction - sys.firstBar) / span : 0;
	const next = systems[i + 1];
	if (!next) return sys.topPx;
	return sys.topPx + (next.topPx - sys.topPx) * clamp(t, 0, 1);
}

/**
 * Build follow systems from per-bar zone identities + measured system tops.
 * `barZones` entries need absolute notation bar + system index; tops are
 * parallel to system indices (missing tops are skipped).
 */
export function buildFollowSystems(
	barZones: readonly { absBar: number; systemIdx: number }[],
	systemTopsPx: readonly number[]
): FollowSystem[] {
	if (barZones.length === 0 || systemTopsPx.length === 0) return [];

	const bySystem = new Map<number, { min: number; maxEx: number }>();
	for (const z of barZones) {
		if (!Number.isFinite(z.absBar) || !Number.isFinite(z.systemIdx)) continue;
		const cur = bySystem.get(z.systemIdx);
		if (!cur) {
			bySystem.set(z.systemIdx, { min: z.absBar, maxEx: z.absBar + 1 });
		} else {
			cur.min = Math.min(cur.min, z.absBar);
			cur.maxEx = Math.max(cur.maxEx, z.absBar + 1);
		}
	}

	const indices = [...bySystem.keys()].sort((a, b) => a - b);
	const out: FollowSystem[] = [];
	for (const idx of indices) {
		const topPx = systemTopsPx[idx];
		if (topPx === undefined || !Number.isFinite(topPx)) continue;
		const range = bySystem.get(idx)!;
		out.push({ firstBar: range.min, lastBarExclusive: range.maxEx, topPx });
	}
	return out;
}

function systemIndexForBar(systems: readonly FollowSystem[], barFraction: number): number {
	const bar = Math.floor(barFraction);
	for (let i = 0; i < systems.length; i++) {
		const s = systems[i];
		if (
			Number.isFinite(s.firstBar) &&
			Number.isFinite(s.lastBarExclusive) &&
			bar >= s.firstBar &&
			bar < s.lastBarExclusive
		) {
			return i;
		}
	}
	// Fallback: nearest system by firstBar (not always "last" — that jumped the
	// chart to the bottom when ranges were invalid/NaN).
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < systems.length; i++) {
		const s = systems[i];
		if (!Number.isFinite(s.firstBar)) continue;
		const dist = Math.abs(bar - s.firstBar);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

/**
 * Uniform CSS-px scale for a width-fluid SVG (`width: 100%`, preserved aspect).
 * Prefer this over getBoundingClientRect on a transformed chart — measuring the
 * painted box under translateY + overflow clipping feedback-loops in some
 * engines (Firefox) and can drive follow-scroll off into empty space.
 */
export function svgCssScale(cssWidthPx: number, viewBoxWidth: number): number {
	if (!(cssWidthPx > 0) || !(viewBoxWidth > 0) || !Number.isFinite(cssWidthPx) || !Number.isFinite(viewBoxWidth)) {
		return 0;
	}
	return cssWidthPx / viewBoxWidth;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}
