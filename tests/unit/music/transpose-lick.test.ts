import { describe, it, expect } from 'vitest';
import { transposeLick, transposeLickForTonality, snapLickToScale } from '$lib/phrases/library-loader';
import type { Phrase } from '$lib/types/music';

/** Helper: build a minimal phrase with given MIDI pitches */
function makePhrase(pitches: (number | null)[], category: string = 'pentatonic'): Phrase {
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
		category,
		tags: [],
		source: 'curated'
	} as Phrase;
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

	it('keeps high lick centered when transposing to F#', () => {
		// Notes at 72-84 (C5-C6). Naive +6 → 78-90, all above 75.
		// With -1 octave → 66-78, best fit (3 of 4 within 60-75).
		const phrase = makePhrase([72, 76, 79, 84]);
		const result = transposeLick(phrase, 'F#');
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

describe('transposeLickForTonality — single-chord modal licks use modal root', () => {
	it('G Dorian root-second: transposes to G and snaps to G Dorian', () => {
		// C4(60), D4(62) → transpose to G(+7) → G4(67), A4(69)
		// G Dorian PCs: {7,9,10,0,2,4,5} — both 67%12=7 and 69%12=9 are in scale
		const phrase = makePhrase([60, 62]);
		const result = transposeLickForTonality(phrase, 'G', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 69]);
		expect(result.key).toBe('G');
	});

	it('A Dorian: transposes to A and snaps', () => {
		// C4(60), E4(64) → transpose to A(+9) → A4(69), C#5(73)
		// A Dorian PCs: {9,11,0,2,4,6,7} — 73%12=1(C#) not in scale, snaps down to 72(C)
		const phrase = makePhrase([60, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 72]);
		expect(result.key).toBe('A');
	});

	it('D Dorian: transposes to D and snaps', () => {
		// C4(60), E4(64), G4(67) → transpose to D(+2) → D4(62), F#4(66), A4(69)
		// D Dorian PCs: {2,4,5,7,9,11,0} — 66%12=6(F#) not in scale, snaps down to 65(F)
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([62, 65, 69]);
		expect(result.key).toBe('D');
	});

	it('A Ionian: transposes to A (snap is no-op for Ionian)', () => {
		// Ionian = major scale, so snap should leave all diatonic notes intact
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.ionian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73, 76]);
		expect(result.key).toBe('A');
	});

	it('A Mixolydian: transposes to A and snaps', () => {
		// C4(60), E4(64), G4(67) → transpose to A(+9) → A4(69), C#5(73), E5(76)
		// A Mixolydian PCs: {9,11,1,2,4,5,7} — 73%12=1(Db) IS in A Mixolydian (natural 3rd = C#/Db)
		// Wait — A Mixolydian = A B C# D E F# G, PCs: {9,11,1,2,4,6,7}
		// 73%12=1(C#) is in scale, 76%12=4(E) is in scale → no snapping needed
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'major.mixolydian');
		expect(result.notes.map(n => n.pitch)).toEqual([69, 73, 76]);
		expect(result.key).toBe('A');
	});

	it('preserves rests', () => {
		const phrase = makePhrase([60, null, 64]);
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes[1].pitch).toBeNull();
	});

	it('non-major scale: falls back to snap (blues)', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'blues.minor');
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

describe('transposeLickForTonality — progression licks use parent key', () => {
	it('A Dorian ii-V-I: transposes to G major (parent key)', () => {
		// ii-V-I lick in A Dorian → parent key is G major
		// C4(60), E4(64) → transpose to G(+7) → G4(67), B4(71)
		const phrase = makePhrase([60, 64], 'ii-V-I-major');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});

	it('D Dorian ii-V-I: transposes to C major (parent key)', () => {
		// D Dorian = mode 2 of C major. Parent = C → no transposition.
		const phrase = makePhrase([60, 64, 67], 'ii-V-I-major');
		const result = transposeLickForTonality(phrase, 'D', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([60, 64, 67]);
		expect(result.key).toBe('D');
	});

	it('A Dorian ii-V-I minor: also uses parent key', () => {
		const phrase = makePhrase([60, 64], 'ii-V-I-minor');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});

	it('turnaround lick uses parent key', () => {
		const phrase = makePhrase([60, 64], 'turnarounds');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});

	it('rhythm-changes lick uses parent key', () => {
		const phrase = makePhrase([60, 64], 'rhythm-changes');
		const result = transposeLickForTonality(phrase, 'A', 'major.dorian');
		expect(result.notes.map(n => n.pitch)).toEqual([67, 71]);
		expect(result.key).toBe('A');
	});
});
