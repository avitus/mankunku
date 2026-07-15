/**
 * Difficulty display utilities.
 *
 * Difficulty ranges from 1-100. For display, we group into 10 bands
 * (1-10, 11-20, ..., 91-100), colored by the theme-aware `--difficulty-N`
 * ramp in app.css: muted green (easy) → amber → muted brick-red (hard).
 */

export interface DifficultyDisplay {
	/** The 1-10 band number */
	band: number;
	/** Short label like "Band 3" or "Level 21-30" */
	label: string;
	/** CSS color for this band */
	color: string;
	/** Band name for display */
	name: string;
}

const BAND_NAMES: string[] = [
	'Beginner',
	'Elementary',
	'Easy',
	'Moderate',
	'Intermediate',
	'Challenging',
	'Advanced',
	'Expert',
	'Master',
	'Virtuoso',
];

/**
 * Get the 1-10 band number for a difficulty value (1-100).
 */
export function difficultyBand(difficulty: number): number {
	const clamped = Math.max(1, Math.min(100, difficulty));
	return Math.min(10, Math.ceil(clamped / 10));
}

/**
 * Get the display color (a `var(--difficulty-N)` custom property) for a
 * difficulty value (1-100). Theme-aware; safe in an inline `style`.
 */
export function difficultyColor(difficulty: number): string {
	return `var(--difficulty-${difficultyBand(difficulty)})`;
}

/**
 * Get full display info for a difficulty value.
 */
export function difficultyDisplay(difficulty: number): DifficultyDisplay {
	const band = difficultyBand(difficulty);
	const lo = (band - 1) * 10 + 1;
	const hi = band * 10;
	return {
		band,
		label: `${lo}-${hi}`,
		color: `var(--difficulty-${band})`,
		name: BAND_NAMES[band - 1],
	};
}

/**
 * Display info for a proficiency / mastery value (0-100), using the Blue Note
 * teal→brass ramp instead of the green→red difficulty ramp — for a mastery
 * scale, high should read as *accomplishment* (brass), not danger (red).
 *
 * The color is a CSS custom property (`var(--mastery-N)`, defined in app.css)
 * rather than a literal hex, so the ramp re-steps automatically between the
 * dark and light themes. Safe to drop into an inline `style` attribute.
 */
export function masteryDisplay(value: number): DifficultyDisplay {
	const band = difficultyBand(value);
	const lo = (band - 1) * 10 + 1;
	const hi = band * 10;
	return {
		band,
		label: `${lo}-${hi}`,
		color: `var(--mastery-${band})`,
		name: BAND_NAMES[band - 1],
	};
}
