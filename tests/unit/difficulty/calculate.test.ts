import { describe, it, expect } from 'vitest';
import { calculateDifficulty, effectiveDifficultyLevel } from '$lib/difficulty/calculate';
import { noteCountFloorLevel } from '$lib/difficulty/params';
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

	/**
	 * A diatonic eighth-note run of a fixed 4-note cell: every dimension other
	 * than length (range, intervals, chromaticism, subdivision, notes-per-bar)
	 * is held constant, so only note count can move the score.
	 */
	function makeRun(noteCount: number): Phrase {
		const cell = [60, 62, 64, 65];
		return makePhrase(
			Array.from({ length: noteCount }, (_, i) =>
				makeNote(cell[i % cell.length], [i, 8], [1, 8])
			)
		);
	}

	it('more notes means more difficulty', () => {
		expect(calculateDifficulty(makeRun(8)).level).toBeGreaterThan(
			calculateDifficulty(makeRun(4)).level
		);
	});

	it('note count keeps raising difficulty past 14 notes', () => {
		// Length is the dominant memory load in play-by-ear: a 20-note line is
		// materially harder than a 14-note one, and a 26-note one harder again.
		const at14 = calculateDifficulty(makeRun(14)).level;
		const at20 = calculateDifficulty(makeRun(20)).level;
		const at26 = calculateDifficulty(makeRun(26)).level;
		expect(at20).toBeGreaterThan(at14);
		expect(at26).toBeGreaterThan(at20);
	});
});

describe('effectiveDifficultyLevel', () => {
	it('keeps the stored level when it already clears the note-count floor', () => {
		const phrase = makePhrase([makeNote(60, [0, 1]), makeNote(62, [1, 4])]);
		phrase.difficulty = { level: 30, pitchComplexity: 30, rhythmComplexity: 30, lengthBars: 1 };
		expect(effectiveDifficultyLevel(phrase)).toBe(30);
	});

	it('lifts an under-rated long lick to its note-count floor', () => {
		const notes = Array.from({ length: 13 }, (_, i) => makeNote(60 + (i % 5), [i, 8], [1, 8]));
		const phrase = makePhrase(notes);
		phrase.difficulty = { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 2 };
		expect(effectiveDifficultyLevel(phrase)).toBe(noteCountFloorLevel(13));
		expect(effectiveDifficultyLevel(phrase)).toBeGreaterThan(20);
	});

	it('ignores rests when counting notes', () => {
		const notes: Note[] = [
			...Array.from({ length: 4 }, (_, i) => makeNote(60 + i, [i, 8], [1, 8])),
			...Array.from({ length: 12 }, (_, i) => makeNote(null, [4 + i, 8], [1, 8]))
		];
		const phrase = makePhrase(notes);
		phrase.difficulty = { level: 3, pitchComplexity: 3, rhythmComplexity: 3, lengthBars: 2 };
		expect(effectiveDifficultyLevel(phrase)).toBe(3);
	});
});
