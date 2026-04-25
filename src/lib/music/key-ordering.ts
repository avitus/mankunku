/**
 * Staged key ordering for lick practice sessions.
 *
 * The order in which a lick cycles through all 12 keys is chosen based on the
 * lick's current tempo. Slow tempos get a friendly, predictable circle-of-5ths
 * ordering from the player's written C; as tempo rises toward 150 BPM, harder
 * orderings unlock linearly, and above 150 a fully random shuffle joins the pool.
 *
 * The returned array is always a permutation of all 12 `PitchClass` values.
 */
import type { PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
import { circleOfFifths } from '$lib/music/keys';
import { writtenKeyToConcert } from '$lib/music/transposition';

/** Rotate `arr` so that `start` sits at index 0. Returns a new array. */
function rotateTo<T>(arr: readonly T[], start: T): T[] {
	const idx = arr.indexOf(start);
	if (idx < 0) throw new Error(`Key ${String(start)} not found in ordering`);
	return [...arr.slice(idx), ...arr.slice(0, idx)];
}

/** Circle of 5ths starting on `start` instead of C. */
export function circleOfFifthsFrom(start: PitchClass): PitchClass[] {
	return rotateTo(circleOfFifths(), start);
}

/** Chromatic (semitone-step) ordering starting on `start`. */
export function chromaticFrom(start: PitchClass): PitchClass[] {
	return rotateTo(PITCH_CLASSES, start);
}

/**
 * Whole-tone halves starting on `start`: first the 6 keys of the whole-tone
 * scale containing `start`, then the other 6 keys of the complementary
 * whole-tone scale.
 */
export function wholeTonePairFrom(start: PitchClass): PitchClass[] {
	const startIdx = PITCH_CLASSES.indexOf(start);
	if (startIdx < 0) throw new Error(`Key ${String(start)} not found in PITCH_CLASSES`);
	const keys: PitchClass[] = [];
	// Whole-tone scale containing `start`
	for (let i = 0; i < 6; i++) keys.push(PITCH_CLASSES[(startIdx + 2 * i) % 12]);
	// Complementary whole-tone scale, starting a semitone above `start`
	for (let i = 0; i < 6; i++) keys.push(PITCH_CLASSES[(startIdx + 1 + 2 * i) % 12]);
	return keys;
}

/** Fisher–Yates shuffle, parameterized by an RNG for determinism in tests. */
export function shufflePitchClasses(rng: () => number = Math.random): PitchClass[] {
	const result = [...PITCH_CLASSES];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

/** Stage identifier for the selected ordering. Exported for tests. */
export type KeyOrderingStage = 0 | 1 | 2 | 3 | 4;

/**
 * Return the stages unlocked at `tempo` given the user's minimum BPM anchor.
 * Stage 0 is always unlocked; Stages 1–2 unlock linearly between `minBpm` and
 * 150; Stages 3 & 4 both unlock at 150 BPM.
 */
export function unlockedStages(tempo: number, minBpm: number): KeyOrderingStage[] {
	const range = Math.max(0, 150 - minBpm);
	const unlockStage1 = minBpm + range / 3;
	const unlockStage2 = minBpm + (2 * range) / 3;
	const stages: KeyOrderingStage[] = [0];
	if (tempo >= unlockStage1) stages.push(1);
	if (tempo >= unlockStage2) stages.push(2);
	if (tempo >= Math.max(150, unlockStage2)) stages.push(3, 4);
	return stages;
}

/** Pick a random element from `arr` using `rng`. */
function pickRandom<T>(arr: readonly T[], rng: () => number): T {
	return arr[Math.floor(rng() * arr.length)];
}

export interface PlanLickKeysArgs {
	/** The per-lick tempo the session will run at. */
	tempo: number;
	/** The minimum BPM anchor (`NEW_LICK_DEFAULT_TEMPO`). */
	minBpm: number;
	/** Player's instrument; used to resolve "written C" for Stage 0. */
	instrument: InstrumentConfig;
	/** Override for deterministic tests; defaults to `Math.random`. */
	rng?: () => number;
}

/**
 * Build the gradually-unlocked key set for a lick that hasn't reached its
 * full 12-key range yet. Returns the first `unlockedCount` keys of the
 * circle of fifths starting at `entryKey` — adjacent keys in this sequence
 * share 6 of 7 scale tones, so growing the set one step at a time stays
 * friendly. Once `unlockedCount` reaches 12, callers should fall back to
 * `planLickKeys` for staged variety.
 */
export function planUnlockedKeys(
	entryKey: PitchClass,
	unlockedCount: number
): PitchClass[] {
	const clamped = Math.min(12, Math.max(1, unlockedCount));
	return circleOfFifthsFrom(entryKey).slice(0, clamped);
}

/**
 * Build the 12-key order for a single lick. Picks a stage uniformly at random
 * from the set unlocked at `tempo`, then draws that stage's ordering.
 */
export function planLickKeys(args: PlanLickKeysArgs): PitchClass[] {
	const { tempo, minBpm, instrument, rng = Math.random } = args;
	const stages = unlockedStages(tempo, minBpm);
	const stage = pickRandom(stages, rng);

	switch (stage) {
		case 0:
			return circleOfFifthsFrom(writtenKeyToConcert('C', instrument));
		case 1:
			return circleOfFifthsFrom(pickRandom(PITCH_CLASSES, rng));
		case 2:
			return chromaticFrom(pickRandom(PITCH_CLASSES, rng));
		case 3:
			return wholeTonePairFrom(pickRandom(PITCH_CLASSES, rng));
		case 4:
			return shufflePitchClasses(rng);
	}
}