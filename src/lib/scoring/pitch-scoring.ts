/**
 * Pitch accuracy scoring for a single aligned note pair.
 *
 * Correct MIDI note = 1.0, wrong = 0.0.
 * Intonation bonus: up to +0.1 for being within 50 cents of the correct note.
 */

import type { Note } from '$lib/types/music.ts';
import type { DetectedNote } from '$lib/types/audio.ts';

/**
 * Score pitch accuracy for a single note pair.
 * Returns 0-1.1 (1.0 base + 0.1 intonation bonus), clamped to 0-1 at composite level.
 */
export function scorePitch(expected: Note, detected: DetectedNote): number {
	if (expected.pitch === null) return 1.0; // rest — perfect by default

	if (expected.pitch !== detected.midi) return 0;

	// Correct note — add intonation bonus based on cents deviation
	const centsDev = Math.abs(detected.cents);
	// 0 cents = full bonus (0.1), 50 cents = no bonus
	const intonationBonus = 0.1 * Math.max(0, 1 - centsDev / 50);

	return 1.0 + intonationBonus;
}
