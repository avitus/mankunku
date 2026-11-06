import type { DetectedNote } from '$lib/types/audio';
import { PITCH_CLASSES, type PitchClass } from '$lib/types/music';

// Relative to each candidate tonic, in chromatic order. Chord tones and
// diatonic passing tones support a key; a blues third or flat seventh can
// belong to the same key. A final root, third or fifth adds cadence evidence.
const DEGREE_WEIGHT = [2, -0.4, 0.8, 0.35, 1.15, 0.7, -0.4, 1.25, -0.4, 0.7, 0.65, 0.55];
const ENDING_WEIGHT = [2, 0, 0, 0, 0.6, 0, 0, 1, 0, 0, 0, 0];

const HARMONIC_MINOR = new Set([0, 2, 3, 5, 7, 8, 11]);
const MINOR_WEIGHT = [2, -0.4, 0.8, 1.15, 0.1, 0.7, -0.4, 1.25, 0.65, 0.4, 0.8, 0.45];

/** A chromatic passing tone is common in a minor cadence. Consider a minor
 * reading of the ending tonic when the line also contains its minor third,
 * lowered sixth and a leading tone resolving to that tonic. */
function minorCadenceScore(degrees: number[]) {
	if (!degrees.includes(3) || !degrees.includes(8) ||
		!degrees.some((d, i) => d === 11 && degrees[i + 1] === 0) ||
		degrees.filter(d => !HARMONIC_MINOR.has(d)).length > 1) return -Infinity;
	return degrees.reduce((score, degree) => score + MINOR_WEIGHT[degree], 0) + ENDING_WEIGHT[0];
}

/** Infer the tonic from pitch-class support and the ending cadence; empty takes use C. */
export function inferRecorderKey(notes: Pick<DetectedNote, 'midi'>[]): PitchClass {
	if (!notes.length) return 'C';
	const last = notes[notes.length - 1].midi;
	let best = 0;
	let bestScore = -Infinity;
	for (let tonic = 0; tonic < 12; tonic++) {
		let score = 0;
		for (const note of notes) score += DEGREE_WEIGHT[(note.midi - tonic + 12) % 12];
		const finalDegree = (last - tonic + 12) % 12;
		score += ENDING_WEIGHT[finalDegree];
		if (finalDegree === 0) {
			score = Math.max(score, minorCadenceScore(notes.map(note => (note.midi - tonic + 12) % 12)));
		}
		if (score > bestScore) {
			bestScore = score;
			best = tonic;
		}
	}
	return PITCH_CLASSES[best];
}
