import { describe, expect, it } from 'vitest';
import { signedCents, tuningTier } from '$lib/ui/tuning-tone';

describe('tuning tier', () => {
	it.each([
		[0, 'gold'], [5, 'gold'], [5.5, 'silver'], [10, 'silver'],
		[10.5, 'bronze'], [19, 'bronze'], [19.5, 'teal'], [20, 'teal'], [50, 'teal']
	])('assigns the same accuracy color at ±%s cents', (cents, token) => {
		expect(tuningTier(Number(cents)).color).toBe(`var(--accuracy-${token})`);
		expect(tuningTier(-Number(cents))).toBe(tuningTier(Number(cents)));
	});
});

describe('signed cents', () => {
	it.each([
		[22.4, '+22'],
		[-19.5, '−20'],
		[-11.6, '−12'],
		[0.3, '±0'],
		[-0.4, '±0']
	])('formats %s as %s with a real minus sign', (cents, text) => {
		expect(signedCents(cents)).toBe(text);
	});
});
