/**
 * The ONE rule for which meters a tune may carry. The adopted-tune validator
 * gates foreign tunes with it, and every importer that reads a meter from file
 * data refuses one outside it, so nothing an import saves is hidden later by
 * the community gate.
 */

/**
 * Largest numerator. The community preview draws one beat mark per numerator
 * in every preview bar, so an author's [100000000, 4] was 10^8 elements per
 * bar; 32 clears every real meter (12/8, 15/8, 7/4).
 */
export const MAX_METER_NUMERATOR = 32;

/**
 * Note values a denominator may name, whole through sixty-fourth. Bounded
 * because a huge denominator makes tiny bars, and the engravers split every
 * note at each barline it crosses.
 */
export const METER_DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

/** A meter of whole beats: integer numerator 1–32 over a power-of-two note value up to 64. */
export function isSupportedMeter(value: unknown): value is [number, number] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		Number.isInteger(value[0]) &&
		value[0] >= 1 &&
		value[0] <= MAX_METER_NUMERATOR &&
		METER_DENOMINATORS.includes(value[1])
	);
}
