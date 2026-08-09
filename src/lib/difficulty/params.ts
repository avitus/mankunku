import type { PitchClass, ScaleFamily } from '$lib/types/music';

/**
 * Difficulty content profiles.
 *
 * There are 10 content tiers that define what musical elements are available.
 * The player-facing level system spans 1-100; levels are mapped to content
 * tiers via levelToContentTier().
 */
export interface DifficultyProfile {
	level: number;
	name: string;
	/** Allowed scale families */
	scaleTypes: ScaleFamily[];
	/** Max interval in semitones */
	maxInterval: number;
	/** Allowed rhythm subdivisions */
	rhythmTypes: ('whole' | 'half' | 'quarter' | 'eighth' | 'triplet' | 'sixteenth')[];
	/** Whether swing is applied */
	swing: boolean;
	/** Whether syncopation is used */
	syncopation: boolean;
	/** Bars per phrase range [min, max] */
	barsRange: [number, number];
	/**
	 * Most pitched notes a phrase at this tier may contain.
	 *
	 * Length is a difficulty dimension in its own right — playing back a
	 * 13-note line by ear is a memory task, however diatonic and slow the
	 * notes are — and it is the one dimension nothing else here bounds
	 * (`barsRange` limits duration, not density). Curated ratings are checked
	 * against these ceilings in tests/unit/data/difficulty-calibration.test.ts.
	 *
	 * Calibrated against the licks whose stored level was produced by
	 * `calculateDifficulty` rather than assigned by hand: their longest lines
	 * per tier run 2, 4, 9, 9, 11, 17, 16, 13, so these ceilings sit at or just
	 * above the catalogue the app itself rated.
	 */
	maxNotes: number;
	/** Tempo range [min, max] */
	tempoRange: [number, number];
	/** Available keys */
	keys: PitchClass[];
}

const EASY_KEYS: PitchClass[] = ['C', 'F', 'G'];
const MEDIUM_KEYS: PitchClass[] = ['C', 'D', 'F', 'G', 'Bb'];
const SEVEN_KEYS: PitchClass[] = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];
const ALL_KEYS: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const DIFFICULTY_PROFILES: DifficultyProfile[] = [
	{
		level: 1,
		name: 'Roots & 5ths',
		scaleTypes: ['major'],
		maxInterval: 4,
		rhythmTypes: ['quarter'],
		swing: false,
		syncopation: false,
		barsRange: [1, 1],
		maxNotes: 5,
		tempoRange: [60, 80],
		keys: EASY_KEYS
	},
	{
		level: 2,
		name: 'Full Pentatonic',
		scaleTypes: ['major', 'pentatonic'],
		maxInterval: 5,
		rhythmTypes: ['quarter'],
		swing: false,
		syncopation: false,
		barsRange: [1, 1],
		maxNotes: 7,
		tempoRange: [60, 90],
		keys: MEDIUM_KEYS
	},
	{
		level: 3,
		name: 'Swing 8ths',
		scaleTypes: ['major', 'pentatonic'],
		maxInterval: 7,
		rhythmTypes: ['quarter', 'eighth'],
		swing: true,
		syncopation: false,
		barsRange: [1, 2],
		maxNotes: 9,
		tempoRange: [70, 100],
		keys: SEVEN_KEYS
	},
	{
		level: 4,
		name: 'Diatonic Lines',
		scaleTypes: ['major', 'pentatonic', 'blues'],
		maxInterval: 7,
		rhythmTypes: ['quarter', 'eighth'],
		swing: true,
		syncopation: true,
		barsRange: [1, 2],
		maxNotes: 11,
		tempoRange: [80, 120],
		keys: ALL_KEYS
	},
	{
		level: 5,
		name: 'Approach Notes',
		scaleTypes: ['major', 'pentatonic', 'blues', 'bebop'],
		maxInterval: 8,
		rhythmTypes: ['quarter', 'eighth', 'triplet'],
		swing: true,
		syncopation: true,
		barsRange: [2, 2],
		maxNotes: 13,
		tempoRange: [90, 140],
		keys: ALL_KEYS
	},
	{
		level: 6,
		name: 'Enclosures',
		scaleTypes: ['major', 'pentatonic', 'blues', 'bebop', 'melodic-minor'],
		maxInterval: 12,
		rhythmTypes: ['quarter', 'eighth', 'triplet'],
		swing: true,
		syncopation: true,
		barsRange: [2, 2],
		maxNotes: 17,
		tempoRange: [100, 160],
		keys: ALL_KEYS
	},
	{
		level: 7,
		name: 'Bebop Lines',
		scaleTypes: ['major', 'pentatonic', 'blues', 'bebop', 'melodic-minor', 'harmonic-minor'],
		maxInterval: 14,
		rhythmTypes: ['quarter', 'eighth', 'triplet', 'sixteenth'],
		swing: true,
		syncopation: true,
		barsRange: [2, 4],
		maxNotes: 21,
		tempoRange: [120, 180],
		keys: ALL_KEYS
	},
	// Levels 8-10 deferred — content needed
	{
		level: 8,
		name: 'Altered Harmony',
		scaleTypes: ['major', 'melodic-minor', 'harmonic-minor', 'symmetric', 'pentatonic', 'blues', 'bebop'],
		maxInterval: 16,
		rhythmTypes: ['quarter', 'eighth', 'triplet', 'sixteenth'],
		swing: true,
		syncopation: true,
		barsRange: [2, 4],
		maxNotes: 25,
		tempoRange: [140, 200],
		keys: ALL_KEYS
	},
	{
		level: 9,
		name: 'Complex Rhythm',
		scaleTypes: ['major', 'melodic-minor', 'harmonic-minor', 'symmetric', 'pentatonic', 'blues', 'bebop'],
		maxInterval: 19,
		rhythmTypes: ['quarter', 'eighth', 'triplet', 'sixteenth'],
		swing: true,
		syncopation: true,
		barsRange: [2, 4],
		maxNotes: 30,
		tempoRange: [160, 240],
		keys: ALL_KEYS
	},
	{
		level: 10,
		name: 'No Limits',
		scaleTypes: ['major', 'melodic-minor', 'harmonic-minor', 'symmetric', 'pentatonic', 'blues', 'bebop'],
		maxInterval: 24,
		rhythmTypes: ['whole', 'half', 'quarter', 'eighth', 'triplet', 'sixteenth'],
		swing: true,
		syncopation: true,
		barsRange: [4, 4],
		maxNotes: Number.POSITIVE_INFINITY, // 'No Limits' — length is unbounded here
		tempoRange: [180, 300],
		keys: ALL_KEYS
	}
];

