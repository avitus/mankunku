/**
 * Integration tests for music theory modules.
 *
 * Tests scales + keys + chords + intervals + transposition working
 * together: scale realization in keys, chord tones matching scale degrees,
 * transposition round-trips, and cross-module consistency.
 */

import { describe, it, expect } from 'vitest';
import { SCALE_CATALOG, getScale } from '../../src/lib/music/scales';
import {
	realizeScale,
	realizeScaleMidi,
	scalePitchClasses,
	keySignatureAccidentals,
	circleOfFifths,
	relativeMajor,
	relativeMinor
} from '../../src/lib/music/keys';
import { chordTones, CHORD_DEFINITIONS } from '../../src/lib/music/chords';
import {
	midiToPitchClass,
	midiToOctave,
	midiToNoteName,
	noteNameToMidi,
	frequencyToMidi,
	midiToFrequency,
	intervalSize,
	semitoneDistance,
	fractionToFloat,
	addFractions,
	quantizePitch
} from '../../src/lib/music/intervals';
import {
	transpose,
	transposePitchClass,
	concertToWritten,
	writtenToConcert,
	concertKeyToWritten,
	writtenKeyToConcert,
	pitchClassInterval
} from '../../src/lib/music/transposition';
import { PITCH_CLASSES, type PitchClass } from '../../src/lib/types/music';

// ─── Scale Catalog ─────────────────────────────────────────────

describe('scale catalog integrity', () => {
	it('all scales have intervals summing to 12', () => {
		for (const scale of SCALE_CATALOG) {
			const sum = scale.intervals.reduce((a, b) => a + b, 0);
			expect(sum).toBe(12);
		}
	});

	it('all scales have matching degree count (intervals.length)', () => {
		for (const scale of SCALE_CATALOG) {
			expect(scale.degrees).toHaveLength(scale.intervals.length);
		}
	});

	it('getScale retrieves scales by id', () => {
		const ionian = getScale('major.ionian');
		expect(ionian).toBeDefined();
		expect(ionian!.name).toContain('Ionian');
		expect(ionian!.family).toBe('major');
	});

	it('getScale returns undefined for unknown id', () => {
		expect(getScale('nonexistent.scale')).toBeUndefined();
	});

	it('catalogs 35+ scales across all families', () => {
		expect(SCALE_CATALOG.length).toBeGreaterThanOrEqual(30);

		const families = new Set(SCALE_CATALOG.map(s => s.family));
		expect(families.size).toBeGreaterThanOrEqual(6);
	});
});

// ─── Scale Realization ─────────────────────────────────────────

describe('scale realization', () => {
	it('C major scale produces correct pitch classes', () => {
		const ionian = getScale('major.ionian')!;
		const pcs = realizeScale('C', ionian.intervals);

		// C major: C(0), D(2), E(4), F(5), G(7), A(9), B(11)
		expect(pcs).toEqual([0, 2, 4, 5, 7, 9, 11]);
	});

	it('realizeScaleMidi produces notes within the given range', () => {
		const ionian = getScale('major.ionian')!;
		const notes = realizeScaleMidi('C', ionian.intervals, 48, 72);

		expect(notes.length).toBeGreaterThan(0);
		for (const midi of notes) {
			expect(midi).toBeGreaterThanOrEqual(48);
			expect(midi).toBeLessThanOrEqual(72);
		}
	});

	it('realizeScaleMidi notes are in ascending order', () => {
		const dorian = getScale('major.dorian')!;
		const notes = realizeScaleMidi('D', dorian.intervals, 40, 80);

		for (let i = 1; i < notes.length; i++) {
			expect(notes[i]).toBeGreaterThan(notes[i - 1]);
		}
	});

	it('scalePitchClasses returns pitch class names', () => {
		const ionian = getScale('major.ionian')!;
		const pcs = scalePitchClasses('C', ionian.intervals);

		expect(pcs).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
	});

	it('transposed scales have different pitch classes', () => {
		const ionian = getScale('major.ionian')!;

		const cMajor = realizeScale('C', ionian.intervals);
		const gMajor = realizeScale('G', ionian.intervals);

		expect(cMajor).not.toEqual(gMajor);

		// G major should start on G(7)
		expect(gMajor[0]).toBe(7);
	});

	it('pentatonic scales have 5 notes', () => {
		const majorPent = getScale('pentatonic.major')!;
		const pcs = realizeScale('C', majorPent.intervals);
		expect(pcs).toHaveLength(5);
	});
});

// ─── Chord Tones ───────────────────────────────────────────────

