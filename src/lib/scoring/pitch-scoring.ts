/**
 * Pitch accuracy scoring for a single aligned note pair.
 *
 * Correct MIDI note = 1.0, wrong = 0.0.
 * Intonation bonus: up to +0.1 for being within 50 cents of the correct note.
 */

import type { Note } from '$lib/types/music';
import type { DetectedNote } from '$lib/types/audio';
import { midiToPitchClass } from '$lib/music/intervals';

/**
 * How far (in semitones, exclusive) a GHOST note's measured pitch may sit
 * from an expected pitch and still match it. A ghost is recovered from
 * sub-threshold frames (`findGhostNotes`), whose window mixes in the louder
 * notes around it, and a half-fingered note is itself pitched between keys:
 * the 2026-09-16 ghosted Cs measured C + 40–70 cents. One semitone credits
 * exactly the two semitones the measurement falls between — never a whole
 * step, and never a neighbour of an in-tune ghost.
 */
export const GHOST_PITCH_TOLERANCE = 1;

/**
 * Semitone distance between an expected pitch and a detected note's measured
 * pitch (`midi + cents / 100`), cyclic over the octave when
 * `octaveInsensitive`.
 */
function measuredDistance(expectedPitch: number, detected: DetectedNote, octaveInsensitive: boolean): number {
	const d = Math.abs(detected.midi + detected.cents / 100 - expectedPitch);
	if (!octaveInsensitive) return d;
	const cyclic = d % 12;
	return Math.min(cyclic, 12 - cyclic);
}

/**
 * Does a detected note count as the expected pitch?
 *
 * An ordinary note matches on its MIDI number (its pitch class when
 * `octaveInsensitive`). A ghost note matches any pitch within
 * `GHOST_PITCH_TOLERANCE` of its measured pitch. The single rule shared by
 * `scorePitch`, the DTW pitch cost and the scorer's hit count.
 */
export function pitchMatches(
	expectedPitch: number,
	detected: DetectedNote,
	octaveInsensitive = false
): boolean {
	if (detected.ghost) {
		return measuredDistance(expectedPitch, detected, octaveInsensitive) < GHOST_PITCH_TOLERANCE;
	}
	return octaveInsensitive
		? midiToPitchClass(expectedPitch) === midiToPitchClass(detected.midi)
		: expectedPitch === detected.midi;
}

/**
 * Score pitch accuracy for a single note pair.
 * Returns 0-1.1 (1.0 base + 0.1 intonation bonus), clamped to 0-1 at composite level.
 *
 * When `octaveInsensitive` is true, same pitch class in any octave is a match
 * (used by lick-practice continuous mode where the user may legitimately play
 * a lick an octave up or down). The intonation bonus uses `detected.cents`,
 * which is always deviation from the nearest integer MIDI, so it works the
 * same across octaves. A ghost note (see `pitchMatches`) earns its bonus from
 * its distance to the expected pitch instead, since it may match the semitone
 * its cents point away from.
 */
export function scorePitch(
	expected: Note,
	detected: DetectedNote,
	octaveInsensitive = false
): number {
	if (expected.pitch === null) return 1.0; // rest — perfect by default

	if (!pitchMatches(expected.pitch, detected, octaveInsensitive)) return 0;

	// Correct note — add intonation bonus based on cents deviation
	const centsDev = detected.ghost
		? measuredDistance(expected.pitch, detected, octaveInsensitive) * 100
		: Math.abs(detected.cents);
	// 0 cents = full bonus (0.1), 50 cents = no bonus
	const intonationBonus = 0.1 * Math.max(0, 1 - centsDev / 50);

	return 1.0 + intonationBonus;
}
