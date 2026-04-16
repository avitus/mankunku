/**
 * Score-to-grade mapping.
 *
 * perfect: >= 95%
 * great:   >= 85%
 * good:    >= 70%
 * fair:    >= 55%
 * try-again: < 55%
 */

import type { Grade } from '$lib/types/scoring.ts';

const GRADE_THRESHOLDS: { grade: Grade; min: number }[] = [
	{ grade: 'perfect', min: 0.95 },
	{ grade: 'great', min: 0.85 },
	{ grade: 'good', min: 0.70 },
	{ grade: 'fair', min: 0.55 }
];

export function scoreToGrade(overall: number): Grade {
	for (const { grade, min } of GRADE_THRESHOLDS) {
		if (overall >= min) return grade;
	}
	return 'try-again';
}

/** Display label for each grade */
export const GRADE_LABELS: Record<Grade, string> = {
	perfect: 'Perfect',
	great: 'Great',
	good: 'Good',
	fair: 'Fair',
	'try-again': 'Try Again'
};

/** CSS color variable for each grade */
export const GRADE_COLORS: Record<Grade, string> = {
	perfect: 'var(--color-success)',
	great: 'var(--color-success)',
	good: 'var(--color-accent)',
	fair: 'var(--color-warning)',
	'try-again': 'var(--color-error)'
};

/**
 * Liner-note style grade captions — small italic one-liners in the tone
 * of a Blue Note sleeve, shown below the grade label to add warmth.
 */
export const GRADE_CAPTIONS: Record<Grade, string> = {
	perfect: 'Right in the pocket.',
	great: 'Cookin\u2019.',
	good: 'Swinging along.',
	fair: 'A little off the changes.',
	'try-again': 'Take it again from the top.'
};