/**
 * Map a player-facing level (1-100) to a content tier (1-10).
 *
 * Tiers are spread across the 1-100 range:
 *   Level  1-5  → Tier 1
 *   Level  6-12 → Tier 2
 *   Level 13-20 → Tier 3
 *   Level 21-30 → Tier 4
 *   Level 31-40 → Tier 5
 *   Level 41-52 → Tier 6
 *   Level 53-65 → Tier 7
 *   Level 66-78 → Tier 8
 *   Level 79-90 → Tier 9
 *   Level 91-100→ Tier 10
 */
export function levelToContentTier(level: number): number {
	if (level <= 5) return 1;
	if (level <= 12) return 2;
	if (level <= 20) return 3;
	if (level <= 30) return 4;
	if (level <= 40) return 5;
	if (level <= 52) return 6;
	if (level <= 65) return 7;
	if (level <= 78) return 8;
	if (level <= 90) return 9;
	return 10;
}

/**
 * Get the profile for a CONTENT TIER (1-10).
 *
 * Use this only when the caller genuinely holds a tier index. If the number
 * came from a player-facing control, stored `difficulty.level`, or anything
 * else on the 1-100 scale, use getProfileForLevel() instead.
 *
 * Throws on anything outside 1-10 rather than guessing: the two scales overlap
 * on 1-10, so a single function that inferred the scale from the argument's
 * magnitude inverted the bottom tenth of the 1-100 range — a player level of
 * 10 selected tier 10 ("No Limits"), the hardest content in the app.
 */
export function getProfileForTier(tier: number): DifficultyProfile {
	const profile = Number.isInteger(tier)
		? DIFFICULTY_PROFILES.find((p) => p.level === tier)
		: undefined;
	if (!profile) throw new Error(`Invalid content tier: ${tier} (expected an integer 1-10)`);
	return profile;
}

/**
 * Get the profile for a PLAYER LEVEL (1-100), via levelToContentTier().
 *
 * Total over the whole real line: levels are clamped into 1-100 first, mirroring
 * difficultyBand() in difficulty/display.ts so the name shown next to a control
 * and the content it selects can never disagree about an out-of-range value.
 * Non-finite input falls to tier 1 — every comparison against NaN is false, so
 * letting it reach levelToContentTier() would fall through to tier 10.
 */
export function getProfileForLevel(level: number): DifficultyProfile {
	const clamped = Number.isFinite(level) ? Math.max(1, Math.min(100, Math.round(level))) : 1;
	return getProfileForTier(levelToContentTier(clamped));
}

/**
 * Lowest player level (1-100) in each content tier, derived from
 * levelToContentTier() so re-tuned tier boundaries track automatically.
 * Index = tier - 1.
 */
const TIER_FLOOR_LEVELS: number[] = (() => {
	const floors: number[] = [];
	for (let level = 1; level <= 100; level++) {
		const tier = levelToContentTier(level);
		if (floors[tier - 1] === undefined) floors[tier - 1] = level;
	}
	return floors;
})();

/** Profiles in ascending tier order — this filter runs per lick, so sort once. */
const PROFILES_BY_TIER: DifficultyProfile[] = [...DIFFICULTY_PROFILES].sort(
	(a, b) => a.level - b.level
);

/**
 * Lowest player level whose content tier admits a phrase of `noteCount`
 * pitched notes.
 *
 * This is the length half of the difficulty rubric: a level-gated pool must
 * not serve a line longer than its tier's `maxNotes`, no matter how simple
 * the notes are. Monotonic in `noteCount` by construction, since `maxNotes`
 * never decreases as tiers rise.
 */
export function noteCountFloorLevel(noteCount: number): number {
	for (const profile of PROFILES_BY_TIER) {
		if (noteCount <= profile.maxNotes) return TIER_FLOOR_LEVELS[profile.level - 1];
	}
	// Unreachable while the top tier is unbounded; falls back to its floor.
	return TIER_FLOOR_LEVELS[PROFILES_BY_TIER[PROFILES_BY_TIER.length - 1].level - 1];
}
