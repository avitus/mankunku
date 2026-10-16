import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '$lib/state/settings.svelte';
import {
	stepEntry,
	addNote,
	addRest,
	adjustSelectedNoteDiatonic,
	enterTiedNote,
	reset,
	selectBar,
	selectFirst,
	selectLast,
	selectNote,
	setDuration
} from '$lib/state/step-entry.svelte';

/**
 * Phase 3 of the score-editing plan (2026-10-15): MuseScore's navigation and
 * pitch helpers. Alt+↑/↓ moves a note by a step of the DRAWN key (its
 * signature's letters), Ctrl/⌘+←/→ selects the first element of the
 * previous/next bar, Home/End the first/last element.
 */

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.phraseMode = 'major';
	stepEntry.selectedOctave = 4;
	stepEntry.tripletMode = false;
	stepEntry.dottedMode = false;
	stepEntry.barCount = 2;
	setDuration('quarter');
});

describe('adjustSelectedNoteDiatonic', () => {
	it('steps up and down through the key\'s letters, crossing the octave', () => {
		addNote(4, 4, 'natural'); // E4
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(65); // F4
		adjustSelectedNoteDiatonic(-1);
		adjustSelectedNoteDiatonic(-1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(62); // D4
		stepEntry.enteredNotes[0].pitch = 71; // B4
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(72); // C5
	});

	it('follows the drawn signature: F major gives Bb, D minor (one flat) gives Bb too', () => {
		stepEntry.phraseKey = 'F';
		addNote(9, 4, 'natural'); // A4
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(70); // Bb4
		reset();
		stepEntry.barCount = 2;
		stepEntry.phraseKey = 'D';
		stepEntry.phraseMode = 'minor';
		addNote(9, 4, 'natural');
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(70);
	});

	it('lands a chromatic note on the next letter of the key', () => {
		addNote(0, 4, 'sharp'); // C#4 (61)
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(62); // D4
		expect(stepEntry.enteredNotes[0].spelling).toBeUndefined();
	});

	it('works in the written key on a transposing instrument', () => {
		settings.instrumentId = 'tenor-sax';
		stepEntry.phraseKey = 'G'; // written G major: F#
		addNote(4, 4, 'natural'); // written E4 → concert
		const before = stepEntry.enteredNotes[0].pitch!;
		adjustSelectedNoteDiatonic(1); // written F#4: a whole step
		expect(stepEntry.enteredNotes[0].pitch).toBe(before + 2);
	});

	it('refuses to leave the written range, acts on the last pitched note with no selection, and ignores a rest', () => {
		stepEntry.enteredNotes = [{ pitch: 89, duration: [1, 4], offset: [0, 1] }]; // F6, the ceiling
		selectNote(0);
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(89);
		reset();
		stepEntry.barCount = 2;
		addNote(7, 4, 'natural'); // G4
		addRest();
		selectNote(null);
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(69); // A4
		selectNote(1); // the rest
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(69);
	});

	it('breaks a tie whose two ends no longer agree', () => {
		addNote(0, 4, 'natural');
		enterTiedNote();
		selectNote(1);
		adjustSelectedNoteDiatonic(1);
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
	});
});

describe('selectBar / selectFirst / selectLast', () => {
	beforeEach(() => {
		addNote(0, 4, 'natural'); // 0: C, bar 1
		addNote(2, 4, 'natural'); // 1: D
		addNote(4, 4, 'natural'); // 2: E
		addNote(7, 4, 'natural'); // 3: G
		addNote(9, 4, 'natural'); // 4: A, bar 2
		addNote(11, 4, 'natural'); // 5: B
	});

	it('Ctrl/⌘+→ selects the first element of the next bar; Ctrl/⌘+← the first of the previous', () => {
		selectNote(1);
		selectBar(1);
		expect(stepEntry.selectedNoteIndex).toBe(4);
		expect(stepEntry.selectionMode).toBe('edit');
		selectBar(-1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('from inside a bar, ← goes to that bar\'s first element; at the ends it stops', () => {
		selectNote(5);
		selectBar(-1);
		expect(stepEntry.selectedNoteIndex).toBe(4);
		selectBar(-1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		selectBar(-1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		selectBar(1);
		expect(stepEntry.selectedNoteIndex).toBe(4);
		selectBar(1);
		expect(stepEntry.selectedNoteIndex).toBe(4);
	});

	it('with no selection, → selects the first element and ← the last bar\'s first', () => {
		selectNote(null);
		selectBar(1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		selectNote(null);
		selectBar(-1);
		expect(stepEntry.selectedNoteIndex).toBe(4);
	});

	it('Home and End select the first and last element', () => {
		selectNote(2);
		selectFirst();
		expect(stepEntry.selectedNoteIndex).toBe(0);
		selectLast();
		expect(stepEntry.selectedNoteIndex).toBe(5);
		expect(stepEntry.selectionMode).toBe('edit');
	});
});
