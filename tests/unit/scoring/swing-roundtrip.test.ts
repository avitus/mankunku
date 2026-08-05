/**
 * Playback↔scorer swing round-trip: a performance played EXACTLY where the
 * playback engine schedules the melody must score perfectly, at every
 * tempo and session swing. This pins the increment-4 invariant that the
 * backing track's tempo-dependent swing (`swingForTempo`) never leaks into
 * what the scorer expects of the player — melody scheduling and scoring
 * share only `applySwingToBeats(beats, sessionSwing)`.
 */
import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '$lib/scoring/scorer';
import { applySwingToBeats } from '$lib/music/swing';
import type { Phrase, Note, Fraction } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

function makeNote(pitch: number, offsetBeats: number, durationBeats: number): Note {
	const offset: Fraction = [Math.round(offsetBeats * 4), 16];
	const duration: Fraction = [Math.round(durationBeats * 4), 16];
	return { pitch, duration, offset, velocity: 90 };
}

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'roundtrip',
		name: 'Roundtrip',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'generated'
	};
}

// A line with off-beat eighths — the notes swing actually moves.
const NOTES = [
	makeNote(60, 0, 0.5),
	makeNote(62, 0.5, 0.5),
	makeNote(64, 1, 0.5),
	makeNote(65, 1.5, 0.5),
	makeNote(67, 2, 1),
	makeNote(65, 3, 0.5),
	makeNote(64, 3.5, 0.5)
];

describe('swing round-trip: scheduled times score perfectly', () => {
	for (const tempo of [90, 160, 240]) {
		for (const sessionSwing of [0.5, 0.62]) {
			it(`tempo ${tempo}, session swing ${sessionSwing}`, () => {
				const phrase = makePhrase(NOTES);
				const beatSeconds = 60 / tempo;
				// Detected notes at exactly the swung scheduled times.
				const detected: DetectedNote[] = NOTES.map((n) => {
					const beat = (n.offset[0] / n.offset[1]) * 4;
					const durBeats = (n.duration[0] / n.duration[1]) * 4;
					return {
						midi: n.pitch as number,
						cents: 0,
						onsetTime: applySwingToBeats(beat, sessionSwing) * beatSeconds,
						duration: durBeats * beatSeconds * 0.9,
						clarity: 0.95
					};
				});
				const score = scoreAttempt(phrase, detected, tempo, 0, sessionSwing);
				expect(score.notesHit).toBe(NOTES.length);
				expect(score.pitchAccuracy).toBeGreaterThan(0.99);
				expect(score.rhythmAccuracy).toBeGreaterThan(0.97);
			});
		}
	}
});
