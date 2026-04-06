import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '$lib/scoring/scorer.ts';
import type { Note, Phrase, Fraction, HarmonicSegment } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

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
		id: 'test',
		name: 'Test Phrase',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes,
		harmony: defaultHarmony,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

const TEMPO = 120;

describe('scoreAttempt', () => {
	it('scores a perfect attempt with high accuracy', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		]);
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5)
		];
		const score = scoreAttempt(phrase, detected, TEMPO);
		expect(score.pitchAccuracy).toBeGreaterThan(0.9);
		expect(score.rhythmAccuracy).toBeGreaterThan(0.9);
		expect(score.overall).toBeGreaterThan(0.9);
		expect(score.notesHit).toBe(3);
		expect(score.notesTotal).toBe(3);
	});

	it('scores 0 when no notes detected', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8])
		]);
		const score = scoreAttempt(phrase, [], TEMPO);
		expect(score.pitchAccuracy).toBe(0);
		expect(score.rhythmAccuracy).toBe(0);
		expect(score.overall).toBe(0);
		expect(score.notesHit).toBe(0);
		expect(score.notesTotal).toBe(2);
		expect(score.noteResults.every(r => r.missed)).toBe(true);
	});

	it('uses 60/40 weighting for pitch/rhythm', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const detected = [makeDetected(60, 0)];
		const score = scoreAttempt(phrase, detected, TEMPO);
		// With perfect pitch and rhythm, overall = pitch*0.6 + rhythm*0.4
		const expected = score.pitchAccuracy * 0.6 + score.rhythmAccuracy * 0.4;
		expect(score.overall).toBeCloseTo(expected, 5);
	});

	it('applies latency correction (constant offset absorbed)', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		]);
		// All notes are 0.1s late (constant latency)
		const detected = [
			makeDetected(60, 0.1),
			makeDetected(62, 0.35),
			makeDetected(64, 0.6)
		];
		const score = scoreAttempt(phrase, detected, TEMPO);
		// Latency correction should absorb the 0.1s offset
		expect(score.timing.latencyCorrectionMs).toBeCloseTo(100, 0);
		// After correction, rhythm should be high
		expect(score.rhythmAccuracy).toBeGreaterThan(0.8);
	});

	it('excludes rests from notesTotal', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(null, [1, 8]),  // rest
			makeNote(64, [1, 4])
		]);
		const detected = [
			makeDetected(60, 0),
			makeDetected(64, 0.5)
		];
		const score = scoreAttempt(phrase, detected, TEMPO);
		expect(score.notesTotal).toBe(2); // rest excluded
	});

	it('assigns a grade based on overall score', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const detected = [makeDetected(60, 0)];
		const score = scoreAttempt(phrase, detected, TEMPO);
		expect(['perfect', 'great', 'good', 'fair', 'try-again']).toContain(score.grade);
	});

	it('populates timing diagnostics', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8])
		]);
		const detected = [
			makeDetected(60, 0.05),
			makeDetected(62, 0.30)
		];
		const score = scoreAttempt(phrase, detected, TEMPO);
		expect(score.timing).toBeDefined();
		expect(typeof score.timing.meanOffsetMs).toBe('number');
		expect(typeof score.timing.medianOffsetMs).toBe('number');
		expect(typeof score.timing.stdDevMs).toBe('number');
		expect(score.timing.perNoteOffsetMs.length).toBeGreaterThan(0);
	});

	it('marks extra detected notes', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const detected = [
			makeDetected(60, 0),
			makeDetected(65, 0.3),
			makeDetected(67, 0.6)
		];
		const score = scoreAttempt(phrase, detected, TEMPO);
		const extra = score.noteResults.filter(r => r.extra);
		expect(extra.length).toBeGreaterThanOrEqual(2);
	});
});
