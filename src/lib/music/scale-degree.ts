import type { PitchClass } from '$lib/types/music';
import { pitchClassInterval } from './transposition';

/**
 * A chord root expressed as a scale degree of a key, in the major-scale frame.
 * `Tune.key` carries no mode, so the major scale is the fixed reference;
 * minor-context naming (e.g. a bVII that is really the minor v's ii) is the
 * caller's concern. Labels follow the codebase degree convention used by
 * `ScaleDefinition.degrees` and `Note.scaleDegree`: flat-preferred chromatic
 * degrees, except the tritone which is spelled '#4'.
 */
export interface ScaleDegree {
	/** Ascending semitones from key root to chord root, 0-11. */
	semitones: number;
	/** Diatonic degree number in the major-scale frame, 1-7. */
	degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	/** Chromatic alteration relative to the major scale, or null if diatonic. */
	accidental: 'b' | '#' | null;
	/** Compact label: '1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'. */
	label: string;
}

const DEGREE_BY_SEMITONE: ReadonlyArray<Omit<ScaleDegree, 'semitones'>> = [
	{ degree: 1, accidental: null, label: '1' },
	{ degree: 2, accidental: 'b', label: 'b2' },
	{ degree: 2, accidental: null, label: '2' },
	{ degree: 3, accidental: 'b', label: 'b3' },
	{ degree: 3, accidental: null, label: '3' },
	{ degree: 4, accidental: null, label: '4' },
	{ degree: 4, accidental: '#', label: '#4' },
	{ degree: 5, accidental: null, label: '5' },
	{ degree: 6, accidental: 'b', label: 'b6' },
	{ degree: 6, accidental: null, label: '6' },
	{ degree: 7, accidental: 'b', label: 'b7' },
	{ degree: 7, accidental: null, label: '7' }
];

/** Scale degree of `root` relative to `key`, concert pitch, total over all 12 intervals. */
export function scaleDegreeOf(root: PitchClass, key: PitchClass): ScaleDegree {
	const semitones = pitchClassInterval(key, root);
	return { semitones, ...DEGREE_BY_SEMITONE[semitones] };
}
