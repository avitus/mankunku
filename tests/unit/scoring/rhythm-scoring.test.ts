import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '$lib/scoring/scorer';
import { scoreRhythm } from '$lib/scoring/rhythm-scoring';
import type { Phrase, Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

/** Blues-001 phrase for testing */
const BLUES_001: Phrase = {
	id: 'blues-001',
	name: 'Blues Call',
	timeSignature: [4, 4] as [number, number],
	key: 'C',
	notes: [
		{ pitch: 63, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
		{ pitch: 65, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
		{ pitch: 67, duration: [1, 4] as [number, number], offset: [1, 2] as [number, number] },
		{ pitch: 70, duration: [1, 4] as [number, number], offset: [3, 4] as [number, number] },
		{ pitch: 72, duration: [1, 2] as [number, number], offset: [1, 1] as [number, number] },     // bar 2 beat 1
		{ pitch: 67, duration: [1, 2] as [number, number], offset: [3, 2] as [number, number] }      // bar 2 beat 3
	],
	harmony: [{
		chord: { root: 'C' as const, quality: '7' as const },
		scaleId: 'blues.minor',
		startOffset: [0, 1] as [number, number],
		duration: [2, 1] as [number, number]
	}],
	difficulty: { level: 15, pitchComplexity: 15, rhythmComplexity: 8, lengthBars: 2 },
	category: 'blues',
	tags: ['beginner'],
	source: 'curated'
};

const TEMPO = 120;
const BEAT = 60 / TEMPO; // 0.5s

/** Create detected notes with given onsets and MIDI values */
function makeDetected(notes: { midi: number; onset: number }[]): DetectedNote[] {
	return notes.map((n) => ({
		midi: n.midi,
		cents: 0,
		onsetTime: n.onset,
		duration: 0.4,
		clarity: 0.95
	}));
}

describe('scoreRhythm — unit', () => {
	it('gives 1.0 for perfectly timed note', () => {
		const note: Note = { pitch: 60, duration: [1, 4], offset: [1, 4] };
		const det: DetectedNote = { midi: 60, cents: 0, onsetTime: 0.5, duration: 0.4, clarity: 0.95 };
		expect(scoreRhythm(note, det, 120)).toBeCloseTo(1.0, 5);
	});

	it('gives ~0.55 when half a beat off at 120 BPM', () => {
		const note: Note = { pitch: 60, duration: [1, 4], offset: [1, 4] };
		const det: DetectedNote = { midi: 60, cents: 0, onsetTime: 0.75, duration: 0.4, clarity: 0.95 };
		// Expected onset = 0.5s, detected = 0.75s, error = 0.25s / 0.5s = 0.5 beats
		// penalty at 120 BPM = min(1.0, 0.5 + 120/300) = 0.9
		// Score = max(0, 1.0 - 0.5 * 0.9) = 0.55
		expect(scoreRhythm(note, det, 120)).toBeCloseTo(0.55, 5);
	});

	it('gives 0 when more than 1 beat off at 120 BPM', () => {
		const note: Note = { pitch: 60, duration: [1, 4], offset: [1, 4] };
		// Expected onset = 0.5s, ~1.2 beats off → detected at 0.5 + 1.2*0.5 = 1.1s
		const det: DetectedNote = { midi: 60, cents: 0, onsetTime: 1.1, duration: 0.4, clarity: 0.95 };
		// Error = 0.6s / 0.5s = 1.2 beats, penalty = 0.9
		// Score = max(0, 1.0 - 1.2 * 0.9) = max(0, -0.08) = 0
		expect(scoreRhythm(note, det, 120)).toBeCloseTo(0.0, 3);
	});

	it('scores bar-2 note the same as bar-1 note for identical timing error', () => {
		// Bar 1, note 2 at offset [1/4]
		const bar1Note: Note = { pitch: 65, duration: [1, 4], offset: [1, 4] };
		const bar1Det: DetectedNote = { midi: 65, cents: 0, onsetTime: 0.55, duration: 0.4, clarity: 0.95 };

		// Bar 2, note 5 at offset [1/1]
		const bar2Note: Note = { pitch: 72, duration: [1, 2], offset: [1, 1] };
		const bar2Det: DetectedNote = { midi: 72, cents: 0, onsetTime: 2.05, duration: 0.4, clarity: 0.95 };

		// Both have 0.05s error → same timing error in beats
		const score1 = scoreRhythm(bar1Note, bar1Det, 120);
		const score2 = scoreRhythm(bar2Note, bar2Det, 120);

		expect(score1).toBeCloseTo(score2, 5);
	});
});

describe('scoreAttempt — bar boundary rhythm', () => {
	it('scores all notes similarly with consistent latency', () => {
		const latency = 0.2;
		const detected = makeDetected([
			{ midi: 63, onset: 0 * BEAT + latency },  // note 1
			{ midi: 65, onset: 1 * BEAT + latency },  // note 2
			{ midi: 67, onset: 2 * BEAT + latency },  // note 3
			{ midi: 70, onset: 3 * BEAT + latency },  // note 4
			{ midi: 72, onset: 4 * BEAT + latency },  // note 5 (bar 2)
			{ midi: 67, onset: 6 * BEAT + latency }   // note 6
		]);

		const score = scoreAttempt(BLUES_001, detected, TEMPO);

		// After latency correction, all timing errors should be ~0
		for (let i = 0; i < score.noteResults.length; i++) {
			const nr = score.noteResults[i];
			if (!nr.missed && !nr.extra) {
				expect(nr.rhythmScore).toBeGreaterThan(0.9);
			}
		}
	});

	it('note 5 is not disproportionately penalized compared to note 2 for same extra delay', () => {
		const latency = 0.2;
		const extraDelay = 0.05; // 50ms extra

		// Test with note 2 having extra delay
		const detected2Late = makeDetected([
			{ midi: 63, onset: 0 * BEAT + latency },
			{ midi: 65, onset: 1 * BEAT + latency + extraDelay },  // note 2 late
			{ midi: 67, onset: 2 * BEAT + latency },
			{ midi: 70, onset: 3 * BEAT + latency },
			{ midi: 72, onset: 4 * BEAT + latency },
			{ midi: 67, onset: 6 * BEAT + latency }
		]);

		// Test with note 5 having extra delay
		const detected5Late = makeDetected([
			{ midi: 63, onset: 0 * BEAT + latency },
			{ midi: 65, onset: 1 * BEAT + latency },
			{ midi: 67, onset: 2 * BEAT + latency },
			{ midi: 70, onset: 3 * BEAT + latency },
			{ midi: 72, onset: 4 * BEAT + latency + extraDelay },  // note 5 late
			{ midi: 67, onset: 6 * BEAT + latency }
		]);

		const score2 = scoreAttempt(BLUES_001, detected2Late, TEMPO);
		const score5 = scoreAttempt(BLUES_001, detected5Late, TEMPO);

		// The delayed note in each case — find the matched note's rhythm score
		const note2RhythmWhenLate = score2.noteResults.find(
			(nr) => nr.expected.pitch === 65 && !nr.missed
		)?.rhythmScore ?? -1;
		const note5RhythmWhenLate = score5.noteResults.find(
			(nr) => nr.expected.pitch === 72 && !nr.missed
		)?.rhythmScore ?? -1;

		// The penalty should be comparable (within 0.1) — no systematic bias
		expect(Math.abs(note2RhythmWhenLate - note5RhythmWhenLate)).toBeLessThan(0.15);
	});

	it('applies latency correction uniformly — no bar-boundary bias', () => {
		// Simulate consistent timing imperfection (each note ~40ms residual jitter)
		const latency = 0.2;
		const jitter = 0.04;
		const detected = makeDetected([
			{ midi: 63, onset: 0 * BEAT + latency + jitter },
			{ midi: 65, onset: 1 * BEAT + latency - jitter },
			{ midi: 67, onset: 2 * BEAT + latency + jitter },
			{ midi: 70, onset: 3 * BEAT + latency - jitter },
			{ midi: 72, onset: 4 * BEAT + latency + jitter },     // bar 2 note
			{ midi: 67, onset: 6 * BEAT + latency - jitter }
		]);

		const score = scoreAttempt(BLUES_001, detected, TEMPO);

		const rhythmScores = score.noteResults
			.filter((nr) => !nr.missed && !nr.extra)
			.map((nr) => nr.rhythmScore);

		// All notes should have comparable rhythm scores
		const min = Math.min(...rhythmScores);
		const max = Math.max(...rhythmScores);
		expect(max - min).toBeLessThan(0.2);

		// Note 5 (index 4) should NOT be significantly worse than average
		const avg = rhythmScores.reduce((a, b) => a + b) / rhythmScores.length;
		expect(rhythmScores[4]).toBeGreaterThan(avg - 0.15);
	});

	it('note 5 rhythm is not 0 when played with reasonable timing', () => {
		// Simulate a player who plays well but takes a tiny breath at the bar
		const latency = 0.2;
		const detected = makeDetected([
			{ midi: 63, onset: 0 * BEAT + latency },
			{ midi: 65, onset: 1 * BEAT + latency },
			{ midi: 67, onset: 2 * BEAT + latency },
			{ midi: 70, onset: 3 * BEAT + latency },
			{ midi: 72, onset: 4 * BEAT + latency + 0.06 }, // 60ms breath at bar
			{ midi: 67, onset: 6 * BEAT + latency + 0.03 }  // slightly late from bar-line hesitation
		]);

		const score = scoreAttempt(BLUES_001, detected, TEMPO);

		const note5 = score.noteResults.find((nr) => nr.expected.pitch === 72 && !nr.missed);
		expect(note5).toBeDefined();
		expect(note5!.rhythmScore).toBeGreaterThan(0.5);
	});
});
