import type { PitchClass, ScaleFamily } from '$lib/types/music.ts';

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
	/** Tempo range [min, max] */
	tempoRange: [number, number];
	/** Available keys */
	keys: PitchClass[];
}

const EASY_KEYS: PitchClass[] = ['C', 'F', 'G'];
const MEDIUM_KEYS: PitchClass[] = ['C', 'D', 'F', 'G', 'Bb'];
const SEVEN_KEYS: PitchClass[] = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];
const ALL_KEYS: PitchClass[] = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

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
 * Get the difficulty profile for a given level.
 * Accepts either a content tier (1-10) directly or a player level (1-100)
 * which is mapped to a content tier.
 */
export function getProfile(level: number): DifficultyProfile {
	// If the level is > 10, map it to a content tier
	const tier = level > 10 ? levelToContentTier(level) : level;
	const profile = DIFFICULTY_PROFILES.find((p) => p.level === tier);
	if (!profile) throw new Error(`Invalid difficulty level: ${level} (tier ${tier})`);
	return profile;
}
