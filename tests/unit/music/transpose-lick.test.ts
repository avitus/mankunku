import { describe, it, expect } from 'vitest';
import { transposeLick, transposeLickForTonality, snapLickToScale } from '$lib/phrases/library-loader.ts';
import type { Phrase } from '$lib/types/music.ts';

/** Helper: build a minimal phrase with given MIDI pitches */
function makePhrase(pitches: (number | null)[]): Phrase {
	return {
		id: 'test-001',
		name: 'Test Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: pitches.map((p, i) => ({
			pitch: p,
			duration: [1, 4] as [number, number],
			offset: [i, 4] as [number, number]
		})),
		harmony: [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category: 'blues',
		tags: [],
		source: 'curated'
	};
}

describe('transposeLick — central range optimization', () => {
	it('transposes to D without octave shift when already in range', () => {
		// Notes around C4-C5 (60-72), transposing +2 keeps them in 62-74 — within 60-75
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'D');
		expect(result.key).toBe('D');
		expect(result.notes.map((n) => n.pitch)).toEqual([62, 66, 69, 74]);
	});

	it('shifts down an octave when transposing to B would push notes too high', () => {
		// Notes at 67-79 (G4-G5). Naive +11 → 78-90, all above 75.
		// With -1 octave shift → 66-78, most within 60-75 (best available).
		const phrase = makePhrase([67, 70, 74, 79]);
		const result = transposeLick(phrase, 'B');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// Shifted -12 from naive: 67+11-12=66, etc. (3 of 4 within tenor range)
		expect(pitches).toEqual([66, 69, 73, 78]);
	});

	it('preserves rests (null pitches)', () => {
		const phrase = makePhrase([60, null, 67, null]);
		const result = transposeLick(phrase, 'G');
		expect(result.notes[1].pitch).toBeNull();
		expect(result.notes[3].pitch).toBeNull();
	});

	it('transposes harmony roots correctly', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLick(phrase, 'F');
		expect(result.harmony[0].chord.root).toBe('F');
	});

	it('returns original phrase for key of C', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLick(phrase, 'C');
		expect(result).toBe(phrase);
	});

	it('keeps high lick centered when transposing to Gb', () => {
		// Notes at 72-84 (C5-C6). Naive +6 → 78-90, all above 75.
		// With -1 octave → 66-78, best fit (3 of 4 within 60-75).
		const phrase = makePhrase([72, 76, 79, 84]);
		const result = transposeLick(phrase, 'Gb');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// Should shift down an octave: 72+6-12=66, 76+6-12=70, 79+6-12=73, 84+6-12=78
		expect(pitches).toEqual([66, 70, 73, 78]);
	});

	it('keeps low licks in range rather than pushing above tenor ceiling', () => {
		// Notes at 60-67 (C4-G4). Transposing to D (+2) → 62-69, all within 60-75.
		// With +1 octave → 74-81, only 74 within range. So shift 0 wins.
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'D');
		const pitches = result.notes.map((n) => n.pitch) as number[];
		expect(pitches).toEqual([62, 64, 66, 69]);
	});
});

describe('transposeLickForTonality — major-family modes use parent key', () => {
	it('A Dorian: transposes to G major (parent key), not A major', () => {
		// C4(60), E4(64) in C major → should become G4(67), B4(71) in G major = A Dorian
		// NOT A4(69), C#5(73) which would be A major
		const phrase = makePhrase([60, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		// Key should be A (the modal root), not G (the parent key)
		expect(result.key).toBe('A');
	});

	it('A Ionian: transposes to A (parent = A, mode 1)', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.ionian');
		// A Ionian = A major, parent key = A, so transpose +9
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73, 76]);
		expect(result.key).toBe('A');
	});

	it('A Mixolydian: transposes to D major (parent key)', () => {
		// A Mixolydian = mode 5 of D major. Parent = A - 7 = D.
		// C4(60) → D+2 = F#4(66), E4(64) → D+2 = A4(70)... wait, let me compute:
		// Transpose to D = +2 semitones: 60→62, 64→66, 67→69
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.mixolydian');
		expect(result.notes.map(n => n.pitch)).toEqual([62, 66, 69]);
		expect(result.key).toBe('A');
	});

	it('A Aeolian: transposes to C major (parent key)', () => {
		// A Aeolian = mode 6 of C major. Parent = A - 9 = C.
		// No transposition needed! Notes stay as C major.
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.aeolian');
		expect(result.notes.map(n => n.pitch)).toEqual([60, 64, 67]);
		expect(result.key).toBe('A');
	});

	it('D Dorian: transposes to C major (parent key)', () => {
		// D Dorian = mode 2 of C major. Parent = D - 2 = C.
		// No transposition needed.
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([60, 64, 67]);
		expect(result.key).toBe('D');
	});

	it('preserves rests', () => {
		const phrase = makePhrase([60, null, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes[1].pitch).toBeNull();
	});

	it('non-major scale: falls back to snap (blues)', () => {
		// Blues scale: snap should handle notes outside the scale
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'blues.minor');
		// Should transpose to A and snap
		expect(result.key).toBe('A');
		// All notes should be in A blues minor: A(9), C(0), D(2), Eb(3), E(4), G(7)
		const scalePCs = new Set([9, 0, 2, 3, 4, 7]);
		for (const n of result.notes) {
			if (n.pitch !== null) {
				expect(scalePCs.has(n.pitch % 12)).toBe(true);
			}
		}
	});
});
