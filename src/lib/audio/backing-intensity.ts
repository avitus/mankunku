/**
 * Ensemble intensity arc: one deterministic, RNG-free number per bar in
 * [0.2, 0.9] that every generator reads to shape density, dynamics and
 * color — the band starts settled and builds chorus over chorus the way a
 * rhythm section actually plays a form.
 *
 * Intensity is derived state, never drawn state: it multiplies WEIGHTS
 * and probabilities at the existing draw sites (the draw counts per
 * stream are unchanged), so it can never reshuffle a seed stream. The
 * ×lerp(...) hooks staged across the bass/comp/drum increments all read
 * this value.
 */

/** Linear interpolation from `from` (t = 0) to `to` (t = 1). */
export function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

export interface BarIntensityInput {
	/** 0-based pass through the form; undefined for sectionless phrases. */
	chorusIndex?: number;
	/** Cadence bars lean in slightly. */
	isSectionFinalBar: boolean;
	/** 0-based bar index on the phrase timeline (flat ramp). */
	barIndex: number;
	/** Total bar count (flat ramp). */
	totalBars: number;
}

/**
 * The arc: mapped phrases build by chorus — 0.35 base, +0.20 per chorus
 * (capped at the third), +0.08 on cadence bars, clamped to [0.2, 0.9].
 * Sectionless phrases (4-bar loops, flat lick beds) ramp gently across
 * their length instead, capped at 0.7 — a loop should breathe, not peak.
 */
export function barIntensity(input: BarIntensityInput): number {
	if (input.chorusIndex !== undefined) {
		const raw =
			0.35 + 0.2 * Math.min(input.chorusIndex, 2) + (input.isSectionFinalBar ? 0.08 : 0);
		return Math.min(0.9, Math.max(0.2, raw));
	}
	const t = input.totalBars > 0 ? input.barIndex / input.totalBars : 0;
	return Math.min(0.45 + 0.25 * t, 0.7);
}
