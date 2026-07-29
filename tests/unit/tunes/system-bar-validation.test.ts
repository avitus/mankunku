import { describe, it, expect } from 'vitest';
import {
	barTilingIssues,
	isRestPitch,
	type BarMelody
} from '$lib/tunes/import/system-bar-validation';

const bar = (events: Array<[number, number, string]>): BarMelody => events;

describe('isRestPitch', () => {
	it('matches "rest" case-insensitively and nothing else', () => {
		expect(isRestPitch('rest')).toBe(true);
		expect(isRestPitch('Rest')).toBe(true);
		expect(isRestPitch(' REST ')).toBe(true);
		expect(isRestPitch('C4')).toBe(false);
		expect(isRestPitch('r')).toBe(false);
	});
});

describe('barTilingIssues', () => {
	it('accepts a bar whose notes and rests tile the meter exactly', () => {
		expect(
			barTilingIssues(bar([[0, 1, 'C4'], [1, 0.5, 'rest'], [1.5, 2.5, 'D4']]), 0, 4)
		).toEqual([]);
	});

	it('accepts triplet bars via rational snapping', () => {
		const third = 1 / 3;
		expect(
			barTilingIssues(
				bar([
					[0, third, 'C4'],
					[third, third, 'D4'],
					[2 * third, third, 'E4'],
					[1, 3, 'rest']
				]),
				0,
				4
			)
		).toEqual([]);
	});

	it('flags an internal gap with the exact position', () => {
		const issues = barTilingIssues(bar([[0, 2, 'C4'], [3, 1, 'D4']]), 2, 4);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain('bar 3');
		expect(issues[0]).toContain('gap');
		expect(issues[0]).toContain('beat 2');
	});

	it('flags overlapping events', () => {
		const issues = barTilingIssues(bar([[0, 3, 'C4'], [2, 2, 'D4']]), 0, 4);
		expect(issues.join(' ')).toContain('overlap');
	});

	it('flags an overfull bar with its actual sum', () => {
		const issues = barTilingIssues(bar([[0, 4, 'C4'], [4, 0.5, 'D4']]), 0, 4);
		expect(issues.join(' ')).toMatch(/sums to 4\.5 beats — the bar must fill exactly 4 beats/);
	});

	it('flags an underfull bar', () => {
		const issues = barTilingIssues(bar([[0, 3, 'C4']]), 0, 4);
		expect(issues.join(' ')).toMatch(/sums to 3 beats — the bar must fill exactly 4 beats/);
	});

	it('flags a missing leading rest on ordinary bars but allows it on pickups', () => {
		const events = bar([[3, 1, 'A4']]);
		expect(barTilingIssues(events, 0, 4).join(' ')).toContain('beat 0');
		expect(barTilingIssues(events, 0, 4, { allowLeadingGap: true })).toEqual([]);
	});

	it('flags an empty bar (a printed whole rest must be reported)', () => {
		expect(barTilingIssues(bar([]), 4, 4).join(' ')).toContain('bar 5');
	});
});
