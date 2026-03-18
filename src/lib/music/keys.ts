import type { PitchClass } from '$lib/types/music.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';

/** Number of sharps (positive) or flats (negative) for each key in major */
const KEY_SIGNATURES: Record<PitchClass, number> = {
	C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, Gb: -6,
	Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1
};

/** Get the number of sharps/flats for a major key */
export function keySignatureAccidentals(key: PitchClass): number {
	return KEY_SIGNATURES[key];
}

/** Get circle-of-fifths ordering of all keys */
export function circleOfFifths(): PitchClass[] {
	return ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
}

/** Get the relative minor of a major key */
export function relativeMajor(minorKey: PitchClass): PitchClass {
	const idx = PITCH_CLASSES.indexOf(minorKey);
	return PITCH_CLASSES[(idx + 3) % 12];
}

/** Get the relative major of a minor key */
export function relativeMinor(majorKey: PitchClass): PitchClass {
	const idx = PITCH_CLASSES.indexOf(majorKey);
	return PITCH_CLASSES[(idx + 9) % 12];
}

/**
 * Realize a scale from a root pitch class and interval pattern.
 * Returns pitch class indices (0-11).
 */
export function realizeScale(root: PitchClass, intervals: number[]): number[] {
	const rootIdx = PITCH_CLASSES.indexOf(root);
	const result: number[] = [rootIdx];
	let current = rootIdx;
	for (let i = 0; i < intervals.length - 1; i++) {
		current = (current + intervals[i]) % 12;
		result.push(current);
	}
	return result;
}

/**
 * Realize a scale as MIDI notes within a range.
 */
export function realizeScaleMidi(
	root: PitchClass,
	intervals: number[],
	lowMidi: number,
	highMidi: number
): number[] {
	const pcs = realizeScale(root, intervals);
	const notes: number[] = [];

	for (let midi = lowMidi; midi <= highMidi; midi++) {
		if (pcs.includes(midi % 12)) {
			notes.push(midi);
		}
	}

	return notes;
}

/** Get all pitch classes in a scale starting from root */
export function scalePitchClasses(root: PitchClass, intervals: number[]): PitchClass[] {
	return realizeScale(root, intervals).map((idx) => PITCH_CLASSES[idx]);
}
