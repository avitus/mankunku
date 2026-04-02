/**
 * Jazz chord voicing utilities.
 *
 * Generates shell voicings (root + guide tones) and drop-2 voicings
 * for comping instruments, with voice-leading to minimize movement
 * between successive chords.
 */

import type { ChordQuality, PitchClass } from '$lib/types/music.ts';
import { CHORD_DEFINITIONS } from '$lib/music/chords.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';

/** MIDI pitch class for a PitchClass name (C=0, Db=1, ..., B=11) */
export function pitchClassToNumber(pc: PitchClass): number {
	return PITCH_CLASSES.indexOf(pc);
}

/** Nearest MIDI note at or above `floor` with the given pitch class */
function nearestAbove(pc: number, floor: number): number {
	const floorPc = ((floor % 12) + 12) % 12;
	let midi = floor + ((pc - floorPc + 12) % 12);
	return midi;
}

/** Nearest MIDI note to `target` with the given pitch class */
function nearestTo(pc: number, target: number): number {
	const above = nearestAbove(pc, target);
	const below = above - 12;
	return Math.abs(above - target) <= Math.abs(below - target) ? above : below;
}

/**
 * Shell voicing: root + 3rd + 7th (the "guide tones").
 * For triads without a 7th, uses root + 3rd + 5th.
 * Returns MIDI note array in the given register.
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI for voicing (default 54, around F#3)
 */
export function shellVoicing(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 54): number[] {
	const def = CHORD_DEFINITIONS[quality];
	if (!def) return [];

	const rootNum = pitchClassToNumber(rootPc);
	const intervals = def.intervals;

	// Find the 3rd (or sus tone) and 7th
	const third = intervals.find(i => i >= 3 && i <= 5) ?? intervals[1] ?? 0;
	const seventh = intervals.find(i => i >= 9 && i <= 11);

	const rootMidi = nearestAbove(rootNum, registerMidi - 6);
	const thirdPc = (rootNum + third) % 12;
	const thirdMidi = nearestTo(thirdPc, rootMidi + 4);

	if (seventh !== undefined) {
		const seventhPc = (rootNum + seventh) % 12;
		const seventhMidi = nearestTo(seventhPc, rootMidi + 7);
		return [rootMidi, thirdMidi, seventhMidi].sort((a, b) => a - b);
	}

	// Triad: use root + 3rd + 5th
	const fifth = intervals.find(i => i >= 6 && i <= 8) ?? 7;
	const fifthPc = (rootNum + fifth) % 12;
	const fifthMidi = nearestTo(fifthPc, rootMidi + 7);
	return [rootMidi, thirdMidi, fifthMidi].sort((a, b) => a - b);
}

/**
 * Drop-2 voicing: 4-note close voicing with the second-from-top note
 * dropped an octave. Produces a wider, richer spread.
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI (default 60, C4)
 */
export function drop2Voicing(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 60): number[] {
	const def = CHORD_DEFINITIONS[quality];
	if (!def) return [];

	const rootNum = pitchClassToNumber(rootPc);
	const intervals = def.intervals;

	// Build close-position 4-note voicing: root, 3rd, 5th, 7th (or available tones)
	const tones = intervals.slice(0, 4);
	while (tones.length < 4) {
		tones.push(tones[tones.length - 1]);
	}

	// Place all notes near the register
	const midiNotes = tones.map(interval => {
		const pc = (rootNum + interval) % 12;
		return nearestAbove(pc, registerMidi - 3);
	});

	// Sort ascending (close position)
	midiNotes.sort((a, b) => a - b);

	// Ensure notes are within an octave by pushing up if needed
	for (let i = 1; i < midiNotes.length; i++) {
		while (midiNotes[i] <= midiNotes[i - 1]) {
			midiNotes[i] += 12;
		}
	}

	// Drop the second-from-top note down an octave
	if (midiNotes.length >= 3) {
		midiNotes[midiNotes.length - 2] -= 12;
		midiNotes.sort((a, b) => a - b);
	}

	return midiNotes;
}

/**
 * Voice-lead a sequence of chords: each voicing minimizes total
 * semitone movement from the previous voicing.
 *
 * @param chords - Array of [rootPc, quality] pairs
 * @param voicingFn - Voicing function to use
 * @param registerMidi - Starting register center
 * @returns Array of MIDI note arrays
 */
export function voiceLead(
	chords: Array<{ root: PitchClass; quality: ChordQuality }>,
	voicingFn: (root: PitchClass, quality: ChordQuality, register: number) => number[],
	registerMidi: number = 54
): number[][] {
	if (chords.length === 0) return [];

	const result: number[][] = [];
	let prevVoicing = voicingFn(chords[0].root, chords[0].quality, registerMidi);
	result.push(prevVoicing);

	for (let i = 1; i < chords.length; i++) {
		const chord = chords[i];
		// Try multiple registers and pick the one closest to previous voicing
		let bestVoicing: number[] = [];
		let bestCost = Infinity;

		for (let reg = registerMidi - 12; reg <= registerMidi + 12; reg += 1) {
			const candidate = voicingFn(chord.root, chord.quality, reg);
			if (candidate.length === 0) continue;

			const cost = totalMovement(prevVoicing, candidate);
			if (cost < bestCost) {
				bestCost = cost;
				bestVoicing = candidate;
			}
		}

		result.push(bestVoicing);
		prevVoicing = bestVoicing;
	}

	return result;
}

/** Sum of absolute semitone movement between two voicings */
function totalMovement(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	let sum = 0;
	for (let i = 0; i < len; i++) {
		sum += Math.abs(a[i] - b[i]);
	}
	// Penalize note count mismatch
	sum += Math.abs(a.length - b.length) * 12;
	return sum;
}
