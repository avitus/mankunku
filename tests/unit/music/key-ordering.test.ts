import { describe, it, expect } from 'vitest';
import {
	circleOfFifthsFrom,
	chromaticFrom,
	wholeTonePairFrom,
	shufflePitchClasses,
	unlockedStages,
	planLickKeys,
	type KeyOrderingStage
} from '$lib/music/key-ordering.ts';
import { circleOfFifths } from '$lib/music/keys.ts';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music.ts';
import { INSTRUMENTS } from '$lib/types/instruments.ts';

/** Every ordering must visit each of the 12 pitch classes exactly once. */
function assertPermutation(keys: PitchClass[]): void {
	expect(keys.length).toBe(12);
	expect(new Set(keys).size).toBe(12);
	for (const pc of PITCH_CLASSES) expect(keys).toContain(pc);
}

describe('circleOfFifthsFrom', () => {
	it('starting on C equals the canonical circleOfFifths()', () => {
		expect(circleOfFifthsFrom('C')).toEqual(circleOfFifths());
	});

	it('rotates so the start is first and preserves order', () => {
		const result = circleOfFifthsFrom('G');
		expect(result[0]).toBe('G');
		expect(result).toEqual(['G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C']);
	});

	it('produces a permutation for every possible start', () => {
		for (const start of PITCH_CLASSES) assertPermutation(circleOfFifthsFrom(start));
	});
});

describe('chromaticFrom', () => {
	it('rotates PITCH_CLASSES to start on the given key', () => {
		expect(chromaticFrom('Eb')).toEqual([
			'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D'
		]);
	});

	it('starting on C equals PITCH_CLASSES', () => {
		expect(chromaticFrom('C')).toEqual([...PITCH_CLASSES]);
	});

	it('produces a permutation for every possible start', () => {
		for (const start of PITCH_CLASSES) assertPermutation(chromaticFrom(start));
	});
});

describe('wholeTonePairFrom', () => {
	it('from C: whole-tone A then whole-tone B', () => {
		expect(wholeTonePairFrom('C')).toEqual([
			'C', 'D', 'E', 'F#', 'Ab', 'Bb',
			'Db', 'Eb', 'F', 'G', 'A', 'B'
		]);
	});

	it('each half is a pure whole-tone scale (all 2-semitone gaps internally)', () => {
		for (const start of PITCH_CLASSES) {
			const keys = wholeTonePairFrom(start);
			const firstHalf = keys.slice(0, 6).map((k) => PITCH_CLASSES.indexOf(k));
			const secondHalf = keys.slice(6).map((k) => PITCH_CLASSES.indexOf(k));
			for (let i = 1; i < 6; i++) {
				expect(((firstHalf[i] - firstHalf[i - 1]) + 12) % 12).toBe(2);
				expect(((secondHalf[i] - secondHalf[i - 1]) + 12) % 12).toBe(2);
			}
		}
	});

	it('produces a permutation for every possible start', () => {
		for (const start of PITCH_CLASSES) assertPermutation(wholeTonePairFrom(start));
	});
});

describe('shufflePitchClasses', () => {
	it('always returns a permutation of all 12 keys', () => {
		for (let i = 0; i < 50; i++) assertPermutation(shufflePitchClasses());
	});

	it('is deterministic when given a deterministic RNG', () => {
		const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05, 0.15];
		const mkRng = () => {
			let i = 0;
			return () => seq[i++ % seq.length];
		};
		expect(shufflePitchClasses(mkRng())).toEqual(shufflePitchClasses(mkRng()));
	});
});

describe('unlockedStages', () => {
	it('only Stage 0 at the minimum BPM', () => {
		expect(unlockedStages(60, 60)).toEqual<KeyOrderingStage[]>([0]);
	});

	it('unlocks Stage 1 at 1/3 of the way from minBpm to 150', () => {
		// range = 90, 1/3 = 30, threshold = 90
		expect(unlockedStages(89, 60)).toEqual<KeyOrderingStage[]>([0]);
		expect(unlockedStages(90, 60)).toEqual<KeyOrderingStage[]>([0, 1]);
	});

	it('unlocks Stage 2 at 2/3 of the way from minBpm to 150', () => {
		// range = 90, 2/3 = 60, threshold = 120
		expect(unlockedStages(119, 60)).toEqual<KeyOrderingStage[]>([0, 1]);
		expect(unlockedStages(120, 60)).toEqual<KeyOrderingStage[]>([0, 1, 2]);
	});

	it('unlocks Stages 3 and 4 at 150 BPM', () => {
		expect(unlockedStages(149, 60)).toEqual<KeyOrderingStage[]>([0, 1, 2]);
		expect(unlockedStages(150, 60)).toEqual<KeyOrderingStage[]>([0, 1, 2, 3, 4]);
		expect(unlockedStages(220, 60)).toEqual<KeyOrderingStage[]>([0, 1, 2, 3, 4]);
	});

	it('tempos below minBpm still produce only Stage 0', () => {
		expect(unlockedStages(40, 60)).toEqual<KeyOrderingStage[]>([0]);
	});

	it('minBpm >= 150 makes all linear stages unlock immediately at minBpm', () => {
		expect(unlockedStages(150, 150)).toEqual<KeyOrderingStage[]>([0, 1, 2, 3, 4]);
		expect(unlockedStages(170, 170)).toEqual<KeyOrderingStage[]>([0, 1, 2, 3, 4]);
	});
});

