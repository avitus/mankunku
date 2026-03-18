import { describe, it, expect } from 'vitest';
import {
	keySignatureAccidentals,
	realizeScale,
	realizeScaleMidi,
	scalePitchClasses,
	relativeMinor,
	relativeMajor
} from '$lib/music/keys.ts';

describe('keySignatureAccidentals', () => {
	it('C major has 0 accidentals', () => {
		expect(keySignatureAccidentals('C')).toBe(0);
	});

	it('G major has 1 sharp', () => {
		expect(keySignatureAccidentals('G')).toBe(1);
	});

	it('F major has 1 flat', () => {
		expect(keySignatureAccidentals('F')).toBe(-1);
	});

	it('Bb major has 2 flats', () => {
		expect(keySignatureAccidentals('Bb')).toBe(-2);
	});
});

describe('realizeScale', () => {
	it('C major scale = [0, 2, 4, 5, 7, 9, 11]', () => {
		const major = [2, 2, 1, 2, 2, 2, 1];
		expect(realizeScale('C', major)).toEqual([0, 2, 4, 5, 7, 9, 11]);
	});

	it('D dorian = [2, 4, 5, 7, 9, 11, 0]', () => {
		const dorian = [2, 1, 2, 2, 2, 1, 2];
		expect(realizeScale('D', dorian)).toEqual([2, 4, 5, 7, 9, 11, 0]);
	});
});

describe('realizeScaleMidi', () => {
	it('C major from MIDI 60-72', () => {
		const major = [2, 2, 1, 2, 2, 2, 1];
		const notes = realizeScaleMidi('C', major, 60, 72);
		expect(notes).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
	});
});

describe('scalePitchClasses', () => {
	it('returns pitch class names for Bb major', () => {
		const major = [2, 2, 1, 2, 2, 2, 1];
		expect(scalePitchClasses('Bb', major)).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
	});
});

describe('relative keys', () => {
	it('relative minor of C major = A', () => {
		expect(relativeMinor('C')).toBe('A');
	});

	it('relative major of A minor = C', () => {
		expect(relativeMajor('A')).toBe('C');
	});

	it('roundtrips', () => {
		expect(relativeMajor(relativeMinor('Eb'))).toBe('Eb');
	});
});
