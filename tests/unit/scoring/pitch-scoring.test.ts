import { describe, it, expect } from 'vitest';
import { scorePitch } from '$lib/scoring/pitch-scoring';
import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

function makeNote(pitch: number | null): Note {
	return { pitch, offset: [0, 1], duration: [1, 4] };
}

function makeDetected(midi: number, cents: number = 0): DetectedNote {
	return { midi, cents, onsetTime: 0, duration: 0.3, clarity: 0.9 };
}

describe('scorePitch', () => {
	it('returns 1.1 for correct pitch with perfect intonation (0 cents)', () => {
		expect(scorePitch(makeNote(60), makeDetected(60, 0))).toBeCloseTo(1.1, 2);
	});

	it('returns 1.05 for correct pitch with 25 cents deviation', () => {
		expect(scorePitch(makeNote(60), makeDetected(60, 25))).toBeCloseTo(1.05, 2);
	});

	it('returns 1.0 for correct pitch with 50 cents deviation (no bonus)', () => {
		expect(scorePitch(makeNote(60), makeDetected(60, 50))).toBeCloseTo(1.0, 2);
	});

	it('returns 1.0 for correct pitch with > 50 cents deviation (clamped)', () => {
		expect(scorePitch(makeNote(60), makeDetected(60, 80))).toBeCloseTo(1.0, 2);
	});

	it('returns 0 for wrong pitch', () => {
		expect(scorePitch(makeNote(60), makeDetected(61))).toBe(0);
	});

	it('returns 0 for pitch off by an octave', () => {
		expect(scorePitch(makeNote(60), makeDetected(72))).toBe(0);
	});

	it('returns 1.0 for rest (expected pitch is null)', () => {
		expect(scorePitch(makeNote(null), makeDetected(60))).toBe(1.0);
	});

	it('handles negative cents deviation', () => {
		// -25 cents → abs = 25 → same as +25
		expect(scorePitch(makeNote(60), makeDetected(60, -25))).toBeCloseTo(1.05, 2);
	});
});

describe('scorePitch with octaveInsensitive=true', () => {
	it('returns full credit with intonation bonus for same pitch class one octave up', () => {
		// Expected C4 (60), detected C5 (72), 0 cents → 1.0 + 0.1 bonus = 1.1
		expect(scorePitch(makeNote(60), makeDetected(72, 0), true)).toBeCloseTo(1.1, 2);
	});

	it('returns full credit for same pitch class two octaves down', () => {
		// Expected C4 (60), detected C2 (36), 0 cents → 1.0 + 0.1 bonus = 1.1
		expect(scorePitch(makeNote(60), makeDetected(36, 0), true)).toBeCloseTo(1.1, 2);
	});

	it('returns intonation bonus using detected.cents regardless of octave offset', () => {
		// Expected C4, detected C5 with 25 cents off → 1.05 (bonus uses detected.cents)
		expect(scorePitch(makeNote(60), makeDetected(72, 25), true)).toBeCloseTo(1.05, 2);
	});

	it('still returns 0 when detected pitch class differs from expected', () => {
		// Expected C4 (60), detected C#5 (73) — different pitch class (0 vs 1)
		expect(scorePitch(makeNote(60), makeDetected(73), true)).toBe(0);
	});

	it('still returns 0 for a true wrong note', () => {
		expect(scorePitch(makeNote(60), makeDetected(62), true)).toBe(0);
	});

	it('rest passthrough is unaffected by the flag', () => {
		expect(scorePitch(makeNote(null), makeDetected(60), true)).toBe(1.0);
	});
});
