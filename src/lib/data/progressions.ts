import type { HarmonicSegment, PitchClass } from '$lib/types/music.ts';
import type { ChordProgressionType } from '$lib/types/lick-practice.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';

export interface ProgressionTemplate {
	type: ChordProgressionType;
	name: string;
	shortName: string;
	harmony: HarmonicSegment[];
	bars: number;
}

const II_V_I_MAJOR_SHORT: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

const II_V_I_MAJOR_LONG: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [2, 1],
		duration: [2, 1]
	}
];

const II_V_I_MINOR_SHORT: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'harmonic-minor.locrian',
		startOffset: [0, 1],
		duration: [1, 2]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 2],
		duration: [1, 2]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [1, 1],
		duration: [1, 1]
	}
];

const II_V_I_MINOR_LONG: HarmonicSegment[] = [
	{
		chord: { root: 'D', quality: 'min7b5' },
		scaleId: 'harmonic-minor.locrian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7alt' },
		scaleId: 'melodic-minor.altered',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'C', quality: 'min7' },
		scaleId: 'major.aeolian',
		startOffset: [2, 1],
		duration: [2, 1]
	}
];

const TURNAROUND: HarmonicSegment[] = [
	{
		chord: { root: 'C', quality: 'maj7' },
		scaleId: 'major.ionian',
		startOffset: [0, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'A', quality: '7' },
		scaleId: 'melodic-minor.mixolydian-b6',
		startOffset: [1, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'D', quality: 'min7' },
		scaleId: 'major.dorian',
		startOffset: [2, 1],
		duration: [1, 1]
	},
	{
		chord: { root: 'G', quality: '7' },
		scaleId: 'major.mixolydian',
		startOffset: [3, 1],
		duration: [1, 1]
	}
];

const BLUES: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [0, 1], duration: [4, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.minor', startOffset: [4, 1], duration: [2, 1] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [6, 1], duration: [2, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [8, 1], duration: [1, 1] },
	{ chord: { root: 'F', quality: '7' }, scaleId: 'blues.minor', startOffset: [9, 1], duration: [1, 1] },
	{ chord: { root: 'C', quality: '7' }, scaleId: 'blues.minor', startOffset: [10, 1], duration: [1, 1] },
	{ chord: { root: 'G', quality: '7' }, scaleId: 'major.mixolydian', startOffset: [11, 1], duration: [1, 1] }
];

export const PROGRESSION_TEMPLATES: Record<ChordProgressionType, ProgressionTemplate> = {
	'ii-V-I-major': {
		type: 'ii-V-I-major',
		name: 'Short ii-V-I (Maj)',
		shortName: 'Short ii-V-I (Maj)',
		harmony: II_V_I_MAJOR_SHORT,
		bars: 2
	},
	'ii-V-I-minor': {
		type: 'ii-V-I-minor',
		name: 'Short ii-V-I (Min)',
		shortName: 'Short ii-V-I (Min)',
		harmony: II_V_I_MINOR_SHORT,
		bars: 2
	},
	'ii-V-I-major-long': {
		type: 'ii-V-I-major-long',
		name: 'Long ii-V-I (Maj)',
		shortName: 'Long ii-V-I (Maj)',
		harmony: II_V_I_MAJOR_LONG,
		bars: 4
	},
	'ii-V-I-minor-long': {
		type: 'ii-V-I-minor-long',
		name: 'Long ii-V-I (Min)',
		shortName: 'Long ii-V-I (Min)',
		harmony: II_V_I_MINOR_LONG,
		bars: 4
	},
	turnaround: {
		type: 'turnaround',
		name: 'Turnaround (I-VI-ii-V)',
		shortName: 'Turnaround',
		harmony: TURNAROUND,
		bars: 4
	},
	blues: {
		type: 'blues',
		name: '12-Bar Blues',
		shortName: 'Blues',
		harmony: BLUES,
		bars: 12
	}
};

/**
 * Transpose a progression template to a target key.
 * All templates are defined in C — this shifts every chord root.
 */
export function transposeProgression(
	harmony: HarmonicSegment[],
	targetKey: PitchClass
): HarmonicSegment[] {
	const semitones = PITCH_CLASSES.indexOf(targetKey);
	if (semitones === 0) return harmony;

	const transposePC = (pc: PitchClass): PitchClass =>
		PITCH_CLASSES[(PITCH_CLASSES.indexOf(pc) + semitones) % 12];

	return harmony.map(seg => ({
		...seg,
		chord: {
			...seg.chord,
			root: transposePC(seg.chord.root),
			bass: seg.chord.bass ? transposePC(seg.chord.bass) : undefined
		}
	}));
}

/** Categories of licks compatible with each progression type */
export const PROGRESSION_LICK_CATEGORIES: Record<ChordProgressionType, string[]> = {
	'ii-V-I-major': ['ii-V-I-major', 'short-ii-V-I-major'],
	'ii-V-I-minor': ['ii-V-I-minor', 'short-ii-V-I-minor'],
	'ii-V-I-major-long': ['ii-V-I-major', 'long-ii-V-I-major'],
	'ii-V-I-minor-long': ['ii-V-I-minor', 'long-ii-V-I-minor'],
	turnaround: ['turnarounds', 'ii-V-I-major', 'rhythm-changes'],
	blues: ['blues']
};
