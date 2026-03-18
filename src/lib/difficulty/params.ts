import type { PitchClass, ScaleFamily } from '$lib/types/music.ts';

/**
 * Difficulty level parameters.
 * Levels 1-7 ship at MVP; 8-10 deferred.
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

export function getProfile(level: number): DifficultyProfile {
	const profile = DIFFICULTY_PROFILES.find((p) => p.level === level);
	if (!profile) throw new Error(`Invalid difficulty level: ${level}`);
	return profile;
}
