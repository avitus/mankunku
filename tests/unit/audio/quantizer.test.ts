import { describe, it, expect } from 'vitest';
import { quantizeNotes, detectKey } from '$lib/audio/quantizer';
import type { DetectedNote } from '$lib/types/audio';

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

describe('swing-aware quantization', () => {
	// Tempo 120: beat = 0.5s, whole note = 2s.
	const BEAT = 0.5;

	it.each([0.55, 0.62, 0.66, 0.72])(
		'writes a bar of swung eighths (ratio %f) as straight eighths',
		(s) => {
			// Long-short pairs on every beat; each upbeat lands at frac `s`,
			// including the exact triplet point 0.66 the old grid vote notated
			// literally as triplet quarter + eighth.
			const detected = Array.from({ length: 8 }, (_, i) => {
				const beat = Math.floor(i / 2);
				const onset = (beat + (i % 2 === 0 ? 0 : s)) * BEAT;
				const end = i === 7 ? 4 * BEAT : (Math.floor((i + 1) / 2) + ((i + 1) % 2) * s) * BEAT;
				return note(60 + i, onset, end - onset);
			});

			const result = quantizeNotes(detected, 120, [4, 4]);
			const pitched = result.filter((n) => n.pitch !== null);

			expect(pitched.length).toBe(8);
			for (const n of pitched) expect(n.duration).toEqual([1, 8]);
			expect(pitched.map((n) => n.offset)).toEqual([
				[0, 1], [1, 8], [1, 4], [3, 8], [1, 2], [5, 8], [3, 4], [7, 8]
			]);
		}
	);

	it('keeps a genuine triplet beat as triplets', () => {
		// Three even notes across beat 0, then a closing quarter on beat 1.
		const detected = [
			note(60, 0, BEAT / 3),
			note(62, BEAT / 3, BEAT / 3),
			note(64, (2 * BEAT) / 3, BEAT / 3),
			note(65, BEAT, BEAT)
		];

		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter((n) => n.pitch !== null);

		expect(pitched.map((n) => n.duration)).toEqual([[1, 12], [1, 12], [1, 12], [1, 4]]);
		expect(pitched.map((n) => n.offset)).toEqual([[0, 1], [1, 12], [1, 6], [1, 4]]);
	});

	it('mixes swung eighths and a real triplet in one bar', () => {
		// Beat 0: swung pair with the upbeat at the triplet point. Beat 1: full
		// triplet. Beat 2: quarter. The pair must NOT be dragged onto the
		// triplet grid by its neighbour — the next beat has its own downbeat,
		// so the quarter-note-triplet continuation rule stays out of it.
		const detected = [
			note(60, 0, 0.33),
			note(62, 0.33, 0.17),
			note(64, 0.5, BEAT / 3),
			note(65, 0.5 + BEAT / 3, BEAT / 3),
			note(67, 0.5 + (2 * BEAT) / 3, BEAT / 3),
			note(69, 1.0, BEAT)
		];

		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter((n) => n.pitch !== null);

		expect(pitched.map((n) => n.duration)).toEqual([
			[1, 8], [1, 8], [1, 12], [1, 12], [1, 12], [1, 4]
		]);
	});

	it('notates an off-beat-only entry as an offset eighth', () => {
		// No downbeat onset at all: entry on the "and" of beat 0, played lazily
		// at the swing point, then a note on beat 1.
		const detected = [note(60, 0.33, 0.17), note(62, 0.5, 0.5)];

		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter((n) => n.pitch !== null);

		expect(pitched[0].offset).toEqual([1, 8]);
		expect(pitched[0].duration).toEqual([1, 8]);
		expect(pitched[1].offset).toEqual([1, 4]);
	});

	it('recognises a tied-first triplet from its 1/3 onset', () => {
		// Only the middle and last notes of the triplet sound — the 1/3
		// position alone is triplet evidence, since no swing puts a note there.
		const detected = [note(60, BEAT / 3, BEAT / 3), note(62, (2 * BEAT) / 3, BEAT / 3)];

		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter((n) => n.pitch !== null);

		expect(pitched.map((n) => n.offset)).toEqual([[1, 12], [1, 6]]);
		expect(pitched.map((n) => n.duration)).toEqual([[1, 12], [1, 12]]);
	});

	it('carries quarter-note triplets across beats', () => {
		// Six quarter-note triplets filling the bar: onsets at 0, 2/3, 4/3,
		// 2, 8/3, 10/3 beats. Even-index beats see only a 2/3 upbeat — the
		// right-to-left continuation rule links them to their trip1 neighbours.
		const detected = Array.from({ length: 6 }, (_, i) =>
			note(60 + i, (i * 2 * BEAT) / 3, (2 * BEAT) / 3)
		);

		const result = quantizeNotes(detected, 120, [4, 4]);
		const pitched = result.filter((n) => n.pitch !== null);

		expect(pitched.length).toBe(6);
		for (const n of pitched) expect(n.duration).toEqual([1, 6]);
	});
});

describe('detectKey', () => {
	it('returns most frequent pitch class', () => {
		// D major scale: D E F# G A B C#
		// MIDI: D=62, E=64, F#=66, G=67, A=69, B=71, C#=73
		const detected = [
			note(62, 0, 0.3),   // D
			note(64, 0.3, 0.3), // E
			note(66, 0.6, 0.3), // F#
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