describe('planLickKeys — Stage 0 at minimum BPM', () => {
	const rngZero = () => 0;

	it('concert instrument: circle of 5ths starting on concert C', () => {
		const keys = planLickKeys({
			tempo: 60,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: rngZero
		});
		expect(keys).toEqual(circleOfFifths());
	});

	it('tenor sax: circle of 5ths starting on concert Bb (written C)', () => {
		const keys = planLickKeys({
			tempo: 60,
			minBpm: 60,
			instrument: INSTRUMENTS['tenor-sax'],
			rng: rngZero
		});
		expect(keys[0]).toBe('Bb');
		assertPermutation(keys);
		expect(keys).toEqual(circleOfFifthsFrom('Bb'));
	});

	it('alto sax: starts on concert Eb (written C)', () => {
		const keys = planLickKeys({
			tempo: 60,
			minBpm: 60,
			instrument: INSTRUMENTS['alto-sax'],
			rng: rngZero
		});
		expect(keys[0]).toBe('Eb');
	});

	it('Bb trumpet: starts on concert Bb (written C)', () => {
		const keys = planLickKeys({
			tempo: 60,
			minBpm: 60,
			instrument: INSTRUMENTS.trumpet,
			rng: rngZero
		});
		expect(keys[0]).toBe('Bb');
	});

	it('tempo below minBpm falls back to Stage 0', () => {
		const keys = planLickKeys({
			tempo: 40,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: rngZero
		});
		expect(keys).toEqual(circleOfFifths());
	});
});

describe('planLickKeys — stage dispatch via deterministic RNG', () => {
	/**
	 * Build an RNG that returns the supplied values in sequence, looping at end.
	 * Letting the test pick the stage by constructing a value that lands on the
	 * desired index of `unlockedStages(...)`.
	 */
	function rngFromSequence(values: number[]): () => number {
		let i = 0;
		return () => values[i++ % values.length];
	}

	it('Stage 1 (circle of 5ths from random key) at tempo=90, minBpm=60', () => {
		// unlockedStages = [0, 1] (length 2) → stage index 1 ⇒ rng value in [0.5, 1.0)
		// next rng used to pick start pitch; 0 ⇒ PITCH_CLASSES[0] = 'C'
		const keys = planLickKeys({
			tempo: 90,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: rngFromSequence([0.75, 0])
		});
		expect(keys).toEqual(circleOfFifthsFrom('C'));
	});

	it('Stage 2 (chromatic from random key) at tempo=120, minBpm=60', () => {
		// unlockedStages = [0, 1, 2] (length 3) → stage index 2 ⇒ rng in [2/3, 1.0)
		// start pick: value 0 ⇒ 'C'
		const keys = planLickKeys({
			tempo: 120,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: rngFromSequence([0.9, 0])
		});
		expect(keys).toEqual(chromaticFrom('C'));
	});

	it('Stage 3 (whole-tone halves) at tempo=150, minBpm=60', () => {
		// unlockedStages = [0, 1, 2, 3, 4] (length 5) → stage index 3 ⇒ rng in [0.6, 0.8)
		// start pick: 0 ⇒ 'C'
		const keys = planLickKeys({
			tempo: 150,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: rngFromSequence([0.7, 0])
		});
		expect(keys).toEqual(wholeTonePairFrom('C'));
	});

	it('Stage 4 (full shuffle) at tempo=150, minBpm=60', () => {
		// unlockedStages length 5 → stage index 4 ⇒ rng value 0.999 picks index 4.
		// With rng=0.999 on every subsequent Fisher-Yates call, each iteration
		// picks j=i (the current index), so no swap occurs and the result
		// equals PITCH_CLASSES unchanged — which lets us distinguish this
		// stage from Stage 3 (whole-tone halves from pickRandom).
		const keys = planLickKeys({
			tempo: 150,
			minBpm: 60,
			instrument: INSTRUMENTS.concert,
			rng: () => 0.999
		});
		assertPermutation(keys);
		expect(keys).toEqual([...PITCH_CLASSES]);
	});
});

describe('planLickKeys — permutation invariant', () => {
	it('every draw is a permutation across a wide range of tempos', () => {
		for (let tempo = 40; tempo <= 220; tempo += 10) {
			for (let i = 0; i < 20; i++) {
				const keys = planLickKeys({
					tempo,
					minBpm: 60,
					instrument: INSTRUMENTS['tenor-sax']
				});
				assertPermutation(keys);
			}
		}
	});
});
