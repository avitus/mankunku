/**
 * `noteIndexAtBeat`: which note of a phrase is sounding at a beat position —
 * the cursor a lead-sheet row lights as the beat indicator advances. Beats
 * are in the phrase's time signature (a quarter in 4/4); offsets/durations
 * are whole-note fractions like the rest of the app.
 */

import { describe, it, expect } from 'vitest';
import { noteIndexAtBeat } from '$lib/music/beat-cursor';
import type { Note } from '$lib/types/music';

const FOUR_FOUR: [number, number] = [4, 4];

function note(offsetEighths: number, durationEighths = 1): Note {
	return { pitch: 60, offset: [offsetEighths, 8], duration: [durationEighths, 8] };
}

describe('noteIndexAtBeat', () => {
	// Four eighths on beats 1, 1&, 2, 2& then a half note on beat 3.
	const notes = [note(0), note(1), note(2), note(3), note(4, 4)];

	it('returns the note that has started at the beat', () => {
		expect(noteIndexAtBeat(notes, 0, FOUR_FOUR)).toBe(0);
		expect(noteIndexAtBeat(notes, 0.5, FOUR_FOUR)).toBe(1);
		expect(noteIndexAtBeat(notes, 1.25, FOUR_FOUR)).toBe(2);
		expect(noteIndexAtBeat(notes, 3.9, FOUR_FOUR)).toBe(4);
	});

	it('is null before the first note and during a rest', () => {
		const withPickupRest = [note(2), note(6, 2)];
		expect(noteIndexAtBeat(withPickupRest, 0, FOUR_FOUR)).toBeNull();
		// Beat 2 (index 2 eighths) sounds; beat 3 (eighth 4) is a rest.
		expect(noteIndexAtBeat(withPickupRest, 1, FOUR_FOUR)).toBe(0);
		expect(noteIndexAtBeat(withPickupRest, 2, FOUR_FOUR)).toBeNull();
	});

	it('is null for a negative beat (the parked indicator) and an empty phrase', () => {
		expect(noteIndexAtBeat(notes, -1, FOUR_FOUR)).toBeNull();
		expect(noteIndexAtBeat([], 1, FOUR_FOUR)).toBeNull();
	});

	it('does not assume the notes are sorted by offset', () => {
		const shuffled = [note(2), note(0), note(1)];
		expect(noteIndexAtBeat(shuffled, 0.5, FOUR_FOUR)).toBe(2);
		expect(noteIndexAtBeat(shuffled, 1, FOUR_FOUR)).toBe(0);
	});
});
