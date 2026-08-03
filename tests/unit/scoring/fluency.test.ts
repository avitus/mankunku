import { describe, it, expect } from 'vitest';
import {
	scoreFluency,
	scoreToFluencyGrade,
	FLUENCY_PATTERN_WEIGHT,
	FLUENCY_RHYTHM_WEIGHT
} from '$lib/scoring/fluency';
import { scoreConformanceAgainstSpec } from '$lib/tricks/conformance';
import type { Trick, TrickContext, TrickSlotSpec } from '$lib/types/tricks';
import type { DetectedNote } from '$lib/types/audio';
import type { Fraction, Note, Phrase } from '$lib/types/music';

function makeDetected(midi: number, onsetTime: number): DetectedNote {
	return { midi, cents: 0, onsetTime, duration: 0.3, clarity: 0.9 };
}

function makeSlot(
	offset: Fraction,
	exactPcs: number[],
	patternPcs?: number[],
	role = 'target'
): TrickSlotSpec {
	return { offset, duration: [1, 8], exactPcs, patternPcs, role };
}

/**
 * Minimal inline Trick: scoreConformance delegates to the engine over
 * hand-built slots; generateExample returns the given phrase (null by
 * default, exercising the fallback expected-note path). No device imports.
 */
function makeTrick(slots: TrickSlotSpec[], example: Phrase | null = null): Trick {
	return {
		id: 'test-trick',
		name: 'Test Trick',
		description: 'Inline fixture trick',
		category: 'triad-pairs',
		tags: ['trick'],
		compatibleQualities: ['maj7'],
		parameters: [],
		scoreConformance: (played, _parameters, ctx) => scoreConformanceAgainstSpec(played, slots, ctx),
		generateExample: () => example
	};
}

// C major context at 120 BPM: beat = 0.5 s, an eighth-note slot = 0.25 s.
const context: TrickContext = {
	chordRoot: 'C',
	chordQuality: 'maj7',
	scaleId: 'major.ionian',
	key: 'C',
	timeSignature: [4, 4],
	level: 50,
	tempo: 120
};

// Cmaj7 arpeggio in eighths: C E G B; patternPcs = the other chord tones.
const arpSlots: TrickSlotSpec[] = [
	makeSlot([0, 1], [0], [4, 7, 11]),
	makeSlot([1, 8], [4], [0, 7, 11]),
	makeSlot([2, 8], [7], [0, 4, 11]),
	makeSlot([3, 8], [11], [0, 4, 7])
];

const perfectPlayed = [
	makeDetected(60, 0),
	makeDetected(64, 0.25),
	makeDetected(67, 0.5),
	makeDetected(71, 0.75)
];

function fluency(played: DetectedNote[], trick: Trick = makeTrick(arpSlots)) {
	return scoreFluency({ played, trick, parameters: {}, context });
}

