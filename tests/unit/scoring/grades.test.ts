import { describe, it, expect } from 'vitest';
import { scoreToGrade, GRADE_LABELS, GRADE_COLORS } from '$lib/scoring/grades.ts';

const GRADE_KEYS = ['perfect', 'great', 'good', 'fair', 'try-again'] as const;

describe('scoreToGrade', () => {
	it('1.0 → perfect', () => {
		expect(scoreToGrade(1.0)).toBe('perfect');
	});

	it('0.95 → perfect (boundary)', () => {
		expect(scoreToGrade(0.95)).toBe('perfect');
	});

	it('0.949 → great (just below perfect)', () => {
		expect(scoreToGrade(0.949)).toBe('great');
	});

	it('0.85 → great (boundary)', () => {
		expect(scoreToGrade(0.85)).toBe('great');
	});

	it('0.849 → good (just below great)', () => {
		expect(scoreToGrade(0.849)).toBe('good');
	});

	it('0.70 → good (boundary)', () => {
		expect(scoreToGrade(0.70)).toBe('good');
	});

	it('0.699 → fair (just below good)', () => {
		expect(scoreToGrade(0.699)).toBe('fair');
	});

	it('0.55 → fair (boundary)', () => {
		expect(scoreToGrade(0.55)).toBe('fair');
	});

	it('0.549 → try-again (just below fair)', () => {
		expect(scoreToGrade(0.549)).toBe('try-again');
	});

	it('0 → try-again', () => {
		expect(scoreToGrade(0)).toBe('try-again');
	});
});

describe('grade display mappings', () => {
	it('both exports cover every grade key with no drift', () => {
		expect(Object.keys(GRADE_LABELS).sort()).toEqual([...GRADE_KEYS].sort());
		expect(Object.keys(GRADE_COLORS).sort()).toEqual([...GRADE_KEYS].sort());
	});

	it('labels are non-empty strings and colors are CSS color vars', () => {
		for (const key of GRADE_KEYS) {
			expect(GRADE_LABELS[key]).toBeTruthy();
			expect(GRADE_COLORS[key]).toMatch(/^var\(--color-/);
		}
	});
});
