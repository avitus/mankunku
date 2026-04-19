/**
 * Integrated tests for octave-insensitive scoring (lick-practice continuous
 * mode).
 *
 * The unit-level layers (scorePitch, pitchDistance, scoreAttempt,
 * runScorePipeline) each have their own focused tests. This file exercises
 * the full stack through `scoreAttempt` to make sure the flag truly carries
 * through alignment + pitch scoring + hit-counting together, with real DTW
 * matching (no mocks).
 */
import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '$lib/scoring/scorer';
import type { Note, Phrase, Fraction, HarmonicSegment } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

function makeDetected(midi: number, onsetTime: number, cents: number = 0): DetectedNote {
	return { midi, cents, onsetTime, duration: 0.3, clarity: 0.9 };
}

const defaultHarmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'C-major', startOffset: [0, 1], duration: [2, 1] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'lick-test',
		name: 'Lick',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes,
		harmony: defaultHarmony,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'bebop-lines',
		tags: [],
		source: 'curated'
	} as unknown as Phrase;
}

const TEMPO = 120;

// A four-note phrase over one bar: C4 D4 E4 G4.
const EXPECTED_NOTES = [
	makeNote(60, [0, 1]),
	makeNote(62, [1, 8]),
	makeNote(64, [1, 4]),
	makeNote(67, [3, 8])
];

describe('octave-insensitive scoring (continuous-mode integration)', () => {
	it('scores a phrase played exactly on-register at full credit with or without the flag', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5),
			makeDetected(67, 0.75)
		];
		const strict = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, false);
		const loose = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(strict.pitchAccuracy).toBeGreaterThan(0.9);
		expect(loose.pitchAccuracy).toBeGreaterThan(0.9);
		expect(strict.notesHit).toBe(4);
		expect(loose.notesHit).toBe(4);
	});

	it('scores a phrase played one octave up at full credit when flag is on', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(72, 0),   // C5
			makeDetected(74, 0.25), // D5
			makeDetected(76, 0.5),  // E5
			makeDetected(79, 0.75)  // G5
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(4);
		expect(score.notesTotal).toBe(4);
	});

	it('scores a phrase played one octave down at full credit when flag is on', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(48, 0),   // C3
			makeDetected(50, 0.25), // D3
			makeDetected(52, 0.5),  // E3
			makeDetected(55, 0.75)  // G3
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(4);
	});

	it('scores two-octave shifts as full credit when flag is on', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(84, 0),   // C6
			makeDetected(86, 0.25), // D6
			makeDetected(88, 0.5),  // E6
			makeDetected(91, 0.75)  // G6
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(4);
	});

	it('scores mixed-octave playing at full credit when flag is on', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(60, 0),   // C4
			makeDetected(74, 0.25), // D5 (jumped up)
			makeDetected(64, 0.5),  // E4 (back down)
			makeDetected(79, 0.75)  // G5 (up again)
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(4);
	});

	it('regression: strict mode (flag off) rejects the same octave-up input', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		const detected = [
			makeDetected(72, 0),
			makeDetected(74, 0.25),
			makeDetected(76, 0.5),
			makeDetected(79, 0.75)
		];
		const score = scoreAttempt(phrase, detected, TEMPO); // no flag → strict
		expect(score.pitchAccuracy).toBeLessThan(0.1);
		expect(score.notesHit).toBe(0);
	});

	it('still rejects wrong pitch classes even with the flag on (semitone-off fails)', () => {
		const phrase = makePhrase(EXPECTED_NOTES);
		// Each note shifted up a semitone + one octave
		const detected = [
			makeDetected(73, 0),   // C#5
			makeDetected(75, 0.25), // D#5
			makeDetected(77, 0.5),  // F5
			makeDetected(80, 0.75)  // G#5
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.pitchAccuracy).toBeLessThan(0.1);
		expect(score.notesHit).toBe(0);
	});

	it('handles rests correctly with the flag on', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(null, [1, 8]), // rest
			makeNote(64, [1, 4])
		]);
		const detected = [
			makeDetected(72, 0),   // C5 (octave up of expected)
			makeDetected(76, 0.5)  // E5 (octave up)
		];
		const score = scoreAttempt(phrase, detected, TEMPO, 0, 0.5, true);
		expect(score.notesTotal).toBe(2); // rest excluded
		expect(score.notesHit).toBe(2);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
	});
});
