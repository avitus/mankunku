/**
 * Accuracy medal scale.
 *
 * The counterpart to the Tonal Mastery ramp (difficulty/display.ts's
 * `masteryDisplay`). Mastery is a smooth teal→gold climb that reads high =
 * accomplishment. Accuracy is a PERFORMANCE score (poor → perfect), so it needs
 * the opposite treatment: DISCRETE tiers with meaningful breakpoints, so a
 * glance tells you which keys/notes need work.
 *
 * Five tiers — podium medals for good takes, two teal shades below "decent":
 *
 *   gold   ≥ 95%  excellence
 *   silver 85–94% very good
 *   bronze 70–84% decent
 *   teal   55–69% needs work
 *   deep   < 55%  rough
 *
 * Breakpoints match the Grade thresholds (see scoring/grades.ts) so grades,
 * report chips, the key ring, and per-note colors all agree. Each color is a
 * theme-aware CSS custom property (`var(--accuracy-*)`, defined in app.css),
 * safe to drop into an inline `style`.
 */

export type AccuracyTierKey = 'gold' | 'silver' | 'bronze' | 'teal' | 'deep';

export interface AccuracyTier {
	key: AccuracyTierKey;
	/** Minimum score (0-1, inclusive) for this tier. */
	min: number;
	/** CSS custom property, e.g. `var(--accuracy-gold)`. */
	color: string;
	/** Short human label. */
	label: string;
	/** Percent range for legends/tooltips, e.g. "85–94%". */
	range: string;
}

/** Tiers in descending score order. Source of truth for the thresholds. */
export const ACCURACY_TIERS: readonly AccuracyTier[] = [
	{ key: 'gold', min: 0.95, color: 'var(--accuracy-gold)', label: 'Excellence', range: '≥ 95%' },
	{ key: 'silver', min: 0.85, color: 'var(--accuracy-silver)', label: 'Very good', range: '85–94%' },
	{ key: 'bronze', min: 0.7, color: 'var(--accuracy-bronze)', label: 'Decent', range: '70–84%' },
	{ key: 'teal', min: 0.55, color: 'var(--accuracy-teal)', label: 'Needs work', range: '55–69%' },
	{ key: 'deep', min: 0, color: 'var(--accuracy-deep)', label: 'Rough', range: '< 55%' }
];

/**
 * The accuracy tier for a score in [0, 1]. Input is clamped, so out-of-range
 * values map to the nearest tier.
 */
export function accuracyTierInfo(score01: number): AccuracyTier {
	const s = Math.max(0, Math.min(1, score01));
	// Tiers are descending by `min`; the first whose threshold we clear wins.
	return ACCURACY_TIERS.find((t) => s >= t.min) ?? ACCURACY_TIERS[ACCURACY_TIERS.length - 1];
}

/**
 * The CSS color (`var(--accuracy-*)`) for a score in [0, 1]. Safe in an inline
 * `style` attribute. This is the one-stop helper for chips, the key ring, grade
 * readouts, and per-note pitch/rhythm colors.
 */
export function accuracyTier(score01: number): string {
	return accuracyTierInfo(score01).color;
}
