/**
 * Unit tests for the small helpers in `progressions.ts` that are not exercised
 * directly by the existing PROGRESSION_TEMPLATES / transposeProgression
 * suites.  Both helpers feed `getLickBars` / lick-practice alignment, so
 * regressions here surface as off-by-one bar errors in the chord chart.
 */
import { describe, it, expect } from 'vitest';
import {
	applyPickupBarShift,
	extendHarmonyTail,
	detectPickupBars
} from '$lib/data/progressions';
import type { Fraction, HarmonicSegment, Note } from '$lib/types/music';

describe('applyPickupBarShift', () => {
	it('returns the original alignment when pickupBars <= 0', () => {
		// Tests both the early-return guard and the negative-pickup path.
		expect(applyPickupBarShift([2, 1], 0)).toEqual([2, 1]);
		expect(applyPickupBarShift([2, 1], -1)).toEqual([2, 1]);
	});

	it('subtracts pickupBars whole bars from the alignment', () => {
		// Lick aligned to bar 2 with a 1-bar pickup → bulk lands on bar 1.
		expect(applyPickupBarShift([2, 1], 1)).toEqual([1, 1]);
		// Lick aligned to bar 3 with a 2-bar pickup → bulk lands on bar 1.
		expect(applyPickupBarShift([3, 1], 2)).toEqual([1, 1]);
	});

	it('clamps to [0,1] when the pickup overshoots the base alignment', () => {
		// More pickup bars than the base alignment — clamp at start of cycle
		// rather than yielding a negative numerator.
		expect(applyPickupBarShift([1, 1], 3)).toEqual([0, 1]);
		expect(applyPickupBarShift([2, 1], 5)).toEqual([0, 1]);
	});

	it('preserves a non-1 denominator on subtraction', () => {
		// Half-bar alignment with a 1-bar pickup: subtracts denominator units.
		// [1, 2] − 1 × 2/2 = [-1, 2] → clamp to [0, 1].
		expect(applyPickupBarShift([1, 2], 1)).toEqual([0, 1]);
	});
});

describe('extendHarmonyTail', () => {
	const last = (h: HarmonicSegment[]): HarmonicSegment => h[h.length - 1];

	it('returns the same array reference when extraBars <= 0', () => {
		const h: HarmonicSegment[] = [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		];
		expect(extendHarmonyTail(h, 0)).toBe(h);
		expect(extendHarmonyTail(h, -1)).toBe(h);
	});

	it('returns the same array reference when harmony is empty', () => {
		const h: HarmonicSegment[] = [];
		expect(extendHarmonyTail(h, 5)).toBe(h);
	});

	it('lengthens the last segment by extraBars whole bars (denominator-aware)', () => {
		// `[1, 1]` (one whole bar) + 2 bars → `[3, 1]` (three whole bars total).
		const h: HarmonicSegment[] = [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		];
		const ext = extendHarmonyTail(h, 2);
		expect(last(ext).duration).toEqual([3, 1]);
	});

	it('preserves a non-1 denominator: half-note last seg + 1 bar = [3, 2]', () => {
		// 1 bar = 2 half-notes; the helper adds `extraBars * denominator` to
		// the numerator, so [1, 2] + 1 bar → [1 + 1*2, 2] = [3, 2].
		const h: HarmonicSegment[] = [
			{
				chord: { root: 'C', quality: '7' },
				scaleId: 'major.mixolydian',
				startOffset: [0, 1],
				duration: [1, 2]
			}
		];
		const ext = extendHarmonyTail(h, 1);
		expect(last(ext).duration).toEqual([3, 2]);
	});

	it('does not mutate the input array', () => {
		const h: HarmonicSegment[] = [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		];
		const before = JSON.stringify(h);
		extendHarmonyTail(h, 3);
		expect(JSON.stringify(h)).toBe(before);
	});

	it('only touches the last segment, leaving earlier ones alone', () => {
		const h: HarmonicSegment[] = [
			{
				chord: { root: 'D', quality: 'min7' },
				scaleId: 'major.dorian',
				startOffset: [0, 1],
				duration: [1, 1]
			},
			{
				chord: { root: 'G', quality: '7' },
				scaleId: 'major.mixolydian',
				startOffset: [1, 1],
				duration: [1, 1]
			}
		];
		const ext = extendHarmonyTail(h, 2);
		expect(ext[0]).toEqual(h[0]);
		expect(ext[1].duration).toEqual([3, 1]);
		expect(ext[1].chord).toEqual(h[1].chord);
		expect(ext[1].startOffset).toEqual(h[1].startOffset);
	});
});

describe('detectPickupBars — boundary cases not covered elsewhere', () => {
	const note = (offset: Fraction, pitch: number | null = 60): Note => ({
		pitch,
		offset,
		duration: [1, 8]
	});

	it('returns 0 when the lick has no sounded notes (rests only)', () => {
		// All-rest "lick" — pickup detection has nothing to anchor to and
		// safely returns 0 rather than reading off an empty array.
		expect(detectPickupBars([note([0, 1], null), note([1, 4], null)])).toBe(0);
	});

	it('ignores rests so pickup-with-rests still counts as a 1-bar pickup', () => {
		// Step-entered pickup: rests in bar 0 followed by a sounded eighth at
		// [3, 4], then the bulk on the bar-1 downbeat. The earliest sounded
		// note is at 0.75 — the function must NOT use the rest at [0, 1] as
		// the earliest position.
		const notes: Note[] = [
			note([0, 1], null),
			note([1, 4], null),
			note([1, 2], null),
			note([3, 4], 60), // pickup pitch in bar 0
			note([1, 1], 64) // downbeat of bar 1 — the bulk
		];
		expect(detectPickupBars(notes)).toBe(1);
	});

	it('returns 0 when no sounded note lands on a whole-bar downbeat', () => {
		// Even if the earliest sounded note isn't on a downbeat, without a
		// later downbeat anchor the function defers (returns 0) rather than
		// guessing.
		expect(detectPickupBars([note([1, 4], 60), note([1, 2], 62)])).toBe(0);
	});
});
