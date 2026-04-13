import { describe, it, expect } from 'vitest';
import { scoreToGrade } from '$lib/scoring/grades.ts';

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
