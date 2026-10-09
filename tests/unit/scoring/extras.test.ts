import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '$lib/scoring/scorer';
import {
	chargeableExtras,
	EXTRA_MIN_DURATION,
	EXTRA_MIN_CLARITY,
	EXTRA_PRE_ENTRY_SECONDS,
	TRANSITION_MAX_SECONDS,
	TRANSITION_MAX_SEMITONES
} from '$lib/scoring/extras';
import type { Note, Phrase, Fraction, HarmonicSegment } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

/**
 * Extra notes count as a zero in both accuracies — but only the ones the
 * player plausibly made. Measured 2026-10-07 on 1943 production sessions
 * and 356 Firefox lick-practice windows: charging every extra (the docs'
 * original promise) charges a detector artefact on most of the perfect
 * takes it touches — slivers, false splits of a held note, a click read at
 * the window open, a scooped attack cut in three — so the gate below frees
 * every shape that measured as an artefact and charges the rest. Wail (a),
 * the 2026-10-06 take saved "great" with its bar-2 ending fumbled, falls
 * from 0.878 to 0.638 under it; its sibling (b), whose only extras were a
 * short chromatic turn beside a correct note, keeps 0.934.
 */

/** A written note; offset and duration in whole-note fractions, duration an eighth by default. */
function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

/** A detected note at MIDI `midi`, 0 cents, onset and duration in seconds; duration 0.3 s and clarity 0.95 by default, `extra` overrides any field (e.g. `ghost`). */
function det(midi: number, onsetTime: number, duration = 0.3, clarity = 0.95, extra: Partial<DetectedNote> = {}): DetectedNote {
	return { midi, cents: 0, onsetTime, duration, clarity, ...extra };
}

const harmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'C-major', startOffset: [0, 1], duration: [2, 1] }
];

/** A curated 4/4 phrase in C holding `notes` over the shared two-bar Cmaj7 harmony. */
function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test', name: 'Test', timeSignature: [4, 4], key: 'C', notes, harmony,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major', tags: [], source: 'curated'
	};
}

// C D E F as eighths at 120 BPM: onsets 0, 0.25, 0.5, 0.75; the line ends at 1.0 s
const TEMPO = 120;
const line = [makeNote(60, [0, 1]), makeNote(62, [1, 8]), makeNote(64, [1, 4]), makeNote(65, [3, 8])];
const played = [det(60, 0), det(62, 0.25), det(64, 0.5), det(65, 0.75)];

describe('chargeableExtras — which extra notes count', () => {
	const expected = line;
	const paired = new Set([0, 1, 2, 3]);

	/**
	 * The chargeable extras when `extras` join the four correctly played notes:
	 * all merged by onset, the played notes paired and the rest unpaired, scored
	 * at 120 BPM straight. Returns indices into that merged, onset-sorted list.
	 */
	function charged(extras: DetectedNote[]): number[] {
		const detected = [...played, ...extras].sort((a, b) => a.onsetTime - b.onsetTime);
		const pairedIdx = new Set(detected.map((d, i) => (played.includes(d) ? i : -1)).filter((i) => i >= 0));
		const extraIdx = detected.map((d, i) => (played.includes(d) ? -1 : i)).filter((i) => i >= 0);
		return chargeableExtras(detected, extraIdx, pairedIdx, expected, TEMPO, 0.5);
	}

	it('charges a confident wrong note of real length inside the line', () => {
		// a G played between the E and the F, 0.3 s, clarity 0.95
		expect(charged([det(67, 0.62)])).toHaveLength(1);
	});

	it('frees a sliver shorter than the minimum duration', () => {
		expect(charged([det(67, 0.62, EXTRA_MIN_DURATION - 0.01)])).toHaveLength(0);
	});

	it('frees a note the detector was not confident in', () => {
		expect(charged([det(67, 0.62, 0.3, EXTRA_MIN_CLARITY - 0.01)])).toHaveLength(0);
	});

	it('frees a ghost note', () => {
		expect(charged([det(67, 0.62, 0.3, 0.95, { ghost: true })])).toHaveLength(0);
	});

	it('frees a false split: an extra sharing its pitch class with the note beside it', () => {
		// the held E split in two — the second half is a detector artefact, not a note
		expect(charged([det(64, 0.6)])).toHaveLength(0);
		expect(charged([det(76, 0.6)])).toHaveLength(0); // any octave
	});

	it('frees anything sounded after the written line ends', () => {
		expect(charged([det(67, 1.05)])).toHaveLength(0);
	});

	it('frees a note that starts before the line, where the window-open click is read as a pitch', () => {
		expect(charged([det(51, -EXTRA_PRE_ENTRY_SECONDS - 0.05)])).toHaveLength(0);
		// but a real pickup played just before the first note still counts
		expect(charged([det(67, -0.05)])).toHaveLength(1);
	});

	it('frees a short transition beside a paired note within two semitones: a scoop or a crack', () => {
		expect(charged([det(63, 0.44, TRANSITION_MAX_SECONDS - 0.05)])).toHaveLength(0); // Eb next to the E
		expect(charged([det(64 + TRANSITION_MAX_SEMITONES, 0.44, 0.2)])).toHaveLength(0);
	});

	it('charges the same note once it is long enough or far enough from its neighbours', () => {
		expect(charged([det(63, 0.44, TRANSITION_MAX_SECONDS + 0.05)])).toHaveLength(1);
		expect(charged([det(69, 0.44, 0.2)])).toHaveLength(1); // a fourth away: not a transition
	});
});

describe('scoreAttempt charges gated extras', () => {
	const phrase = makePhrase(line);

	it('a wrong note of real length widens both denominators and flags the result', () => {
		const clean = scoreAttempt(phrase, played, TEMPO);
		const withExtra = scoreAttempt(phrase, [...played, det(67, 0.62)].sort((a, b) => a.onsetTime - b.onsetTime), TEMPO);
		expect(clean.pitchAccuracy).toBeCloseTo(1, 5);
		expect(withExtra.notesHit).toBe(4);
		expect(withExtra.extrasCharged).toBe(1);
		expect(withExtra.pitchAccuracy).toBeCloseTo(4 / 5, 5);
		expect(withExtra.rhythmAccuracy).toBeCloseTo(clean.rhythmAccuracy * 4 / 5, 5);
		const extra = withExtra.noteResults.find((r) => r.extra)!;
		expect(extra.charged).toBe(true);
	});

	it('a detector sliver stays free, as every corpus take relies on', () => {
		const withSliver = scoreAttempt(phrase, [...played, det(67, 0.62, 0.05)].sort((a, b) => a.onsetTime - b.onsetTime), TEMPO);
		expect(withSliver.extrasCharged).toBe(0);
		expect(withSliver.pitchAccuracy).toBeCloseTo(1, 5);
		expect(withSliver.noteResults.find((r) => r.extra)!.charged).toBeUndefined();
	});
});
