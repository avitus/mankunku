import { describe, it, expect } from 'vitest';
import { quantizeNotes, detectKey } from '$lib/audio/quantizer.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

/** Helper: create a DetectedNote */
function note(midi: number, onsetTime: number, duration: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity: 0.95 };
}

describe('quantizeNotes', () => {
	it('quantizes 4 evenly-spaced notes at 100 BPM to quarter notes', () => {
		// At 100 BPM, quarter note = 0.6s, whole note = 2.4s
		const detected = [
			note(60, 0.0, 0.6),
			note(62, 0.6, 0.6),
			note(64, 1.2, 0.6),
			note(65, 1.8, 0.6)
		];

		const result = quantizeNotes(detected, 100, [4, 4]);

		// Should produce 4 notes
		const pitched = result.filter(n => n.pitch !== null);
		expect(pitched.length).toBe(4);

		// Each should be a quarter note [1,4] = 12/48
		for (const n of pitched) {
			expect(n.duration).toEqual([1, 4]);
		}

		// Offsets: 0, 1/4, 2/4, 3/4
		expect(pitched[0].offset).toEqual([0, 1]);
		expect(pitched[1].offset).toEqual([1, 4]);
		expect(pitched[2].offset).toEqual([1, 2]);
		expect(pitched[3].offset).toEqual([3, 4]);
	});

	it('quantizes 8 notes at 0.3s intervals to eighth notes at 100 BPM', () => {
		// At 100 BPM, eighth note = 0.3s
		const detected = Array.from({ length: 8 }, (_, i) =>
			note(60 + i, i * 0.3, 0.3)
		);

		const result = quantizeNotes(detected, 100, [4, 4]);
		const pitched = result.filter(n => n.pitch !== null);

		expect(pitched.length).toBe(8);

		// Each should be an eighth note [1,8]
		for (const n of pitched) {
			expect(n.duration).toEqual([1, 8]);
		}
	});

	it('quantizes 3 notes spanning 2 beats to triplet quarters (1/6)', () => {
		// At 100 BPM, whole note = 2.4s, triplet quarter = 2/3 of a quarter = 0.4s
		// 3 notes in 2 beats (1.2s) → each is 0.4s = 1/6 whole note
		const detected = [
			note(60, 0.0, 0.4),
			note(62, 0.4, 0.4),
			note(64, 0.8, 0.4)
		];

		const result = quantizeNotes(detected, 100, [4, 4]);
		const pitched = result.filter(n => n.pitch !== null);

		expect(pitched.length).toBe(3);

		// Each should be a triplet quarter (1/6 whole note, or 8/48)
		for (const n of pitched) {
			expect(n.duration).toEqual([1, 6]);
		}
	});

	it('returns empty array for empty input', () => {
		const result = quantizeNotes([], 120, [4, 4]);
		expect(result).toEqual([]);
	});

	it('handles single note', () => {
		const detected = [note(60, 0.0, 0.5)];
		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter(n => n.pitch !== null);
		expect(pitched.length).toBe(1);
		expect(pitched[0].pitch).toBe(60);
	});

	it('caps at 8 bars', () => {
		// At 60 BPM, whole note = 4s, 8 bars = 32s
		// Place notes beyond 8 bars — they should be filtered
		const detected = [
			note(60, 0, 1),
			note(62, 33, 1) // way past 8 bars
		];
		const result = quantizeNotes(detected, 60, [4, 4]);
		const pitched = result.filter(n => n.pitch !== null);
		expect(pitched.length).toBe(1);
	});
});

describe('detectKey', () => {
	it('returns most frequent pitch class', () => {
		// D major scale: D E F# G A B C#
		// MIDI: D=62, E=64, F#=66, G=67, A=69, B=71, C#=73
		const detected = [
			note(62, 0, 0.3),   // D
			note(64, 0.3, 0.3), // E
			note(66, 0.6, 0.3), // F#→Gb
			note(67, 0.9, 0.3), // G
			note(69, 1.2, 0.3), // A
			note(62, 1.5, 0.3), // D again
			note(62, 1.8, 0.3), // D again
		];

		expect(detectKey(detected)).toBe('D');
	});

	it('returns C for empty input', () => {
		expect(detectKey([])).toBe('C');
	});

	it('detects C when all notes are C', () => {
		const detected = [
			note(60, 0, 0.5),
			note(72, 0.5, 0.5),
			note(48, 1.0, 0.5)
		];
		expect(detectKey(detected)).toBe('C');
	});
});
