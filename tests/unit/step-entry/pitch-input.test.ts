import { describe, it, expect } from 'vitest';
import {
	keyToPitchClass,
	isValidPitchKey,
	applyAccidental,
	buildMidiFromInput,
	isInInstrumentRange
} from '$lib/step-entry/pitch-input';
import type { InstrumentConfig } from '$lib/types/instruments';

const tenorSax: InstrumentConfig = {
	name: 'Tenor Saxophone',
	key: 'Bb',
	transpositionSemitones: 14,
	concertRangeLow: 44,
	concertRangeHigh: 76,
	clef: 'treble',
	gmProgram: 66,
	highNotePresets: [78, 77, 76, 75, 74, 72]
};

describe('keyToPitchClass', () => {
	it('maps C to 0', () => {
		expect(keyToPitchClass('C')).toBe(0);
		expect(keyToPitchClass('c')).toBe(0);
	});

	it('maps D to 2', () => {
		expect(keyToPitchClass('D')).toBe(2);
	});

	it('maps all note names', () => {
		expect(keyToPitchClass('E')).toBe(4);
		expect(keyToPitchClass('F')).toBe(5);
		expect(keyToPitchClass('G')).toBe(7);
		expect(keyToPitchClass('A')).toBe(9);
		expect(keyToPitchClass('B')).toBe(11);
	});

	it('returns null for invalid keys', () => {
		expect(keyToPitchClass('X')).toBeNull();
		expect(keyToPitchClass('1')).toBeNull();
	});
});

describe('isValidPitchKey', () => {
	it('returns true for A-G', () => {
		for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
			expect(isValidPitchKey(k)).toBe(true);
		}
	});

	it('is case-insensitive', () => {
		expect(isValidPitchKey('a')).toBe(true);
		expect(isValidPitchKey('g')).toBe(true);
	});

	it('returns false for non-note keys', () => {
		expect(isValidPitchKey('H')).toBe(false);
		expect(isValidPitchKey('0')).toBe(false);
	});
});

describe('applyAccidental', () => {
	it('sharp raises by 1 semitone', () => {
		expect(applyAccidental(0, 'sharp')).toBe(1); // C -> C#
	});

	it('flat lowers by 1 semitone', () => {
		expect(applyAccidental(2, 'flat')).toBe(1); // D -> Db
	});

	it('natural returns same pitch class', () => {
		expect(applyAccidental(5, 'natural')).toBe(5);
	});

	it('wraps around at 0 (C flat = B)', () => {
		expect(applyAccidental(0, 'flat')).toBe(11);
	});

	it('wraps around at 11 (B sharp = C)', () => {
		expect(applyAccidental(11, 'sharp')).toBe(0);
	});
});

describe('buildMidiFromInput', () => {
	it('concert mode returns pitchClassToMidi directly', () => {
		// C4 = MIDI 60
		expect(buildMidiFromInput(0, 4, 'concert', tenorSax)).toBe(60);
	});

	it('written mode transposes to concert', () => {
		// Written C4 on tenor sax (transposition +14) -> concert Bb2
		// writtenToConcert(60, tenorSax) = 60 - 14 = 46
		expect(buildMidiFromInput(0, 4, 'written', tenorSax)).toBe(46);
	});

	it('concert A4 = MIDI 69', () => {
		expect(buildMidiFromInput(9, 4, 'concert', tenorSax)).toBe(69);
	});
});

describe('isInInstrumentRange', () => {
	it('returns true for notes in range', () => {
		expect(isInInstrumentRange(60, tenorSax)).toBe(true);
		expect(isInInstrumentRange(44, tenorSax)).toBe(true);
		expect(isInInstrumentRange(76, tenorSax)).toBe(true);
	});

	it('returns false for notes out of range', () => {
		expect(isInInstrumentRange(43, tenorSax)).toBe(false);
		expect(isInInstrumentRange(77, tenorSax)).toBe(false);
	});
});
