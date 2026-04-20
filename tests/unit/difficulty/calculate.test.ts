import { describe, it, expect } from 'vitest';
import { calculateDifficulty } from '$lib/difficulty/calculate';
import type { Phrase, Note, Fraction, HarmonicSegment } from '$lib/types/music';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 4]): Note {
	return { pitch, offset, duration };
}

const defaultHarmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'C-major', startOffset: [0, 1], duration: [4, 1] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'Test',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes,
		harmony: defaultHarmony,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

describe('calculateDifficulty', () => {
	it('simple stepwise phrase has low difficulty', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 4]),
			makeNote(64, [2, 4])
		]);
		const diff = calculateDifficulty(phrase);
		expect(diff.level).toBeLessThan(30);
		expect(diff.pitchComplexity).toBeLessThan(30);
	});

	it('complex phrase has higher difficulty', () => {
		// Many notes, large intervals, chromatic, fast rhythm
		const phrase = makePhrase([
			makeNote(60, [0, 1], [1, 16]),
			makeNote(72, [1, 16], [1, 16]),     // large leap
			makeNote(61, [2, 16], [1, 16]),     // chromatic
			makeNote(73, [3, 16], [1, 16]),     // large leap
			makeNote(62, [4, 16], [1, 16]),     // chromatic
			makeNote(74, [5, 16], [1, 16]),
			makeNote(63, [6, 16], [1, 16]),
			makeNote(75, [7, 16], [1, 16]),
			makeNote(64, [8, 16], [1, 16]),
			makeNote(76, [9, 16], [1, 16]),
			makeNote(65, [10, 16], [1, 16]),
			makeNote(77, [11, 16], [1, 16]),
			makeNote(66, [12, 16], [1, 16]),
			makeNote(78, [13, 16], [1, 16])
		]);
		const diff = calculateDifficulty(phrase);
		expect(diff.level).toBeGreaterThan(30);
	});

	it('larger intervals increase pitch complexity', () => {
		const stepwise = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 4])    // step (2 semitones)
		]);
		const leapy = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(72, [1, 4])    // octave leap (12 semitones)
		]);
		const stepDiff = calculateDifficulty(stepwise);
		const leapDiff = calculateDifficulty(leapy);
		expect(leapDiff.pitchComplexity).toBeGreaterThan(stepDiff.pitchComplexity);
	});

	it('faster subdivisions increase rhythm complexity', () => {
		const quarters = makePhrase([
			makeNote(60, [0, 1], [1, 4]),
			makeNote(62, [1, 4], [1, 4]),
			makeNote(64, [2, 4], [1, 4]),
			makeNote(66, [3, 4], [1, 4])
		]);
		const sixteenths = makePhrase([
			makeNote(60, [0, 1], [1, 16]),
			makeNote(62, [1, 16], [1, 16]),
			makeNote(64, [2, 16], [1, 16]),
			makeNote(66, [3, 16], [1, 16])
		]);
		const qDiff = calculateDifficulty(quarters);
		const sDiff = calculateDifficulty(sixteenths);
		expect(sDiff.rhythmComplexity).toBeGreaterThan(qDiff.rhythmComplexity);
	});

	it('chromaticism increases pitch complexity', () => {
		const diatonic = makePhrase([
			makeNote(60, [0, 1]),    // C
			makeNote(62, [1, 4]),    // D
			makeNote(64, [2, 4]),    // E
			makeNote(65, [3, 4])     // F
		]);
		const chromatic = makePhrase([
			makeNote(61, [0, 1]),    // C# (non-diatonic)
			makeNote(63, [1, 4]),    // Eb (non-diatonic)
			makeNote(66, [2, 4]),    // F# (non-diatonic)
			makeNote(68, [3, 4])     // Ab (non-diatonic)
		]);
		const dDiff = calculateDifficulty(diatonic);
		const cDiff = calculateDifficulty(chromatic);
		expect(cDiff.pitchComplexity).toBeGreaterThan(dDiff.pitchComplexity);
	});

	it('level is clamped between 1 and 100', () => {
		const simple = makePhrase([makeNote(60, [0, 1]), makeNote(62, [1, 4])]);
		const diff = calculateDifficulty(simple);
		expect(diff.level).toBeGreaterThanOrEqual(1);
		expect(diff.level).toBeLessThanOrEqual(100);
	});

	it('computes lengthBars from note extents', () => {
		// Notes spanning 2 bars in 4/4
		const phrase = makePhrase([
			makeNote(60, [0, 1], [1, 4]),
			makeNote(62, [3, 4], [1, 4]),     // ends at beat 4 = bar 1
			makeNote(64, [1, 1], [1, 4])      // bar 2
		]);
		const diff = calculateDifficulty(phrase);
		expect(diff.lengthBars).toBe(2);
	});

	it('handles single-note phrase without crashing', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const diff = calculateDifficulty(phrase);
		expect(diff.level).toBeGreaterThanOrEqual(1);
	});

	it('handles phrase with only rests', () => {
		const phrase = makePhrase([
			makeNote(null, [0, 1]),
			makeNote(null, [1, 4])
		]);
		const diff = calculateDifficulty(phrase);
		expect(diff.level).toBeGreaterThanOrEqual(1);
	});
});
