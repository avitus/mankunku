import { describe, it, expect } from 'vitest';
import { transposeLick } from '$lib/phrases/library-loader.ts';
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
		// Notes around C4-C5 (60-72), transposing +2 keeps them in 62-74 — well within 60-84
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'D');
		expect(result.key).toBe('D');
		expect(result.notes.map((n) => n.pitch)).toEqual([62, 66, 69, 74]);
	});

	it('shifts down an octave when transposing to B would push notes too high', () => {
		// Notes at 67-79 (G4-G5). Naive +11 → 78-90, most above 84.
		// With -1 octave shift → 66-78, all within 60-84.
		const phrase = makePhrase([67, 70, 74, 79]);
		const result = transposeLick(phrase, 'B');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// All notes should be within or close to the central range
		for (const p of pitches) {
			expect(p).toBeGreaterThanOrEqual(60);
			expect(p).toBeLessThanOrEqual(84);
		}
		// Specifically: should be shifted -12 from naive, so 67+11-12=66, etc.
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
		// Notes at 72-84 (C5-C6). Naive +6 → 78-90, top notes above 84.
		// With -1 octave → 66-78, all in range and better centered.
		const phrase = makePhrase([72, 76, 79, 84]);
		const result = transposeLick(phrase, 'Gb');
		const pitches = result.notes.map((n) => n.pitch) as number[];

		// Should shift down an octave: 72+6-12=66, 76+6-12=70, 79+6-12=73, 84+6-12=78
		expect(pitches).toEqual([66, 70, 73, 78]);
	});

	it('centers low licks closer to the midpoint of the range', () => {
		// Notes at 60-67 (C4-G4). Transposing to D (+2) → 62-69, avg 65.25.
		// With +1 octave → 74-81, avg 77.25, closer to midpoint 72.
		// Both are fully in range, but +1 octave is better centered.
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'D');
		const pitches = result.notes.map((n) => n.pitch) as number[];
		expect(pitches).toEqual([74, 76, 78, 81]);
	});
});
