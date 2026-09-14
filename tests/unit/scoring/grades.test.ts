import { describe, it, expect, vi } from 'vitest';
import { scoreToGrade, getGradeCaption, GRADE_LABELS, GRADE_CAPTIONS } from '$lib/scoring/grades';

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
	it('labels are non-empty strings', () => {
		for (const key of GRADE_KEYS) {
			expect(GRADE_LABELS[key]).toBeTruthy();
		}
	});
	// GRADE_COLORS now lives in the UI layer; its color mapping is covered by
	// tests/unit/ui/score-colors.test.ts.
});

describe('getGradeCaption', () => {
	it('draws from the pool of the grade asked for, across its whole range', () => {
		const random = vi.spyOn(Math, 'random');
		try {
			for (const key of GRADE_KEYS) {
				const pool = GRADE_CAPTIONS[key];
				random.mockReturnValue(0);
				expect(getGradeCaption(key)).toBe(pool[0]);
				random.mockReturnValue(0.999999);
				expect(getGradeCaption(key)).toBe(pool[pool.length - 1]);
			}
		} finally {
			random.mockRestore();
		}
	});
});
