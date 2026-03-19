/**
 * Difficulty display utilities.
 *
 * Difficulty ranges from 1-100. For display, we group into 10 color-coded
 * bands (1-10, 11-20, ..., 91-100). Colors progress from green (easy)
 * through yellow/orange to red (hardest).
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

/**
 * Color for each of the 10 difficulty bands (1-10).
 * Progresses green -> yellow -> orange -> red.
 */
const BAND_COLORS: string[] = [
	'#22c55e', // Band 1  (1-10)   — green
	'#4ade80', // Band 2  (11-20)  — light green
	'#84cc16', // Band 3  (21-30)  — lime
	'#a3e635', // Band 4  (31-40)  — yellow-green
	'#facc15', // Band 5  (41-50)  — yellow
	'#f59e0b', // Band 6  (51-60)  — amber
	'#f97316', // Band 7  (61-70)  — orange
	'#ef4444', // Band 8  (71-80)  — red
	'#dc2626', // Band 9  (81-90)  — dark red
	'#991b1b', // Band 10 (91-100) — deep red
];

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
 * Get the display color for a difficulty value (1-100).
 */
export function difficultyColor(difficulty: number): string {
	return BAND_COLORS[difficultyBand(difficulty) - 1];
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
		color: BAND_COLORS[band - 1],
		name: BAND_NAMES[band - 1],
	};
}
