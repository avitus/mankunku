import { describe, it, expect } from 'vitest';
import { levelSignalDirection } from '$lib/difficulty/level-signal';

describe('levelSignalDirection', () => {
	it('returns null when neither level changes', () => {
		expect(levelSignalDirection(10, 10, 4, 4)).toBeNull();
	});

	it('returns "up" when the primary level rises', () => {
		expect(levelSignalDirection(10, 11, 4, 4)).toBe('up');
	});

	it('returns "up" when the scale level rises', () => {
		expect(levelSignalDirection(10, 10, 4, 5)).toBe('up');
	});

	it('returns "up" when both levels rise', () => {
		expect(levelSignalDirection(10, 11, 4, 5)).toBe('up');
	});

	it('returns "down" when the primary level falls', () => {
		expect(levelSignalDirection(11, 10, 4, 4)).toBe('down');
	});

	it('returns "down" when the scale level falls', () => {
		expect(levelSignalDirection(10, 10, 5, 4)).toBe('down');
	});

	it('returns "down" when both levels fall', () => {
		expect(levelSignalDirection(11, 10, 5, 4)).toBe('down');
	});

	it('prefers "up" when one level rises while the other falls', () => {
		expect(levelSignalDirection(10, 11, 5, 4)).toBe('up');
		expect(levelSignalDirection(11, 10, 4, 5)).toBe('up');
	});
});
