import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry,
	addNote,
	reset,
	getCurrentPhrase,
	flipSelectedNoteSpelling
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';

/**
 * `stepEntry.transpositionOverride` lets the lead-sheet editor interpret
 * typed pitches for a SOURCE chart's transposition instead of the user's
 * instrument — a tenor player copying from a concert book selects C and
 * types the book's note names. null = follow the instrument (lick entry).
 */

beforeEach(() => {
	settings.instrumentId = 'tenor-sax'; // +14 written above concert
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
});

describe('stepEntry.transpositionOverride', () => {
	it('defaults to following the instrument (written C4 → concert 46)', () => {
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(46);
	});

	it('override 0 interprets typed pitches as concert', () => {
		stepEntry.transpositionOverride = 0;
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(60);
	});

	it('override applies to the phrase key conversion', () => {
		stepEntry.phraseKey = 'D';
		expect(getCurrentPhrase().key).toBe('C'); // tenor: written D = concert C
		stepEntry.transpositionOverride = 0;
		expect(getCurrentPhrase().key).toBe('D'); // concert source: D is D
	});

	it('override applies to enharmonic spelling (written pc from the source)', () => {
		// Concert 46: written for tenor is C (natural — not flippable); as a
		// concert-source pitch it is Bb — chromatic, so the flip takes effect.
		stepEntry.transpositionOverride = 0;
		stepEntry.enteredNotes = [{ pitch: 46, duration: [1, 4], offset: [0, 1] }];
		stepEntry.selectedNoteIndex = 0;
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBeDefined();
	});

	it('without the override the same flip is a no-op for tenor', () => {
		stepEntry.enteredNotes = [{ pitch: 46, duration: [1, 4], offset: [0, 1] }];
		stepEntry.selectedNoteIndex = 0;
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBeUndefined();
	});

	it('reset() clears the override', () => {
		stepEntry.transpositionOverride = 0;
		reset();
		expect(stepEntry.transpositionOverride).toBeNull();
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(46);
	});
});
