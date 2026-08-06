/**
 * Jazz chord voicing utilities.
 *
 * Shell, drop-2, rootless A/B, guide-tone and quartal voicing builders for
 * comping instruments, with voice-leading to minimize movement between
 * successive chords.
 */

import type { ChordQuality, PitchClass } from '$lib/types/music';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { PITCH_CLASSES } from '$lib/types/music';

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
 * Rootless voicing degree slots, derived from CHORD_DEFINITIONS intervals.
 *
 * Disambiguation rules the definitions force:
 * - `7#9` carries both 3 (the #9) and 4 (the major 3rd): when both are
 *   present the 3rd is 4 and the 9-slot is 15 (#9 up an octave).
 * - `7b13`/`aug7` carry 8; `7#11`/`min7b5`/`dim7`/`7alt` carry 6 — either
 *   replaces the 5-slot so altered dominants voice their colour tone.
 * - maj6/min6 (interval 9) and dim7 (bb7, also 9) share the 7-slot: both
 *   are the chord's fourth stacked tone, which is exactly what the slot
 *   voices. Triads with no 9/10/11 interval are not voiceable rootless.
 */
function rootlessSlots(quality: ChordQuality): { third: number; fifth: number; seventh: number; ninth: number } | null {
	const def = CHORD_DEFINITIONS[quality];
	if (!def) return null;
	const has = (n: number) => def.intervals.includes(n);

	const seventh = def.intervals.find((i) => i >= 9 && i <= 11);
	if (seventh === undefined) return null;

	const third = has(4) ? 4 : has(3) ? 3 : has(5) ? 5 : 2;
	const fifth = has(8) ? 8 : has(6) ? 6 : 7;
	const ninth = has(1) ? 13 : has(3) && has(4) ? 15 : 14;
	return { third, fifth, seventh, ninth };
}

/** Stack ascending intervals over the root pitch class, near a register. */
function stackNearRegister(rootNum: number, intervals: number[], targetLowest: number): number[] {
	// Dedupe + sort: slot arithmetic can collide (sus2's 9-slot IS its sus
	// tone an octave up), and a duplicate would trigger one MIDI note twice.
	const stack = [...new Set(intervals)].sort((a, b) => a - b);
	const rootRef = nearestTo(rootNum, targetLowest - stack[0]);
	const notes = stack.map((i) => rootRef + i);
	// Keep the voicing in the mid-piano band: above the bass, below the melody.
	if (notes[0] < 48) return notes.map((n) => n + 12);
	if (notes[notes.length - 1] > 84) return notes.map((n) => n - 12);
	return notes;
}

/**
 * Rootless "A-form" voicing: 3-5-7-9 stacked from the 3rd, with altered
 * tensions replacing the plain tones they colour (b9/#9 in the 9-slot,
 * #11/b13 in the 5-slot). Returns [] for triads with no 7th-slot tone.
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI (default 62)
 */
export function rootlessVoicingA(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 62): number[] {
	const slots = rootlessSlots(quality);
	if (!slots) return [];
	const rootNum = pitchClassToNumber(rootPc);
	return stackNearRegister(rootNum, [slots.third, slots.fifth, slots.seventh, slots.ninth], registerMidi - 9);
}

/**
 * Rootless "B-form" voicing: 7-9-3-13 stacked from the 7th. Plain dominants
 * take the natural 13 on top (the classic 13 / 13b9 sound); a b13 or #11 in
 * the definition takes the top slot instead; other qualities top with the
 * 5th. Returns [] for triads with no 7th-slot tone.
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI (default 62)
 */
export function rootlessVoicingB(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 62): number[] {
	const slots = rootlessSlots(quality);
	if (!slots) return [];
	const isDominant = slots.seventh === 10 && slots.third === 4;
	const top =
		slots.fifth === 8 ? 20 :
		slots.fifth === 6 ? 18 :
		isDominant ? 21 : slots.fifth + 12;
	const rootNum = pitchClassToNumber(rootPc);
	return stackNearRegister(rootNum, [slots.seventh, slots.ninth, slots.third + 12, top], registerMidi - 15);
}

/** A voicing builder: (root, quality, register) → ascending MIDI notes. */
export type VoicingFn = (root: PitchClass, quality: ChordQuality, register: number) => number[];

/**
 * Voice-lead a sequence of chords: each voicing minimizes total
 * semitone movement from the previous voicing.
 *
 * @param chords - Array of [rootPc, quality] pairs
 * @param voicingFn - Voicing function, or one function per chord (same length
 *   as `chords`) so the comping engine can mix shell/rootless/drop-2 shapes
 *   while voice-leading still drives the register choice
 * @param registerMidi - Register center, or one per chord (same length as
 *   `chords`) — a per-chord center only re-centers that chord's ±12 search
 *   window, so closeness to the previous voicing still dominates and an
 *   intensity arc drifts the comp gradually rather than jumping registers
 * @returns Array of MIDI note arrays
 */
export function voiceLead(
	chords: Array<{ root: PitchClass; quality: ChordQuality }>,
	voicingFn: VoicingFn | VoicingFn[],
	registerMidi: number | number[] = 54
): number[][] {
	if (chords.length === 0) return [];
	const fnFor = (i: number): VoicingFn => (Array.isArray(voicingFn) ? voicingFn[i] : voicingFn);
	const regFor = (i: number): number => (Array.isArray(registerMidi) ? registerMidi[i] : registerMidi);

	const result: number[][] = [];
	let prevVoicing = fnFor(0)(chords[0].root, chords[0].quality, regFor(0));
	result.push(prevVoicing);

	for (let i = 1; i < chords.length; i++) {
		const chord = chords[i];
		// Try multiple registers and pick the one closest to previous voicing
		let bestVoicing: number[] = [];
		let bestCost = Infinity;

		for (let reg = regFor(i) - 12; reg <= regFor(i) + 12; reg += 1) {
			const candidate = fnFor(i)(chord.root, chord.quality, reg);
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

/**
 * Guide-tone voicing: just the 3rd and 7th — the two notes that define the
 * harmony. The "pro leaves space" color: a comper thinning out under a busy
 * soloist or at low intensity. Triads (no 7th slot) get 3rd + 5th.
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI (default 62)
 */
export function guideToneVoicing(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 62): number[] {
	const def = CHORD_DEFINITIONS[quality];
	if (!def) return [];
	const rootNum = pitchClassToNumber(rootPc);
	const intervals = def.intervals;
	const third = intervals.find((i) => i >= 3 && i <= 5) ?? intervals[1] ?? 4;
	const seventh = intervals.find((i) => i >= 9 && i <= 11);
	const second = seventh ?? intervals.find((i) => i >= 6 && i <= 8) ?? 7;
	return stackNearRegister(rootNum, [third, second], registerMidi - 4);
}

/**
 * Quartal voicing: a fourth-stack on 9-5-1 (root on top), the modal
 * McCoy-flavored shape. min7/min6/sus qualities add the 11 as a fourth
 * voice. Altered/diminished/augmented qualities return [] — fourth-stacks
 * blur exactly the tensions those chords exist to state — so selection
 * falls through to the rootless shapes (same convention as rootless
 * voicings returning [] for triads).
 *
 * @param rootPc - PitchClass name of the chord root
 * @param quality - Chord quality
 * @param registerMidi - Approximate center MIDI (default 62)
 */
export function quartalVoicing(rootPc: PitchClass, quality: ChordQuality, registerMidi: number = 62): number[] {
	const def = CHORD_DEFINITIONS[quality];
	if (!def) return [];
	// min7b5 joins the exclusions: the stack's natural 5 clashes with the
	// defining b5 — an audibly wrong chord, not a color.
	if (['7alt', '7b9', '7#9', '7#11', '7b13', 'dim7', 'dim', 'aug', 'aug7', 'min7b5'].includes(quality)) {
		return [];
	}
	const rootNum = pitchClassToNumber(rootPc);
	const addEleventh = ['min7', 'min6', 'minMaj7', 'sus4', 'sus2'].includes(quality);
	const stack = addEleventh ? [2, 7, 12, 17] : [2, 7, 12];
	return stackNearRegister(rootNum, stack, registerMidi - 5);
}
