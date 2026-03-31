import { describe, it, expect } from 'vitest';
import {
	midiToPitchClass,
	midiToOctave,
	pitchClassToMidi,
	midiToNoteName,
	noteNameToMidi,
	frequencyToMidi,
	midiToFrequency,
	quantizePitch,
	fractionToFloat,
	addFractions,
	compareFractions,
	subtractFractions
} from '$lib/music/intervals.ts';

describe('midiToPitchClass', () => {
	it('returns 0 for C', () => {
		expect(midiToPitchClass(60)).toBe(0); // C4
		expect(midiToPitchClass(48)).toBe(0); // C3
	});

	it('returns correct pitch class for other notes', () => {
		expect(midiToPitchClass(62)).toBe(2); // D4
		expect(midiToPitchClass(69)).toBe(9); // A4
	});
});

describe('midiToOctave', () => {
	it('returns correct octave', () => {
		expect(midiToOctave(60)).toBe(4);
		expect(midiToOctave(48)).toBe(3);
		expect(midiToOctave(72)).toBe(5);
	});
});

describe('pitchClassToMidi', () => {
	it('roundtrips with midiToPitchClass + midiToOctave', () => {
		for (const midi of [44, 58, 60, 69, 76]) {
			expect(pitchClassToMidi(midiToPitchClass(midi), midiToOctave(midi))).toBe(midi);
		}
	});
});

describe('midiToNoteName', () => {
	it('converts standard notes', () => {
		expect(midiToNoteName(60)).toBe('C4');
		expect(midiToNoteName(69)).toBe('A4');
		expect(midiToNoteName(58)).toBe('Bb3');
		expect(midiToNoteName(44)).toBe('Ab2');
	});
});

describe('noteNameToMidi', () => {
	it('parses note names', () => {
		expect(noteNameToMidi('C4')).toBe(60);
		expect(noteNameToMidi('A4')).toBe(69);
		expect(noteNameToMidi('Bb3')).toBe(58);
	});

	it('handles sharps', () => {
		expect(noteNameToMidi('C#4')).toBe(61);
		expect(noteNameToMidi('F#3')).toBe(54);
	});

	it('throws on invalid input', () => {
		expect(() => noteNameToMidi('X4')).toThrow();
	});
});

describe('frequency <-> MIDI', () => {
	it('A4 = 440 Hz = MIDI 69', () => {
		expect(midiToFrequency(69)).toBeCloseTo(440, 5);
		expect(frequencyToMidi(440)).toBeCloseTo(69, 5);
	});

	it('C4 = ~261.63 Hz = MIDI 60', () => {
		expect(midiToFrequency(60)).toBeCloseTo(261.626, 1);
		expect(frequencyToMidi(261.626)).toBeCloseTo(60, 1);
	});
});

describe('quantizePitch', () => {
	it('returns exact midi with 0 cents for integer', () => {
		const r = quantizePitch(69.0);
		expect(r.midi).toBe(69);
		expect(r.cents).toBe(0);
	});

	it('returns cents deviation', () => {
		const r = quantizePitch(69.3);
		expect(r.midi).toBe(69);
		expect(r.cents).toBe(30);
	});
});

describe('fraction utilities', () => {
	it('fractionToFloat converts correctly', () => {
		expect(fractionToFloat([1, 4])).toBe(0.25);
		expect(fractionToFloat([3, 8])).toBe(0.375);
	});

	it('addFractions adds and simplifies', () => {
		expect(addFractions([1, 4], [1, 4])).toEqual([1, 2]);
		expect(addFractions([1, 8], [1, 8])).toEqual([1, 4]);
	});

	it('compareFractions returns 0 for equal fractions', () => {
		expect(compareFractions([1, 2], [2, 4])).toBe(0);
		expect(compareFractions([1, 4], [1, 4])).toBe(0);
	});

	it('compareFractions returns positive when a > b', () => {
		expect(compareFractions([3, 4], [1, 2])).toBe(1);
		expect(compareFractions([1, 1], [1, 2])).toBe(1);
	});

	it('compareFractions returns negative when a < b', () => {
		expect(compareFractions([1, 4], [1, 2])).toBe(-1);
	});

	it('subtractFractions subtracts and simplifies', () => {
		expect(subtractFractions([1, 2], [1, 4])).toEqual([1, 4]);
		expect(subtractFractions([1, 1], [1, 4])).toEqual([3, 4]);
	});

	it('subtractFractions returns zero for equal fractions', () => {
		expect(subtractFractions([1, 4], [1, 4])).toEqual([0, 1]);
	});

	it('subtractFractions handles triplet fractions', () => {
		expect(subtractFractions([1, 1], [1, 3])).toEqual([2, 3]);
		expect(subtractFractions([2, 3], [1, 6])).toEqual([1, 2]);
	});
});
