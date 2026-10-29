import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import {
	stepEntry,
	addNote,
	addRest,
	reset,
	selectNote,
	setDuration,
	toggleInsertMode
} from '$lib/state/step-entry.svelte';

/**
 * Insert mode (phase 4, 2026-10-16) — MuseScore's Insert note input: `I`
 * toggles it; while on, a letter or `0` at an edit selection goes IN FRONT
 * of the selected element and everything from there on moves later. The
 * pushed element stays selected, so a run of letters inserts a passage in
 * order. Off (the default), the same keys replace. Past the end of the
 * bars the insert is refused with nothing changed.
 */

function rows(notes: readonly Note[]): string[] {
	return notes.map((x) => `${x.pitch ?? 'z'} @${x.offset[0]}/${x.offset[1]} ×${x.duration[0]}/${x.duration[1]}`);
}

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
	stepEntry.tripletMode = false;
	stepEntry.dottedMode = false;
	stepEntry.barCount = 2;
	setDuration('quarter');
});

describe('insert mode', () => {
	it('toggles, and reset turns it off', () => {
		expect(stepEntry.insertMode).toBe(false);
		toggleInsertMode();
		expect(stepEntry.insertMode).toBe(true);
		reset();
		expect(stepEntry.insertMode).toBe(false);
	});

	it('a letter inserts before the selected element and pushes the rest later; the pushed element stays selected', () => {
		addNote(0, 4, 'natural');
		addNote(4, 4, 'natural');
		addNote(7, 4, 'natural');
		selectNote(1); // E
		toggleInsertMode();
		expect(addNote(2, 4, 'natural')).toBe(true); // D before E
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(2); // E, still the insertion point
		expect(stepEntry.selectionMode).toBe('edit');
		expect(addRest()).toBe(true); // a rest before E too
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', 'z @1/2 ×1/4', '64 @3/4 ×1/4', '67 @1/1 ×1/4']);
	});

	it('refuses an insert that would push a note past the end of the bars', () => {
		stepEntry.barCount = 1;
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		addNote(4, 4, 'natural');
		addNote(7, 4, 'natural');
		selectNote(1);
		toggleInsertMode();
		expect(addNote(9, 4, 'natural')).toBe(false);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
	});

	it('in insert mode a duration key chooses the next note\'s length instead of resizing the selection', () => {
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		selectNote(0);
		toggleInsertMode();
		expect(setDuration('half')).toBe(true);
		expect(stepEntry.currentDuration).toBe('half');
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4']);
		expect(addNote(4, 4, 'natural')).toBe(true); // a half E in front of C
		expect(rows(stepEntry.enteredNotes)).toEqual(['64 @0/1 ×1/2', '60 @1/2 ×1/4', '62 @3/4 ×1/4']);
	});

	it('with no edit selection insert mode appends like plain entry', () => {
		toggleInsertMode();
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4']);
		expect(stepEntry.selectionMode).toBe('entry');
	});
});

describe('insert mode keeps the chosen duration (CodeRabbit, PR #278)', () => {
	it('a run of letters inserts every note at the armed length, not at the pushed note\'s', () => {
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		selectNote(1); // D, a quarter
		toggleInsertMode();
		setDuration('eighth');
		expect(addNote(4, 4, 'natural')).toBe(true);
		expect(addNote(5, 4, 'natural')).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '64 @1/4 ×1/8', '65 @3/8 ×1/8', '62 @1/2 ×1/4']);
		expect(stepEntry.currentDuration).toBe('eighth');
	});
});
