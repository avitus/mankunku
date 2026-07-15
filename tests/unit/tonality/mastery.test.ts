import { describe, it, expect } from 'vitest';
import { computeTonalMastery } from '$lib/tonality/mastery';
import { SCALE_UNLOCK_ORDER, type ScaleType } from '$lib/tonality/tonality';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';

/** Minimal structural proficiency stub — the function only reads `.level`. */
const p = (level: number) => ({ level });

function allScales(level: number): Partial<Record<ScaleType, { level: number }>> {
	return Object.fromEntries(SCALE_UNLOCK_ORDER.map((st) => [st, p(level)]));
}
function allKeys(level: number): Partial<Record<PitchClass, { level: number }>> {
	return Object.fromEntries(PITCH_CLASSES.map((pc) => [pc, p(level)]));
}

describe('computeTonalMastery', () => {
	it('returns 0 for a brand-new user (no entries)', () => {
		const m = computeTonalMastery({}, {});
		expect(m.overall).toBe(0);
		expect(m.scaleMastery).toBe(0);
		expect(m.keyMastery).toBe(0);
		expect(m.scalesStarted).toBe(0);
		expect(m.keysStarted).toBe(0);
	});

	it('one maxed scale + one maxed key ≈ 8.33%', () => {
		const m = computeTonalMastery({ 'major-pentatonic': p(100) }, { C: p(100) });
		// 100/12 for each half, averaged → still 100/12
		expect(m.scaleMastery).toBeCloseTo(8.333, 2);
		expect(m.keyMastery).toBeCloseTo(8.333, 2);
		expect(m.overall).toBeCloseTo(8.333, 2);
		expect(m.scalesStarted).toBe(1);
		expect(m.keysStarted).toBe(1);
	});

	it('every scale and key maxed → 100%', () => {
		const m = computeTonalMastery(allScales(100), allKeys(100));
		expect(m.overall).toBe(100);
		expect(m.scaleMastery).toBe(100);
		expect(m.keyMastery).toBe(100);
		expect(m.scalesStarted).toBe(12);
		expect(m.keysStarted).toBe(12);
	});

	it('every scale and key at 50 → 50%', () => {
		const m = computeTonalMastery(allScales(50), allKeys(50));
		expect(m.overall).toBe(50);
	});

	it('counts a missing slot as 0, not the init default of 1', () => {
		// One scale at level 1, everything else absent.
		const m = computeTonalMastery({ 'major-pentatonic': p(1) }, {});
		expect(m.scaleMastery).toBeCloseTo(1 / 12, 4); // ≈0.0833, NOT 1.0
		expect(m.keyMastery).toBe(0);
		expect(m.overall).toBeCloseTo(1 / 24, 4); // ≈0.0417
		expect(m.scalesStarted).toBe(1);
		expect(m.keysStarted).toBe(0);
	});

	it('weights the scale and key halves equally', () => {
		// All 12 scales maxed, no keys → overall is the mean of the two halves.
		const m = computeTonalMastery(allScales(100), {});
		expect(m.scaleMastery).toBe(100);
		expect(m.keyMastery).toBe(0);
		expect(m.overall).toBe(50);
	});

	it('counts a slot as started even at level 1', () => {
		const m = computeTonalMastery({ major: p(1) }, { G: p(1) });
		expect(m.scalesStarted).toBe(1);
		expect(m.keysStarted).toBe(1);
	});
});
