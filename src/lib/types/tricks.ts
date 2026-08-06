/**
 * Trick (melodic-device) domain model.
 *
 * A trick is a parameterized melodic formula — e.g. enclosures or triad
 * pairs — practiced for *fluency* rather than exact reproduction. A played
 * attempt is judged by how well it conforms to the formula (scoreConformance,
 * the primary contract); preview phrases are disposable examples built on
 * demand (generateExample, the secondary contract).
 *
 * Progress is keyed by the stable composite variant key
 * `${trickId}:${normalizeParameterSignature(params)}`, never by the id of a
 * generated preview phrase.
 */

import type { ChordQuality, Fraction, Phrase, PhraseCategory, PitchClass } from './music';
import type { DetectedNote } from './audio';
// Type-only, so the tricks ↔ lick-practice type cycle is erased at runtime.
import type { ChordProgressionType } from './lick-practice';

/** One configurable parameter of a trick and its allowed values. */
export interface TrickParameterDefinition {
	/** Machine name, e.g. 'noteCount', 'shape', 'targetTone', 'beatPlacement' */
	name: string;
	/** Human label for the setup UI */
	label: string;
	/** Allowed values in display order */
	values: string[];
	/** Optional human labels per value (falls back to the raw value) */
	valueLabels?: Record<string, string>;
}

/** A concrete parameter selection: parameter name → chosen value. */
export type TrickParameters = Record<string, string>;

/**
 * The harmonic/performance context a trick attempt is judged in.
 * All pitch content is concert pitch.
 */
export interface TrickContext {
	chordRoot: PitchClass;
	chordQuality: ChordQuality;
	/** References a ScaleDefinition.id; conventionally rooted at chordRoot */
	scaleId: string;
	/** Concert-pitch target key of the practice window */
	key: PitchClass;
	timeSignature: [number, number];
	/** Player-facing difficulty level 1-100 (drives getProfile bounds) */
	level: number;
	/** Playback tempo in BPM — needed to place expected slots in seconds */
	tempo: number;
	/** Swing ratio (0.5 = straight); defaults to 0.5 when omitted */
	swing?: number;
	/**
	 * Which playing style generateExample should demonstrate, from the trick's
	 * exampleStyles. Device-interpreted; unknown or absent ⇒ device default.
	 * Scoring ignores it (all styles are always accepted).
	 */
	exampleStyle?: string;
}

/**
 * One expected slot of a trick formula: where a note should land and which
 * pitch classes satisfy it. Produced by device modules, consumed by the
 * conformance engine and the example generator.
 */
export interface TrickSlotSpec {
	/** Beat offset from phrase start, as a fraction of a whole note (matches Note.offset) */
	offset: Fraction;
	/** Duration as a fraction of a whole note (matches Note.duration) */
	duration: Fraction;
	/** Absolute concert pitch classes (0-11) that satisfy this slot exactly */
	exactPcs: number[];
	/** Pitch classes acceptable as in-pattern-but-off (e.g. the mirrored approach) */
	patternPcs?: number[];
	/**
	 * The single pitch class the example generator should realize for this
	 * slot. Scoring ignores it. Defaults to exactPcs[0].
	 */
	generatePc?: number;
	/** Diagnostic role label, e.g. 'target', 'approach-above', 'chromatic-below', 'triad-a' */
	role: string;
}

/** Conformance tier for one expected slot, best → worst. */
export type SlotConformanceTier = 'exact' | 'in-pattern' | 'in-scale' | 'out-of-scale' | 'missed';

export interface SlotConformanceResult {
	slotIndex: number;
	role: string;
	/** Scale degree label of the played note relative to the chord root (null if missed) */
	playedDegree: string | null;
	playedMidi: number | null;
	tier: SlotConformanceTier;
	/** Partial credit 0-1 for this slot */
	credit: number;
	/** Signed onset error in ms after latency correction (null if missed) */
	onsetErrorMs: number | null;
}

