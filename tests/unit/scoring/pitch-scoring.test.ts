import { describe, it, expect } from 'vitest';
import { scorePitch } from '$lib/scoring/pitch-scoring.ts';
import type { Note } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

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
