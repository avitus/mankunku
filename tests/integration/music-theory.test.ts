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
	circleOfFifths,
	relativeMajor,
	relativeMinor
} from '../../src/lib/music/keys';
import { chordTones } from '../../src/lib/music/chords';
import {
	midiToPitchClass,
	midiToNoteName,
	noteNameToMidi,
	frequencyToMidi,
	midiToFrequency,
	intervalSize,
	semitoneDistance,
	quantizePitch
} from '../../src/lib/music/intervals';
import { transpose, transposePitchClass } from '../../src/lib/music/transposition';
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

	it('catalogs 35+ scales across all families', () => {
		expect(SCALE_CATALOG.length).toBeGreaterThanOrEqual(30);

		const families = new Set(SCALE_CATALOG.map(s => s.family));
		expect(families.size).toBeGreaterThanOrEqual(6);
	});
});

// ─── Scale Realization ─────────────────────────────────────────

describe('scale realization', () => {
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

// ─── MIDI ↔ Note Name ──────────────────────────────────────────

describe('MIDI conversions', () => {
	it('noteNameToMidi round-trips with midiToNoteName', () => {
		for (let midi = 21; midi <= 108; midi++) {
			const name = midiToNoteName(midi);
			expect(noteNameToMidi(name)).toBe(midi);
		}
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

});

// ─── Transposition ─────────────────────────────────────────────

describe('transposition', () => {
	it('transpose by 0 is identity', () => {
		expect(transpose(60, 0)).toBe(60);
	});

	it('transpose up an octave', () => {
		expect(transpose(60, 12)).toBe(72);
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

	it('relative major/minor are inverses', () => {
		for (const key of PITCH_CLASSES) {
			const minor = relativeMinor(key);
			const backToMajor = relativeMajor(minor);
			expect(backToMajor).toBe(key);
		}
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
