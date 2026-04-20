import { describe, it, expect } from 'vitest';
import { INSTRUMENTS } from '$lib/types/instruments';
import {
	concertToWritten,
	writtenToConcert,
	concertKeyToWritten,
	writtenKeyToConcert,
	transposePitchClass,
	pitchClassInterval,
	isInRange
} from '$lib/music/transposition';

const tenorSax = INSTRUMENTS['tenor-sax'];
const altoSax = INSTRUMENTS['alto-sax'];
const trumpet = INSTRUMENTS['trumpet'];

describe('concertToWritten / writtenToConcert', () => {
	it('tenor sax: concert Bb3 (58) -> written C5 (72)', () => {
		expect(concertToWritten(58, tenorSax)).toBe(72);
	});

	it('roundtrips', () => {
		for (const midi of [44, 58, 60, 69, 76]) {
			expect(writtenToConcert(concertToWritten(midi, tenorSax), tenorSax)).toBe(midi);
			expect(writtenToConcert(concertToWritten(midi, altoSax), altoSax)).toBe(midi);
			expect(writtenToConcert(concertToWritten(midi, trumpet), trumpet)).toBe(midi);
		}
	});
});

describe('concertKeyToWritten / writtenKeyToConcert', () => {
	it('tenor sax (Bb): concert C -> written D', () => {
		expect(concertKeyToWritten('C', tenorSax)).toBe('D');
	});

	it('tenor sax (Bb): concert Bb -> written C', () => {
		// Bb + 14 semitones = 10 + 14 = 24, 24 % 12 = 0 = C
		expect(concertKeyToWritten('Bb', tenorSax)).toBe('C');
	});

	it('alto sax (Eb): concert C -> written A', () => {
		// 0 + 9 = 9 = A
		expect(concertKeyToWritten('C', altoSax)).toBe('A');
	});

	it('roundtrips key transposition', () => {
		expect(writtenKeyToConcert(concertKeyToWritten('F', tenorSax), tenorSax)).toBe('F');
		expect(writtenKeyToConcert(concertKeyToWritten('Eb', altoSax), altoSax)).toBe('Eb');
	});
});

describe('transposePitchClass', () => {
	it('C up 2 semitones = D', () => {
		expect(transposePitchClass('C', 2)).toBe('D');
	});

	it('wraps around: B up 1 = C', () => {
		expect(transposePitchClass('B', 1)).toBe('C');
	});

	it('handles negative: C down 1 = B', () => {
		expect(transposePitchClass('C', -1)).toBe('B');
	});
});

describe('pitchClassInterval', () => {
	it('C to G = 7 semitones', () => {
		expect(pitchClassInterval('C', 'G')).toBe(7);
	});

	it('G to C = 5 semitones (ascending)', () => {
		expect(pitchClassInterval('G', 'C')).toBe(5);
	});
});

describe('isInRange', () => {
	it('tenor sax range check', () => {
		expect(isInRange(44, tenorSax)).toBe(true);  // low end
		expect(isInRange(76, tenorSax)).toBe(true);  // high end
		expect(isInRange(43, tenorSax)).toBe(false); // below range
		expect(isInRange(77, tenorSax)).toBe(false); // above range
		expect(isInRange(60, tenorSax)).toBe(true);  // middle
	});
});
