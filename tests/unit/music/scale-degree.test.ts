import { describe, it, expect } from 'vitest';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';
import { transposePitchClass } from '$lib/music/transposition';
import { scaleDegreeOf } from '$lib/music/scale-degree';

describe('scaleDegreeOf', () => {
	it('maps all 12 intervals in C to canonical labels', () => {
		const expected: Array<[PitchClass, number, 1 | 2 | 3 | 4 | 5 | 6 | 7, 'b' | '#' | null, string]> = [
			['C', 0, 1, null, '1'],
			['Db', 1, 2, 'b', 'b2'],
			['D', 2, 2, null, '2'],
			['Eb', 3, 3, 'b', 'b3'],
			['E', 4, 3, null, '3'],
			['F', 5, 4, null, '4'],
			['F#', 6, 4, '#', '#4'],
			['G', 7, 5, null, '5'],
			['Ab', 8, 6, 'b', 'b6'],
			['A', 9, 6, null, '6'],
			['Bb', 10, 7, 'b', 'b7'],
			['B', 11, 7, null, '7']
		];
		for (const [root, semitones, degree, accidental, label] of expected) {
			expect(scaleDegreeOf(root, 'C')).toEqual({ semitones, degree, accidental, label });
		}
	});

	it('is key-relative: Bb in F is degree 4; D in Eb is degree 7', () => {
		expect(scaleDegreeOf('Bb', 'F')).toEqual({ semitones: 5, degree: 4, accidental: null, label: '4' });
		expect(scaleDegreeOf('D', 'Eb')).toEqual({ semitones: 11, degree: 7, accidental: null, label: '7' });
	});

	it('wraps across the octave boundary (key B, root C is the b2)', () => {
		expect(scaleDegreeOf('C', 'B')).toEqual({ semitones: 1, degree: 2, accidental: 'b', label: 'b2' });
	});

	it('round-trips through transposePitchClass for every key and interval', () => {
		for (const key of PITCH_CLASSES) {
			for (let n = 0; n < 12; n++) {
				const root = transposePitchClass(key, n);
				expect(scaleDegreeOf(root, key).semitones).toBe(n);
			}
		}
	});
});