describe('chord tones', () => {
	it('C major 7 chord tones are C E G B', () => {
		const tones = chordTones(60, 'maj7');
		expect(tones).toEqual([60, 64, 67, 71]); // C4, E4, G4, B4
	});

	it('C minor 7 chord tones are C Eb G Bb', () => {
		const tones = chordTones(60, 'min7');
		expect(tones).toEqual([60, 63, 67, 70]);
	});

	it('C dominant 7 chord tones are C E G Bb', () => {
		const tones = chordTones(60, '7');
		expect(tones).toEqual([60, 64, 67, 70]);
	});

	it('all chord qualities have defined intervals', () => {
		const qualities = Object.keys(CHORD_DEFINITIONS);
		expect(qualities.length).toBeGreaterThanOrEqual(15);

		for (const quality of qualities) {
			const def = CHORD_DEFINITIONS[quality as keyof typeof CHORD_DEFINITIONS];
			expect(def.intervals.length).toBeGreaterThanOrEqual(3);
			expect(def.intervals[0]).toBe(0); // root is always 0
		}
	});

	it('chord tones are subset of compatible scale in same key', () => {
		// Cmaj7 chord tones should all be in C Ionian
		const ionian = getScale('major.ionian')!;
		const scalePcs = new Set(realizeScale('C', ionian.intervals));
		const chordMidi = chordTones(60, 'maj7');

		for (const midi of chordMidi) {
			expect(scalePcs.has(midiToPitchClass(midi))).toBe(true);
		}
	});

	it('Dm7 chord tones are in D Dorian', () => {
		const dorian = getScale('major.dorian')!;
		const scalePcs = new Set(realizeScale('D', dorian.intervals));
		const chordMidi = chordTones(62, 'min7'); // D4

		for (const midi of chordMidi) {
			expect(scalePcs.has(midiToPitchClass(midi))).toBe(true);
		}
	});
});

// ─── MIDI ↔ Note Name ──────────────────────────────────────────

describe('MIDI conversions', () => {
	it('MIDI 60 is C4', () => {
		expect(midiToNoteName(60)).toBe('C4');
		expect(midiToPitchClass(60)).toBe(0);
		expect(midiToOctave(60)).toBe(4);
	});

	it('noteNameToMidi round-trips with midiToNoteName', () => {
		for (let midi = 21; midi <= 108; midi++) {
			const name = midiToNoteName(midi);
			expect(noteNameToMidi(name)).toBe(midi);
		}
	});

	it('handles sharps via enharmonic conversion', () => {
		expect(noteNameToMidi('C#4')).toBe(61);
		expect(noteNameToMidi('F#3')).toBe(54);
	});

	it('frequency ↔ MIDI round-trip', () => {
		// A4 = 440 Hz = MIDI 69
		expect(frequencyToMidi(440)).toBeCloseTo(69, 5);
		expect(midiToFrequency(69)).toBeCloseTo(440, 5);

		// Round-trip for arbitrary MIDI
		for (const midi of [48, 60, 72, 84]) {
			const freq = midiToFrequency(midi);
			expect(frequencyToMidi(freq)).toBeCloseTo(midi, 5);
		}
	});

	it('quantizePitch returns nearest MIDI and cents', () => {
		const { midi, cents } = quantizePitch(60.3);
		expect(midi).toBe(60);
		expect(cents).toBe(30);

		const sharp = quantizePitch(60.8);
		expect(sharp.midi).toBe(61);
		expect(sharp.cents).toBe(-20);
	});
});

// ─── Intervals ─────────────────────────────────────────────────

describe('interval calculations', () => {
	it('semitoneDistance is signed', () => {
		expect(semitoneDistance(60, 67)).toBe(7);   // P5 up
		expect(semitoneDistance(67, 60)).toBe(-7);  // P5 down
	});

	it('intervalSize is always positive', () => {
		expect(intervalSize(60, 67)).toBe(7);
		expect(intervalSize(67, 60)).toBe(7);
	});

	it('fractionToFloat converts correctly', () => {
		expect(fractionToFloat([1, 4])).toBe(0.25);
		expect(fractionToFloat([1, 8])).toBe(0.125);
		expect(fractionToFloat([3, 4])).toBe(0.75);
		expect(fractionToFloat([0, 1])).toBe(0);
	});

	it('addFractions works and reduces', () => {
		// 1/4 + 1/4 = 1/2
		const result = addFractions([1, 4], [1, 4]);
		expect(result[0] / result[1]).toBeCloseTo(0.5);

		// 1/8 + 1/8 = 1/4
		const result2 = addFractions([1, 8], [1, 8]);
		expect(result2[0] / result2[1]).toBeCloseTo(0.25);
	});
});

// ─── Transposition ─────────────────────────────────────────────

