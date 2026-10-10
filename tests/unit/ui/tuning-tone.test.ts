import { describe, expect, it } from 'vitest';
import { signedCents, tuningTone } from '$lib/ui/tuning-tone';

describe('tuning tone', () => {
	it.each([0, 5, -5])('reads %s cents as in tune, in the text colour', cents => {
		expect(tuningTone(cents)).toBe('var(--color-text)');
	});

	it('steps out of the zone rather than fading, so 6¢ already leans', () => {
		// A fade from zero would mix in well under 10% one cent past the zone.
		const mix = Number(tuningTone(6).match(/var\(--color-tune-sharp\) (\d+)%/)?.[1]);
		expect(mix).toBeGreaterThanOrEqual(45);
		expect(mix).toBeLessThan(100);
	});

	it('is still short of full colour one cent under the cue', () => {
		expect(tuningTone(11)).not.toContain('100%');
	});

	it.each([
		[12, 'var(--color-tune-sharp)'],
		[40, 'var(--color-tune-sharp)'],
		[-12, 'var(--color-tune-flat)'],
		[-40, 'var(--color-tune-flat)']
	])('reaches full colour where the sharp/flat cue speaks: %s', (cents, pole) => {
		expect(tuningTone(cents)).toBe(`color-mix(in oklab, ${pole} 100%, var(--color-text))`);
	});
});

describe('signed cents', () => {
	it.each([
		[22.4, '+22'],
		[-11.6, '−12'],
		[0.3, '±0'],
		[-0.4, '±0']
	])('formats %s as %s with a real minus sign', (cents, text) => {
		expect(signedCents(cents)).toBe(text);
	});
});
