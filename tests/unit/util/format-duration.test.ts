import { describe, it, expect } from 'vitest';
import { formatDuration } from '$lib/util/format-duration';

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
