import { describe, it, expect } from 'vitest';
import { formatDuration, formatMinutes } from '$lib/util/format-duration';

describe('formatDuration', () => {
	it('formats sub-minute durations with a padded seconds field', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(7)).toBe('0:07');
		expect(formatDuration(59)).toBe('0:59');
	});

	it('rolls over into minutes', () => {
		expect(formatDuration(60)).toBe('1:00');
		expect(formatDuration(61)).toBe('1:01');
		expect(formatDuration(599)).toBe('9:59');
		expect(formatDuration(3599)).toBe('59:59');
	});

	it('adds an hours field only once an hour has elapsed', () => {
		expect(formatDuration(3600)).toBe('1:00:00');
		expect(formatDuration(3661)).toBe('1:01:01');
		expect(formatDuration(36000)).toBe('10:00:00');
	});

	it('clamps negative input to zero rather than emitting a negative clock', () => {
		expect(formatDuration(-1)).toBe('0:00');
	});

	it('truncates fractional seconds', () => {
		expect(formatDuration(9.9)).toBe('0:09');
	});
});

describe('formatMinutes', () => {
	it('reads a sub-hour total in minutes', () => {
		expect(formatMinutes(0)).toBe('0m');
		expect(formatMinutes(1)).toBe('1m');
		expect(formatMinutes(43)).toBe('43m');
		expect(formatMinutes(59)).toBe('59m');
	});

	it('splits an hour off once there is one', () => {
		expect(formatMinutes(60)).toBe('1h');
		expect(formatMinutes(72)).toBe('1h 12m');
		expect(formatMinutes(125)).toBe('2h 5m');
		expect(formatMinutes(600)).toBe('10h');
	});

	it('drops a zero minutes field rather than printing "1h 0m"', () => {
		expect(formatMinutes(120)).toBe('2h');
	});

	it('rounds fractions and clamps negatives, like the clock formatter', () => {
		expect(formatMinutes(4.6)).toBe('5m');
		expect(formatMinutes(-3)).toBe('0m');
	});
});
