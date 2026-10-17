/**
 * Staged key ordering for lick practice sessions. Two phases:
 *
 * 1. **Ramp-up** — `planUnlockedKeys` is used while a lick has fewer than 12
 *    keys earned. It returns the first N keys of a ramp that climbs the key
 *    signatures: the entry key first, then every other key by how many
 *    sharps or flats the player reads in it — fewest first, the sharp key
 *    before the flat key with the same count — so each unlock adds the
 *    easiest key left. The unlock cadence itself (when N grows) lives in
 *    `lick-practice-store` via `shouldUnlockNextKey`.
 *
 * 2. **Staged variety** — `planLickKeys` runs once the lick has earned all
 *    12 keys. The ordering is chosen based on the lick's current tempo:
 *    slow tempos get a friendly, predictable circle-of-5ths ordering from
 *    the player's written C; as tempo rises toward 150 BPM, harder
 *    orderings unlock linearly, and above 150 a fully random shuffle joins
 *    the pool.
 *
 * `planLickKeys` always returns a permutation of all 12 `PitchClass`
 * values; `planUnlockedKeys` returns the first N keys of the ramp until
 * the lick has earned the full set, after which callers switch to
 * `planLickKeys`.
 */
import type { Mode, Phrase, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import { PITCH_CLASSES } from '$lib/types/music';
import { circleOfFifths, circleOfFourths, keySignatureAccidentals, relativeMajor } from '$lib/music/keys';
import { lickMode } from '$lib/music/mode';
import { concertKeyToWritten, writtenKeyToConcert } from '$lib/music/transposition';

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

/** Circle of 4ths starting on `start` instead of C. */
export function circleOfFourthsFrom(start: PitchClass): PitchClass[] {
	return rotateTo(circleOfFourths(), start);
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
 * The full circle: every pitch class is a key, so twelve is the ceiling on
 * any per-item unlocked-key count. Lives here rather than in the persistence
 * layer because it is a fact about music, not about storage — the stores that
 * clamp their unlock counters import it from this module.
 */
export const MAX_UNLOCKED_KEYS = 12;

/**
 * Where a lick's unlock ramp starts and how its keys are read. The ramp is a
 * pure function of these three: the entry key opens it, the mode decides
 * whether a tonic carries its own signature or its relative major's, and the
 * instrument decides which signature the player actually reads.
 */
export interface UnlockRamp {
	/** Concert-pitch tonic the lick was entered in — always the first key unlocked. */
	entryKey: PitchClass;
	/** How the tonic reads: a minor key carries its relative major's signature. */
	mode: Mode;
	/** The player's instrument: accidentals are counted in written pitch, the key on the page. */
	instrument: InstrumentConfig;
}

/** A lick's unlock ramp: its tonic, its mode as the rest of the app resolves it, and the player's instrument. */
export function lickUnlockRamp(
	phrase: Pick<Phrase, 'key' | 'harmony' | 'mode'>,
	instrument: InstrumentConfig
): UnlockRamp {
	return { entryKey: phrase.key, mode: lickMode(phrase), instrument };
}

/**
 * The key signature the player reads for a concert tonic: sharps positive,
 * flats negative. A minor tonic is read through its relative major (G minor
 * → Bb → two flats); a transposing instrument reads its written key (concert
 * F minor on tenor is written G minor).
 */
export function writtenSignature(key: PitchClass, mode: Mode, instrument: InstrumentConfig): number {
	const written = concertKeyToWritten(key, instrument);
	return keySignatureAccidentals(mode === 'minor' ? relativeMajor(written) : written);
}

/**
 * Build the gradually-unlocked key set for a lick that hasn't reached its
 * full 12-key range yet. The entry key comes first; every other key follows
 * in order of the signature the player reads (`writtenSignature`), fewest
 * accidentals first, and the sharp key ahead of the flat key with the same
 * count. A C major lick on a concert instrument yields C, G, F, D, Bb, A,
 * Eb, E, Ab, B, Db, F#; a G minor lick yields G, A, E, D, B, F#, C, Db, F,
 * Ab, Bb, Eb. Once `unlockedCount` reaches 12, callers should fall back to
 * `planLickKeys` for staged variety.
 */
export function planUnlockedKeys(ramp: UnlockRamp, unlockedCount: number): PitchClass[] {
	const clamped = Math.min(MAX_UNLOCKED_KEYS, Math.max(1, unlockedCount));
	const rest = PITCH_CLASSES.filter((key) => key !== ramp.entryKey)
		.map((key) => ({ key, signature: writtenSignature(key, ramp.mode, ramp.instrument) }))
		// Fewest accidentals first; at a tie the positive (sharp) signature wins.
		.sort((a, b) => Math.abs(a.signature) - Math.abs(b.signature) || b.signature - a.signature)
		.map((entry) => entry.key);
	return [ramp.entryKey, ...rest].slice(0, clamped);
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