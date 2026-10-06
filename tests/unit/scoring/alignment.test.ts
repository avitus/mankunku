import { describe, it, expect } from 'vitest';
import { alignNotes, SKIP_COST } from '$lib/scoring/alignment';
import type { Note, Fraction } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

function makeDetected(midi: number, onsetTime: number, cents: number = 0): DetectedNote {
	return { midi, cents, onsetTime, duration: 0.3, clarity: 0.9 };
}

const TEMPO = 120; // 1 beat = 0.5s

describe('alignNotes', () => {
	it('returns empty array when no expected notes', () => {
		const detected = [makeDetected(60, 0)];
		expect(alignNotes([], detected, TEMPO)).toEqual([]);
	});

	it('returns all-missed pairs when no detected notes', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8])
		];
		const pairs = alignNotes(expected, [], TEMPO);
		expect(pairs).toHaveLength(2);
		expect(pairs.every(p => p.detectedIndex === null)).toBe(true);
		expect(pairs.every(p => p.cost === SKIP_COST)).toBe(true);
	});

	it('filters out rests from expected notes', () => {
		const expected = [
			makeNote(null, [0, 1]),   // rest — should be excluded
			makeNote(60, [1, 8])
		];
		const detected = [makeDetected(60, 0.25)];
		const pairs = alignNotes(expected, detected, TEMPO);
		// Only 1 expected note after filtering rests
		const matched = pairs.filter(p => p.expectedIndex !== null);
		expect(matched).toHaveLength(1);
	});

	it('matches notes with correct pitch and timing at low cost', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		];
		// At 120 BPM: beat 0 = 0s, beat 0.5 = 0.25s, beat 1 = 0.5s
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5)
		];
		const pairs = alignNotes(expected, detected, TEMPO);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		// Perfect match should have near-zero cost
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('marks missed notes when fewer detected than expected', () => {
		const expected = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		];
		const detected = [makeDetected(60, 0)];
		const pairs = alignNotes(expected, detected, TEMPO);
		const missed = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex === null);
		expect(missed.length).toBeGreaterThanOrEqual(2);
	});

	it('marks extra notes when more detected than expected', () => {
		const expected = [makeNote(60, [0, 1])];
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(64, 0.5)
		];
		const pairs = alignNotes(expected, detected, TEMPO);
		const extra = pairs.filter(p => p.expectedIndex === null && p.detectedIndex !== null);
		expect(extra.length).toBeGreaterThanOrEqual(2);
	});

	it('assigns higher cost for wrong pitch', () => {
		const expected = [makeNote(60, [0, 1])];
		// Correct pitch
		const correctPairs = alignNotes(expected, [makeDetected(60, 0)], TEMPO);
		// Wrong pitch (2 semitones off → cost capped at 1.0)
		const wrongPairs = alignNotes(expected, [makeDetected(62, 0)], TEMPO);

		const correctCost = correctPairs.find(p => p.expectedIndex === 0)!.cost;
		const wrongCost = wrongPairs.find(p => p.expectedIndex === 0)!.cost;
		expect(wrongCost).toBeGreaterThan(correctCost);
	});

	it('prices an uneven delay, not a constant one: a late note costs, a late take does not', () => {
		// The delay the aligner removes before pairing is the median offset of
		// the pitch-matched pairs — 0 here, with two anchors on time — so the
		// middle pair alone carries its lateness.
		const expected = [makeNote(60, [0, 1]), makeNote(62, [1, 4]), makeNote(64, [1, 2])];
		const beat = 60 / TEMPO;
		/** Alignment cost of the middle note played `lateBy` seconds behind its beat, the outer two on time. */
		const costOfMiddle = (lateBy: number) =>
			alignNotes(
				expected,
				[makeDetected(60, 0), makeDetected(62, beat + lateBy), makeDetected(64, 2 * beat)],
				TEMPO
			).find(p => p.expectedIndex === 1 && p.detectedIndex === 1)!.cost;
		expect(costOfMiddle(0.25 * beat)).toBeGreaterThan(costOfMiddle(0));
		// The whole take half a beat late costs nothing: that delay is removed before pairing.
		const late = alignNotes(
			expected,
			[makeDetected(60, 0.25), makeDetected(62, beat + 0.25), makeDetected(64, 2 * beat + 0.25)],
			TEMPO
		);
		expect(late.filter(p => p.expectedIndex !== null && p.detectedIndex !== null)).toHaveLength(3);
		for (const p of late) expect(p.cost).toBeCloseTo(0, 5);
	});

	it('applies swing offset to off-beat 8th notes', () => {
		// Note at offset [1,8] = beat 0.5 (an off-beat 8th)
		const expected = [makeNote(60, [1, 8])];
		const swing = 0.67;
		// With swing 0.67, the off-beat 8th shifts by (0.67-0.5)*beatDuration
		const beatDuration = 60 / TEMPO; // 0.5s
		const swungOnset = 0.5 * beatDuration + (swing - 0.5) * beatDuration;
		// Detect at the swung position
		const detected = [makeDetected(60, swungOnset)];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(0, 1);
	});

	it('does NOT shift triplet 8ths when swing > 0.5 (matches playback contract)', () => {
		// Triplet 8ths inside beat 1: offsets [0,12], [1,12], [2,12]
		// → beats 0, 1/3, 2/3 (none of which equal n + 1/2)
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const expected = [
			makeNote(60, [0, 12]),
			makeNote(62, [1, 12]),
			makeNote(64, [2, 12])
		];
		// Detected at the *unswung* positions — exactly 1/3 beat apart.
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, (1 / 3) * beatDuration),
			makeDetected(64, (2 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('beat-4 triplet pickup (major-chord-pickup-001) scores zero cost at swing 0.67', () => {
		// Replicates the exact pickup pattern from src/lib/data/licks/major-chord.ts
		// (offsets [3,4], [5,6], [11,12]) — the lick whose timing the user reported as broken.
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const expected = [
			makeNote(55, [3, 4]),    // beat 3.0
			makeNote(57, [5, 6]),    // beat 10/3
			makeNote(59, [11, 12])   // beat 11/3
		];
		const detected = [
			makeDetected(55, 3.0 * beatDuration),
			makeDetected(57, (10 / 3) * beatDuration),
			makeDetected(59, (11 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(3);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('mixed phrase: swings 8th off-beats, leaves triplets and downbeats unchanged', () => {
		// Beat 0 downbeat | beat 0.5 off-beat 8th | triplet at beats 1+1/3, 1+2/3
		const swing = 0.67;
		const beatDuration = 60 / TEMPO;
		const swungOffBeat = 0.5 + (swing - 0.5);    // 0.67 beats
		const expected = [
			makeNote(60, [0, 1]),   // downbeat
			makeNote(62, [1, 8]),   // off-beat 8th — should be swung
			makeNote(64, [4, 12]),  // triplet 8n at 4/3 beats — should NOT be swung
			makeNote(65, [5, 12])   // triplet 8n at 5/3 beats — should NOT be swung
		];
		const detected = [
			makeDetected(60, 0),
			makeDetected(62, swungOffBeat * beatDuration),
			makeDetected(64, (4 / 3) * beatDuration),
			makeDetected(65, (5 / 3) * beatDuration)
		];
		const pairs = alignNotes(expected, detected, TEMPO, swing);
		const matched = pairs.filter(p => p.expectedIndex !== null && p.detectedIndex !== null);
		expect(matched).toHaveLength(4);
		for (const p of matched) {
			expect(p.cost).toBeCloseTo(0, 1);
		}
	});

	it('treats octave-off as pitch-matched when octaveInsensitive=true', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// Detected C5 (one octave up) at the same time
		const pairs = alignNotes(expected, [makeDetected(72, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		// Cost should be rhythm-only (zero here) since pitch distance collapses to 0
		expect(matched!.cost).toBeCloseTo(0, 1);
	});

	it('still penalizes wrong pitch class when octaveInsensitive=true', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// C#5 → pitch class 1 vs expected 0 → cyclic distance 1 → cost 0.5
		const pairs = alignNotes(expected, [makeDetected(73, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(0.5, 1);
	});

	it('caps pitch-class distance at tritone (cyclic distance 6 → cost 1.0)', () => {
		const expected = [makeNote(60, [0, 1])]; // C4
		// F#5 (MIDI 78) → pitch class 6 → cyclic distance 6 → cost capped at 1.0
		const pairs = alignNotes(expected, [makeDetected(78, 0)], TEMPO, 0.5, true);
		const matched = pairs.find(p => p.expectedIndex === 0 && p.detectedIndex === 0);
		expect(matched).toBeDefined();
		expect(matched!.cost).toBeCloseTo(1.0, 1);
	});

	it('grades the strict pitch cost: one semitone costs 0.5, two or more saturate at 1.0', () => {
		const expected = [makeNote(60, [0, 1])];
		/** Alignment cost of a lone detected `midi` played on time against the expected C4. */
		const costFor = (midi: number) =>
			alignNotes(expected, [makeDetected(midi, 0)], TEMPO).find(p => p.expectedIndex === 0)!.cost;
		expect(costFor(61)).toBeCloseTo(0.5, 5);
		expect(costFor(62)).toBeCloseTo(1.0, 5);
		expect(costFor(67)).toBeCloseTo(1.0, 5);
	});

	it('saturates the rhythm cost at one beat — three beats late costs no more than one', () => {
		// Once a note sits more than a beat off its slot, timing stops
		// disambiguating the pairing. Two anchors on time hold the delay at 0.
		const expected = [makeNote(60, [0, 1]), makeNote(62, [1, 4]), makeNote(64, [6, 4])];
		const beat = 60 / TEMPO;
		/** Alignment cost of the middle note played `late` seconds behind its beat. */
		const costAt = (late: number) =>
			alignNotes(
				expected,
				[makeDetected(60, 0), makeDetected(62, beat + late), makeDetected(64, 6 * beat)],
				TEMPO
			).find(p => p.expectedIndex === 1 && p.detectedIndex === 1)!.cost;
		expect(costAt(0.5 * beat)).toBeCloseTo(0.5, 5);
		expect(costAt(beat)).toBeCloseTo(1.0, 5);
		expect(costAt(3 * beat)).toBeCloseTo(1.0, 5);
	});
});

describe('alignNotes with a ghost note', () => {
	it('prices a ghost a semitone off like any wrong semitone, and still pairs it with its slot', () => {
		const expected = [makeNote(62, [0, 1]), makeNote(60, [1, 8]), makeNote(62, [1, 4])];
		const detected: DetectedNote[] = [
			makeDetected(62, 0),
			{ ...makeDetected(61, 0.25, -30), ghost: true },
			makeDetected(62, 0.5)
		];
		const pairs = alignNotes(expected, detected, TEMPO);
		const ghostPair = pairs.find((p) => p.detectedIndex === 1);
		expect(ghostPair?.expectedIndex).toBe(1);
		expect(ghostPair?.cost).toBeCloseTo(0.5, 5);
	});
});

/**
 * Honeysuckle Rose, 2026-10-03: two Daily-practice takes (concert C and G,
 * 162 BPM) saved 2 of 5 where 4 and 3 notes were played. The first note's
 * attack cracked an octave low and the live path saved the crack as its own
 * note; one later note was swallowed. With a stray at the front and a miss
 * behind, the aligner paired every detected note with the PREVIOUS written
 * note and marked three correctly played notes wrong. Two things made the
 * shifted pairing cheaper: timing was read off the raw clock, which in lick
 * practice runs ~0.2 s behind the written line (an eighth at 162 BPM, so
 * "one slot early" looked on time), and a stray plus a miss cost two skips
 * of 2.0 against three wrong pitches at 1.0 each.
 */
describe('alignNotes with a stray note (Honeysuckle Rose, 2026-10-03)', () => {
	const LICK_TEMPO = 162;
	const SWING = 0.6;
	/** D C E G B in concert C: G4 F4 A3 C4 E4 — eighths, then a half note on beat 3. */
	const lick = [
		makeNote(67, [0, 1]),
		makeNote(65, [1, 8]),
		makeNote(57, [1, 4]),
		makeNote(60, [3, 8]),
		makeNote(64, [1, 2], [1, 2])
	];
	/** The notes the live path saved for the concert-C take: the G3 crack, then G4 F4 A3 E4. */
	const savedLive = [
		makeDetected(55, 0.209, 4),
		makeDetected(67, 0.337, -9),
		makeDetected(65, 0.441, -2),
		makeDetected(57, 0.639, 11),
		makeDetected(64, 0.89, 9)
	];
	const key = (pairs: ReturnType<typeof alignNotes>) => pairs.map(p => [p.expectedIndex, p.detectedIndex]);

	it('a stray head note and a dropped note do not shift the notes between them (saved: F and A marked wrong)', () => {
		const pairs = key(alignNotes(lick, savedLive, LICK_TEMPO, SWING, true));
		expect(pairs).toContainEqual([1, 2]); // F ← F
		expect(pairs).toContainEqual([2, 3]); // A ← A
		expect(pairs).toContainEqual([3, null]); // the swallowed C
		expect(pairs).toContainEqual([4, 4]); // E ← E
		// The G is one of the two head notes; the other is the stray.
		expect(pairs.filter(([e, d]) => e === null && (d === 0 || d === 1))).toHaveLength(1);
		expect(pairs.filter(([e, d]) => e === 0 && (d === 0 || d === 1))).toHaveLength(1);
	});

	it('strict scoring pairs the G with the G4, and the G3 crack is the stray', () => {
		const pairs = key(alignNotes(lick, savedLive, LICK_TEMPO, SWING, false));
		expect(pairs).toContainEqual([null, 0]);
		expect(pairs).toContainEqual([0, 1]);
		expect(pairs).toContainEqual([1, 2]);
		expect(pairs).toContainEqual([2, 3]);
		expect(pairs).toContainEqual([3, null]);
		expect(pairs).toContainEqual([4, 4]);
	});

	/** The lick's written onsets in seconds plus a constant live delay. */
	const liveTimes = (delay: number) =>
		lick.map(n => {
			const beats = (n.offset[0] / n.offset[1]) * 4;
			const swung = beats % 1 === 0.5 ? beats + (SWING - 0.5) : beats;
			return swung * (60 / LICK_TEMPO) + delay;
		});

	it('a line played a step up stays paired note for note — no stray, no miss', () => {
		const t = liveTimes(0.2);
		const detected = [69, 67, 59, 62, 66].map((m, i) => makeDetected(m, t[i]));
		const pairs = key(alignNotes(lick, detected, LICK_TEMPO, SWING, true));
		expect(pairs).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
	});

	it('a wrong note played in time is a wrong note, not a miss plus a stray', () => {
		const t = liveTimes(0.2);
		const detected = [67, 65, 58, 60, 64].map((m, i) => makeDetected(m, t[i]));
		const pairs = key(alignNotes(lick, detected, LICK_TEMPO, SWING, true));
		expect(pairs).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
	});

	it('a take played a whole beat late pairs like one on time, at no timing cost', () => {
		const t = liveTimes(60 / LICK_TEMPO);
		const detected = [67, 65, 57, 60, 64].map((m, i) => makeDetected(m, t[i]));
		const pairs = alignNotes(lick, detected, LICK_TEMPO, SWING, true);
		expect(key(pairs)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
		for (const p of pairs) expect(p.cost).toBeCloseTo(0, 5);
	});

	it('a stray plus a miss costs two skips; three wrong pitches cost three — the skips must not cost more', () => {
		// At 2.0 the aligner preferred three wrong notes to one stray and one
		// miss whenever three notes sat between them; at 1.5 the pitch costs tie
		// and the timing, read with the delay removed, decides for the notes.
		expect(SKIP_COST).toBe(1.5);
	});
});
