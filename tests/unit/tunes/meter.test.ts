import { describe, expect, it } from 'vitest';
import { isSupportedMeter, MAX_METER_NUMERATOR } from '$lib/tunes/meter';

describe('isSupportedMeter', () => {
	it('accepts every meter the importers and the PDF meter picker produce', () => {
		for (const meter of [[4, 4], [3, 4], [2, 2], [2, 4], [3, 2], [6, 8], [5, 4], [7, 8], [12, 8], [MAX_METER_NUMERATOR, 64]]) {
			expect(isSupportedMeter(meter)).toBe(true);
		}
	});

	it('bounds the numerator: the community preview draws one beat mark per numerator (CodeRabbit on #277)', () => {
		expect(isSupportedMeter([100_000_000, 4])).toBe(false);
		expect(isSupportedMeter([MAX_METER_NUMERATOR + 1, 8])).toBe(false);
		expect(isSupportedMeter([4.5, 4])).toBe(false);
		expect(isSupportedMeter([0, 4])).toBe(false);
	});

	it('takes a power-of-two note value from whole to sixty-fourth', () => {
		expect(isSupportedMeter([4, 3])).toBe(false);
		expect(isSupportedMeter([4, 128])).toBe(false);
		expect(isSupportedMeter([4, 0])).toBe(false);
	});

	it('rejects anything that is not a pair of numbers', () => {
		expect(isSupportedMeter(null)).toBe(false);
		expect(isSupportedMeter([4])).toBe(false);
		expect(isSupportedMeter(['4', '4'])).toBe(false);
	});
});