/** Result of judging one played attempt against a trick formula. */
export interface ConformanceResult {
	slots: SlotConformanceResult[];
	/** Mean slot credit 0-1 — the pattern/pitch dimension of the Fluency score */
	patternScore: number;
	/** Played notes the aligner matched to no expected slot */
	extraCount: number;
	/** Latency correction applied before per-slot timing, in ms */
	latencyCorrectionMs: number;
	/** Winning spec-variant name when judged best-of several styles (multi-spec devices only) */
	style?: string;
}

/** A melodic device with configurable parameters and the two contracts. */
export interface Trick {
	id: string;
	name: string;
	description: string;
	category: PhraseCategory;
	tags: string[];
	/** Chord qualities this trick can be practiced over */
	compatibleQualities: ChordQuality[];
	parameters: TrickParameterDefinition[];
	/**
	 * Demo styles in preview rotation order, when the device accepts several
	 * playing styles. Absent for single-style devices. Values are hints for
	 * TrickContext.exampleStyle; they are NOT parameters and never enter the
	 * variant key.
	 */
	exampleStyles?: readonly string[];
	/**
	 * Optional: the one-chord vamp a parameter selection should be drilled
	 * over (e.g. altered triad pairs over the dominant vamp). Omitted — or
	 * absent entirely — means the session default, 'major-vamp'.
	 */
	practiceBed?(parameters: TrickParameters): ChordProgressionType;
	/**
	 * Optional: chord qualities the selected parameters belong on, most
	 * characteristic first. When present, tune-practice suggestions align
	 * the variant to a progression chord matching one of these qualities
	 * (via `resolveQualityRoleEntry`) and skip progressions with none —
	 * refining the trick-wide `compatibleQualities`, which stays the coarse
	 * documentation-level union. Absent → suggestions gate on the trick's
	 * category registration alone.
	 */
	compatibleQualitiesFor?(parameters: TrickParameters): ChordQuality[];
	/**
	 * PRIMARY: judge a played attempt against the formula for the selected
	 * parameters. `played` is the recorded, segmented note stream.
	 */
	scoreConformance(
		played: DetectedNote[],
		parameters: TrickParameters,
		context: TrickContext
	): ConformanceResult;
	/**
	 * SECONDARY: build one preview Phrase for the selected parameters, or
	 * null when realization/validation fails for this context.
	 */
	generateExample(parameters: TrickParameters, context: TrickContext): Phrase | null;
}

/**
 * Stable, order-independent signature of a parameter selection, for use in
 * progress keys: keys sorted lexically, joined as `name=value` with ','.
 */
export function normalizeParameterSignature(params: TrickParameters): string {
	return Object.keys(params)
		.sort()
		.map((name) => `${name}=${params[name]}`)
		.join(',');
}

/** Composite progress key for one trick parameter variant. */
export function trickVariantKey(trickId: string, params: TrickParameters): string {
	return `${trickId}:${normalizeParameterSignature(params)}`;
}

// ─── Practice progress (mirrors the per-key shapes in lick-practice.ts) ───

export interface TrickPracticeKeyProgress {
	currentTempo: number;
	lastPracticedAt: number;
	passCount: number;
}

/**
 * Per-variant, per-key progress, keyed by the composite
 * `${trickId}:${normalizeParameterSignature(params)}` variant key.
 */
export type TrickPracticeProgress = Record<
	string,
	Partial<Record<PitchClass, TrickPracticeKeyProgress>>
>;

/** One sample in a variant's practice-progress time series. */
export interface TrickProgressPoint {
	/** Wall-clock timestamp (ms) of the sample. Also the per-variant dedupe key. */
	t: number;
	/** Session tempo (BPM) at this point. */
	bpm: number;
	/** Unlocked-key count (1-12) at this point. */
	keys: number;
}

/** Per-variant append-only progress time series, keyed by composite variant key. */
export type TrickProgressHistory = Record<string, TrickProgressPoint[]>;