describe('scoreFluency', () => {
	it('scores a perfect attempt with patternScore 1 and grade perfect', () => {
		const score = fluency(perfectPlayed);
		expect(score.pitchAccuracy).toBe(1);
		expect(score.conformance.patternScore).toBe(1);
		expect(score.rhythmAccuracy).toBeCloseTo(1, 5);
		expect(score.overall).toBeCloseTo(1, 5);
		expect(score.grade).toBe('perfect');
		expect(score.notesHit).toBe(4);
		expect(score.notesTotal).toBe(4);
		expect(score.noteResults).toHaveLength(4);
		expect(score.noteResults.every((r) => !r.missed && !r.extra)).toBe(true);
	});

	it('applies the 0.7/0.3 pattern/rhythm weighting', () => {
		// Imperfect on both dimensions: one in-scale wrong note, one late note.
		const played = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(67, 0.6),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		expect(FLUENCY_PATTERN_WEIGHT).toBe(0.7);
		expect(FLUENCY_RHYTHM_WEIGHT).toBe(0.3);
		expect(score.overall).toBeCloseTo(
			FLUENCY_PATTERN_WEIGHT * score.pitchAccuracy + FLUENCY_RHYTHM_WEIGHT * score.rhythmAccuracy,
			10
		);
	});

	it('credits a wrong-but-in-scale note at 0.4', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(62, 0.25), // D for E: diatonic, off-formula
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		expect(score.conformance.slots[1].tier).toBe('in-scale');
		expect(score.noteResults[1].pitchScore).toBe(0.4);
		expect(score.pitchAccuracy).toBeCloseTo((1 + 0.4 + 1 + 1) / 4, 10);
		expect(score.notesHit).toBe(3);
	});

	it('credits an in-pattern neighbour at 0.7 and still counts it as hit', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(67, 0.25), // G for E: wrong member of the right chord
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		expect(score.conformance.slots[1].tier).toBe('in-pattern');
		expect(score.noteResults[1].pitchScore).toBe(0.7);
		expect(score.notesHit).toBe(4);
	});

	it('credits an out-of-scale note at 0.1 and does not count it as hit', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(61, 0.25), // Db for E: chromatic miss
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		expect(score.conformance.slots[1].tier).toBe('out-of-scale');
		expect(score.noteResults[1].pitchScore).toBe(0.1);
		expect(score.pitchAccuracy).toBeCloseTo((1 + 0.1 + 1 + 1) / 4, 10);
		expect(score.notesHit).toBe(3);
	});

	it('reports a missing note as a missed slot and drops patternScore', () => {
		const played = [makeDetected(60, 0), makeDetected(67, 0.5), makeDetected(71, 0.75)];
		const score = fluency(played);
		expect(score.pitchAccuracy).toBeCloseTo(3 / 4, 10);
		expect(score.notesTotal).toBe(4);
		const missed = score.noteResults[1];
		expect(missed.missed).toBe(true);
		expect(missed.detected).toBeNull();
		expect(missed.pitchScore).toBe(0);
		expect(missed.rhythmScore).toBe(0);
		expect(score.timing.perNoteOffsetMs[1]).toBeNull();
		// Rhythm is a mean over MATCHED slots only.
		expect(score.rhythmAccuracy).toBeCloseTo(1, 5);
	});

	it('surfaces extra notes in extraCount and as extra noteResults', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(62, 0.1), // interjected passing note
			makeDetected(64, 0.25),
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		expect(score.conformance.extraCount).toBe(1);
		expect(score.noteResults).toHaveLength(5);
		const extras = score.noteResults.filter((r) => r.extra);
		expect(extras).toHaveLength(1);
		expect(extras[0].detected?.midi).toBe(62);
		expect(extras[0].pitchScore).toBe(0);
		expect(score.notesTotal).toBe(4);
		expect(score.timing.perNoteOffsetMs).toHaveLength(5);
	});

	it('fully absorbs a constant +80ms latency', () => {
		const late = perfectPlayed.map((n) => makeDetected(n.midi, n.onsetTime + 0.08));
		const score = fluency(late);
		expect(score.timing.latencyCorrectionMs).toBeCloseTo(80, 5);
		expect(score.rhythmAccuracy).toBeCloseTo(1, 5);
		expect(score.timing.meanOffsetMs).toBeCloseTo(0, 5);
		expect(score.overall).toBeCloseTo(1, 5);
	});

	it('penalizes an isolated late note via scoreRhythm semantics', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(64, 0.35), // 100 ms late; median correction stays 0
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const score = fluency(played);
		// scoreRhythm at 120 BPM: penalty = min(1, 0.5 + 120/300) = 0.9;
		// 100 ms = 0.2 beats → 1 - 0.2 * 0.9 = 0.82 for the late slot.
		expect(score.noteResults[1].rhythmScore).toBeCloseTo(0.82, 5);
		expect(score.rhythmAccuracy).toBeCloseTo((1 + 0.82 + 1 + 1) / 4, 5);
		expect(score.timing.perNoteOffsetMs[1]).toBeCloseTo(100, 5);
	});

	it('scores an empty attempt as all missed with grade try-again', () => {
		const score = fluency([]);
		expect(score.pitchAccuracy).toBe(0);
		expect(score.rhythmAccuracy).toBe(0);
		expect(score.overall).toBe(0);
		expect(score.grade).toBe('try-again');
		expect(score.noteResults).toHaveLength(4);
		expect(score.noteResults.every((r) => r.missed)).toBe(true);
	});

	it('uses the trick example phrase for expected notes when counts match', () => {
		const notes: Note[] = [
			{ pitch: 60, offset: [0, 1], duration: [1, 8] },
			{ pitch: 64, offset: [1, 8], duration: [1, 8] },
			{ pitch: 67, offset: [2, 8], duration: [1, 8] },
			{ pitch: 71, offset: [3, 8], duration: [1, 8] }
		];
		const phrase: Phrase = {
			id: 'trick-example',
			name: 'Trick Example',
			timeSignature: [4, 4],
			key: 'C',
			notes,
			harmony: [
				{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'major.ionian', startOffset: [0, 1], duration: [1, 1] }
			],
			difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
			category: 'triad-pairs',
			tags: ['trick'],
			source: 'generated'
		};
		const score = fluency(perfectPlayed, makeTrick(arpSlots, phrase));
		expect(score.noteResults.map((r) => r.expected.pitch)).toEqual([60, 64, 67, 71]);
		expect(score.noteResults.map((r) => r.expected.offset)).toEqual(notes.map((n) => n.offset));
		expect(score.rhythmAccuracy).toBeCloseTo(1, 5);
		expect(score.overall).toBeCloseTo(1, 5);
	});
});

describe('scoreToFluencyGrade', () => {
	it('maps overall scores through the fluency thresholds', () => {
		expect(scoreToFluencyGrade(1)).toBe('perfect');
		expect(scoreToFluencyGrade(0.95)).toBe('perfect');
		expect(scoreToFluencyGrade(0.94)).toBe('great');
		expect(scoreToFluencyGrade(0.85)).toBe('great');
		expect(scoreToFluencyGrade(0.84)).toBe('good');
		expect(scoreToFluencyGrade(0.7)).toBe('good');
		expect(scoreToFluencyGrade(0.69)).toBe('fair');
		expect(scoreToFluencyGrade(0.55)).toBe('fair');
		expect(scoreToFluencyGrade(0.54)).toBe('try-again');
		expect(scoreToFluencyGrade(0)).toBe('try-again');
	});
});
