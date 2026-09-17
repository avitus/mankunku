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
 * Does a detected note count as the expected pitch?
 *
 * By its MIDI number — its pitch class when `octaveInsensitive`. The single
 * rule shared by `scorePitch`, the DTW pitch cost and the scorer's hit count.
 * A ghost note (`detected.ghost`) gets no allowance: it is judged by its
 * nearest semitone like any other note, so one sounding far enough out of tune
 * to round to the neighbouring semitone is a wrong note (Andy, 2026-09-16).
 */
export function pitchMatches(
	expectedPitch: number,
	detected: DetectedNote,
	octaveInsensitive = false
): boolean {
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
 * same across octaves.
 */
export function scorePitch(
	expected: Note,
	detected: DetectedNote,
	octaveInsensitive = false
): number {
	if (expected.pitch === null) return 1.0; // rest — perfect by default

	if (!pitchMatches(expected.pitch, detected, octaveInsensitive)) return 0;

	// Correct note — add intonation bonus based on cents deviation
	const centsDev = Math.abs(detected.cents);
	// 0 cents = full bonus (0.1), 50 cents = no bonus
	const intonationBonus = 0.1 * Math.max(0, 1 - centsDev / 50);

	return 1.0 + intonationBonus;
}
