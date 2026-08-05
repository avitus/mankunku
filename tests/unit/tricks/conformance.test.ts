import { describe, it, expect } from 'vitest';
import {
	scoreConformanceAgainstSpec,
	scoreConformanceAgainstSpecs,
	playedDegreeLabel
} from '$lib/tricks/conformance';
import type { TrickContext, TrickSlotSpec } from '$lib/types/tricks';
import type { DetectedNote } from '$lib/types/audio';
import type { Fraction } from '$lib/types/music';

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

// Cmaj7 arpeggio in eighths: C E G B, each slot's patternPcs = the other
// chord tones (right chord, wrong member).
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

describe('scoreConformanceAgainstSpec', () => {
	it('scores a perfect attempt as all-exact with patternScore 1', () => {
		const result = scoreConformanceAgainstSpec(perfectPlayed, arpSlots, context);
		expect(result.slots).toHaveLength(4);
		for (const slot of result.slots) {
			expect(slot.tier).toBe('exact');
			expect(slot.credit).toBe(1.0);
			expect(slot.onsetErrorMs).toBeCloseTo(0, 5);
		}
		expect(result.patternScore).toBe(1);
		expect(result.extraCount).toBe(0);
		expect(result.latencyCorrectionMs).toBeCloseTo(0, 5);
	});

	it('labels played degrees relative to the chord root', () => {
		const result = scoreConformanceAgainstSpec(perfectPlayed, arpSlots, context);
		expect(result.slots.map((s) => s.playedDegree)).toEqual(['1', '3', '5', '7']);
		expect(result.slots.map((s) => s.playedMidi)).toEqual([60, 64, 67, 71]);
	});

	it('is octave-insensitive: any octave of an exact pc is exact', () => {
		const upAnOctave = [
			makeDetected(72, 0),
			makeDetected(76, 0.25),
			makeDetected(79, 0.5),
			makeDetected(83, 0.75)
		];
		const result = scoreConformanceAgainstSpec(upAnOctave, arpSlots, context);
		expect(result.slots.every((s) => s.tier === 'exact')).toBe(true);
		expect(result.patternScore).toBe(1);
	});

	it('grades an in-pattern neighbour at 0.7 credit', () => {
		// G where E was expected: wrong member of the right chord.
		const played = [
			makeDetected(60, 0),
			makeDetected(67, 0.25),
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		expect(result.slots[1].tier).toBe('in-pattern');
		expect(result.slots[1].credit).toBe(0.7);
		expect(result.patternScore).toBeCloseTo((1 + 0.7 + 1 + 1) / 4, 10);
	});

	it('grades a diatonic wrong note at 0.4 credit (in-scale)', () => {
		// D where E was expected: not exact, not in patternPcs, in C major.
		const played = [
			makeDetected(60, 0),
			makeDetected(62, 0.25),
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		expect(result.slots[1].tier).toBe('in-scale');
		expect(result.slots[1].credit).toBe(0.4);
		expect(result.slots[1].playedDegree).toBe('2');
		expect(result.patternScore).toBeCloseTo((1 + 0.4 + 1 + 1) / 4, 10);
	});

	it('grades a chromatic miss at 0.1 credit (out-of-scale)', () => {
		// Db where E was expected: outside C major entirely.
		const played = [
			makeDetected(60, 0),
			makeDetected(61, 0.25),
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		expect(result.slots[1].tier).toBe('out-of-scale');
		expect(result.slots[1].credit).toBe(0.1);
		expect(result.slots[1].playedDegree).toBe('b2');
		expect(result.patternScore).toBeCloseTo((1 + 0.1 + 1 + 1) / 4, 10);
	});

	it('marks an unplayed slot as missed and includes it as 0 in patternScore', () => {
		const played = [makeDetected(60, 0), makeDetected(67, 0.5), makeDetected(71, 0.75)];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		const missed = result.slots[1];
		expect(missed.tier).toBe('missed');
		expect(missed.credit).toBe(0);
		expect(missed.playedMidi).toBeNull();
		expect(missed.playedDegree).toBeNull();
		expect(missed.onsetErrorMs).toBeNull();
		expect(result.patternScore).toBeCloseTo(3 / 4, 10);
		expect(result.extraCount).toBe(0);
	});

	it('counts played notes aligned to no slot as extras', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(62, 0.1), // interjected passing note
			makeDetected(64, 0.25),
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		expect(result.extraCount).toBe(1);
		expect(result.patternScore).toBe(1);
	});

	it('absorbs a constant +80ms latency into the correction', () => {
		const late = perfectPlayed.map((n) => makeDetected(n.midi, n.onsetTime + 0.08));
		const result = scoreConformanceAgainstSpec(late, arpSlots, context);
		expect(result.latencyCorrectionMs).toBeCloseTo(80, 5);
		for (const slot of result.slots) {
			expect(slot.onsetErrorMs).toBeCloseTo(0, 5);
			expect(slot.tier).toBe('exact');
		}
		expect(result.patternScore).toBe(1);
	});

	it('reports a single late note against a zero median correction', () => {
		const played = [
			makeDetected(60, 0),
			makeDetected(64, 0.35), // 100 ms late
			makeDetected(67, 0.5),
			makeDetected(71, 0.75)
		];
		const result = scoreConformanceAgainstSpec(played, arpSlots, context);
		// Median of [0, 0.1, 0, 0] is 0 — the outlier is not absorbed.
		expect(result.latencyCorrectionMs).toBeCloseTo(0, 5);
		expect(result.slots[1].onsetErrorMs).toBeCloseTo(100, 5);
		expect(result.slots[0].onsetErrorMs).toBeCloseTo(0, 5);
	});

	it('shifts off-beat 8th slot expectations when swing > 0.5', () => {
		const swung: TrickContext = { ...context, swing: 0.67 };
		const slots = [makeSlot([0, 1], [0]), makeSlot([1, 8], [4])];
		// The off-beat 8th sounds at 0.67 of the beat: 0.67 * 0.5 s = 0.335 s.
		const played = [makeDetected(60, 0), makeDetected(64, 0.335)];
		const result = scoreConformanceAgainstSpec(played, slots, swung);
		expect(result.slots[0].onsetErrorMs).toBeCloseTo(0, 3);
		expect(result.slots[1].onsetErrorMs).toBeCloseTo(0, 3);
	});

	it('handles an empty attempt: every slot missed, no latency', () => {
		const result = scoreConformanceAgainstSpec([], arpSlots, context);
		expect(result.slots.every((s) => s.tier === 'missed')).toBe(true);
		expect(result.patternScore).toBe(0);
		expect(result.extraCount).toBe(0);
		expect(result.latencyCorrectionMs).toBe(0);
	});

	it('handles empty slots: everything played is extra', () => {
		const result = scoreConformanceAgainstSpec(perfectPlayed, [], context);
		expect(result.slots).toHaveLength(0);
		expect(result.patternScore).toBe(0);
		expect(result.extraCount).toBe(4);
	});

	it('falls back to chord tones as the scale set when scaleId is unknown', () => {
		const noScale: TrickContext = { ...context, scaleId: 'nope.not-a-scale' };
		const slots = [makeSlot([0, 1], [0])];
		// E is a Cmaj7 chord tone → in-scale under the fallback.
		const eResult = scoreConformanceAgainstSpec([makeDetected(64, 0)], slots, noScale);
		expect(eResult.slots[0].tier).toBe('in-scale');
		// D is diatonic to C major but NOT a Cmaj7 chord tone → out-of-scale.
		const dResult = scoreConformanceAgainstSpec([makeDetected(62, 0)], slots, noScale);
		expect(dResult.slots[0].tier).toBe('out-of-scale');
	});

	it('prefers matching a slot over skip-skip even for an out-of-scale note', () => {
		const slots = [makeSlot([0, 1], [0])];
		const result = scoreConformanceAgainstSpec([makeDetected(61, 0)], slots, context);
		expect(result.slots[0].tier).toBe('out-of-scale');
		expect(result.extraCount).toBe(0);
	});
});

describe('playedDegreeLabel', () => {
	it('labels degrees relative to the chord root', () => {
		expect(playedDegreeLabel(60, 'C')).toBe('1');
		expect(playedDegreeLabel(63, 'C')).toBe('b3');
		expect(playedDegreeLabel(66, 'C')).toBe('#4');
		expect(playedDegreeLabel(70, 'C')).toBe('b7');
	});

	it('is root-relative, not C-relative, and octave-insensitive', () => {
		// Db over A is 4 semitones up → '3'.
		expect(playedDegreeLabel(61, 'A')).toBe('3');
		expect(playedDegreeLabel(73, 'A')).toBe('3');
		// Bb over D is 8 semitones up → 'b6'.
		expect(playedDegreeLabel(70, 'D')).toBe('b6');
	});
});

describe('scoreConformanceAgainstSpecs', () => {
	// Second spec: D F A C on the same eighth grid — pc-disjoint from the
	// C E G B arp on three of four slots, so winners are unambiguous.
	const dfacSlots: TrickSlotSpec[] = [
		makeSlot([0, 1], [2], [5, 9, 0]),
		makeSlot([1, 8], [5], [2, 9, 0]),
		makeSlot([2, 8], [9], [2, 5, 0]),
		makeSlot([3, 8], [0], [2, 5, 9])
	];
	const variants = [
		{ style: 'x', slots: arpSlots },
		{ style: 'y', slots: dfacSlots }
	];

	it('returns the variant with the higher patternScore, tagged with its style', () => {
		const xWins = scoreConformanceAgainstSpecs(perfectPlayed, variants, context);
		expect(xWins.style).toBe('x');
		expect(xWins.patternScore).toBe(1);
		expect(xWins.slots).toHaveLength(4);

		const dfacPlayed = [
			makeDetected(62, 0),
			makeDetected(65, 0.25),
			makeDetected(69, 0.5),
			makeDetected(72, 0.75)
		];
		const yWins = scoreConformanceAgainstSpecs(dfacPlayed, variants, context);
		expect(yWins.style).toBe('y');
		expect(yWins.patternScore).toBe(1);
	});

	it('breaks patternScore ties toward the earliest variant', () => {
		const tied = scoreConformanceAgainstSpecs(
			perfectPlayed,
			[
				{ style: 'first', slots: arpSlots },
				{ style: 'second', slots: [...arpSlots] }
			],
			context
		);
		expect(tied.style).toBe('first');
	});

	it('handles an empty variants list gracefully (no style, all extras)', () => {
		const result = scoreConformanceAgainstSpecs(perfectPlayed, [], context);
		expect(result.style).toBeUndefined();
		expect(result.slots).toHaveLength(0);
		expect(result.patternScore).toBe(0);
		expect(result.extraCount).toBe(4);
	});

	it('leaves the single-spec result untagged', () => {
		const result = scoreConformanceAgainstSpec(perfectPlayed, arpSlots, context);
		expect(result.style).toBeUndefined();
	});
});