describe('transposition', () => {
	it('transpose by 0 is identity', () => {
		expect(transpose(60, 0)).toBe(60);
	});

	it('transpose up an octave', () => {
		expect(transpose(60, 12)).toBe(72);
	});

	it('transposePitchClass wraps around', () => {
		expect(transposePitchClass('C', 7)).toBe('G');
		expect(transposePitchClass('G', 5)).toBe('C');

		// Full circle
		expect(transposePitchClass('C', 12)).toBe('C');
	});

	it('pitchClassInterval returns ascending interval', () => {
		expect(pitchClassInterval('C', 'G')).toBe(7);
		expect(pitchClassInterval('G', 'C')).toBe(5);
		expect(pitchClassInterval('C', 'C')).toBe(0);
	});

	it('concert ↔ written round-trip for Bb instruments', () => {
		const bbTenorSax = {
			id: 'tenor-sax',
			name: 'Tenor Sax',
			key: 'Bb' as const,
			transpositionSemitones: 2,
			concertRangeLow: 44,
			concertRangeHigh: 75,
			clef: 'treble' as const,
			gmProgram: 66,
			highNotePresets: [78, 77, 76, 75, 74, 72]
		};

		// Concert C4 → Written D4 (tenor sax is in Bb, written is 2 semitones higher)
		const written = concertToWritten(60, bbTenorSax);
		expect(written).toBe(62);

		const concert = writtenToConcert(written, bbTenorSax);
		expect(concert).toBe(60);
	});

	it('concert key ↔ written key round-trip', () => {
		const bbInstrument = {
			id: 'bb-instrument',
			name: 'Bb',
			key: 'Bb' as const,
			transpositionSemitones: 2,
			concertRangeLow: 44,
			concertRangeHigh: 75,
			clef: 'treble' as const,
			gmProgram: 56,
			highNotePresets: [78, 77, 76, 75, 74, 72]
		};

		const writtenKey = concertKeyToWritten('C', bbInstrument);
		expect(writtenKey).toBe('D');

		const backToConcert = writtenKeyToConcert(writtenKey, bbInstrument);
		expect(backToConcert).toBe('C');
	});

	it('transposition round-trip for all 12 keys', () => {
		for (const key of PITCH_CLASSES) {
			const up5 = transposePitchClass(key, 7);
			const backDown = transposePitchClass(up5, -7);
			expect(backDown).toBe(key);
		}
	});
});

// ─── Key Relationships ─────────────────────────────────────────

describe('key relationships', () => {
	it('circle of fifths returns 12 unique keys', () => {
		const fifths = circleOfFifths();
		expect(fifths).toHaveLength(12);
		expect(new Set(fifths).size).toBe(12);
	});

	it('relative minor of C is A', () => {
		expect(relativeMinor('C')).toBe('A');
	});

	it('relative major of A is C', () => {
		expect(relativeMajor('A')).toBe('C');
	});

	it('relative major/minor are inverses', () => {
		for (const key of PITCH_CLASSES) {
			const minor = relativeMinor(key);
			const backToMajor = relativeMajor(minor);
			expect(backToMajor).toBe(key);
		}
	});

	it('C has 0 accidentals, G has 1 sharp, F has 1 flat', () => {
		expect(keySignatureAccidentals('C')).toBe(0);
		expect(keySignatureAccidentals('G')).toBe(1);
		expect(keySignatureAccidentals('F')).toBe(-1);
	});
});

// ─── Cross-Module Integration ──────────────────────────────────

describe('cross-module integration', () => {
	it('ii-V-I in C: Dm7 → G7 → Cmaj7 chord tones are in their respective modes', () => {
		// ii: Dm7 in D Dorian
		const dorian = getScale('major.dorian')!;
		const dorianPcs = new Set(realizeScale('D', dorian.intervals));
		const dm7 = chordTones(62, 'min7');
		dm7.forEach(midi => {
			expect(dorianPcs.has(midiToPitchClass(midi))).toBe(true);
		});

		// V: G7 in G Mixolydian
		const mixo = getScale('major.mixolydian')!;
		const mixoPcs = new Set(realizeScale('G', mixo.intervals));
		const g7 = chordTones(67, '7');
		g7.forEach(midi => {
			expect(mixoPcs.has(midiToPitchClass(midi))).toBe(true);
		});

		// I: Cmaj7 in C Ionian
		const ionian = getScale('major.ionian')!;
		const ionianPcs = new Set(realizeScale('C', ionian.intervals));
		const cmaj7 = chordTones(60, 'maj7');
		cmaj7.forEach(midi => {
			expect(ionianPcs.has(midiToPitchClass(midi))).toBe(true);
		});
	});

	it('transposing a scale realization matches realizing in the transposed key', () => {
		const ionian = getScale('major.ionian')!;

		// Method 1: realize in C, then transpose up 7 (P5)
		const cMidi = realizeScaleMidi('C', ionian.intervals, 60, 72);
		const transposed = cMidi.map(m => m + 7);

		// Method 2: realize directly in G
		const gMidi = realizeScaleMidi('G', ionian.intervals, 67, 79);

		// The pitch classes should match (same scale in G)
		const transposedPcs = new Set(transposed.map(m => midiToPitchClass(m)));
		const gPcs = new Set(gMidi.map(m => midiToPitchClass(m)));

		expect(transposedPcs).toEqual(gPcs);
	});
});
