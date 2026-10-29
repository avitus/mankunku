import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import {
	stepEntry,
	addNote,
	addRest,
	enterTiedNote,
	reset,
	selectNote,
	selectNext,
	selectPrev,
	setDuration,
	toggleDotted,
	toggleTriplet
} from '$lib/state/step-entry.svelte';

/**
 * Editing in place (2026-10-15, phase 2 of the score-editing plan). Two
 * selection intents: `entry` — the just-entered element, where letters,
 * `0`, `+` and the duration keys mean what they always meant; `edit` — a
 * click or arrow landed here, and the same keys now act ON the element:
 * letters re-pitch it (MuseScore's note input replaces what sits at the
 * cursor), `0` rests it, duration keys resize it, `+` ties it. Selecting an
 * element syncs the current duration to it (MuseScore's toolbar follows the
 * selection), so a chain of letters re-pitches a line and keeps its rhythm.
 */

function rows(notes: readonly Note[]): string[] {
	return notes.map((x) => `${x.pitch ?? 'z'} @${x.offset[0]}/${x.offset[1]} ×${x.duration[0]}/${x.duration[1]}${x.tied ? ' ~' : ''}`);
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

/** C D E G as quarters — bar 1 full. */
function fourQuarters(): void {
	addNote(0, 4, 'natural');
	addNote(2, 4, 'natural');
	addNote(4, 4, 'natural');
	addNote(7, 4, 'natural');
}

describe('selection intent', () => {
	it('entry after typing, edit after a click or an arrow, entry again after Esc', () => {
		addNote(0, 4, 'natural');
		expect(stepEntry.selectionMode).toBe('entry');
		selectNote(0);
		expect(stepEntry.selectionMode).toBe('edit');
		selectNote(null);
		expect(stepEntry.selectionMode).toBe('entry');
		addNote(2, 4, 'natural');
		selectPrev();
		expect(stepEntry.selectionMode).toBe('edit');
		selectNext();
		expect(stepEntry.selectionMode).toBe('edit');
	});

	it('selecting an element syncs the current duration, modifiers included', () => {
		setDuration('half');
		addNote(0, 4, 'natural');
		setDuration('eighth');
		toggleDotted();
		addNote(2, 4, 'natural');
		setDuration('quarter');
		toggleTriplet();
		addNote(4, 4, 'natural');
		setDuration('sixteenth');
		selectNote(0);
		expect([stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode]).toEqual(['half', false, false]);
		selectNote(1);
		expect([stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode]).toEqual(['eighth', false, true]);
		selectNote(2);
		expect([stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode]).toEqual(['quarter', true, false]);
	});

	it('leaves the duration alone when the element\'s length has no name', () => {
		stepEntry.enteredNotes = [{ pitch: 60, duration: [5, 16], offset: [0, 1] }];
		setDuration('eighth');
		selectNote(0);
		expect(stepEntry.currentDuration).toBe('eighth');
	});
});

describe('letters on an edit selection re-pitch in place', () => {
	it('replaces the selected note, keeps every later offset, and moves the selection on', () => {
		fourQuarters();
		selectNote(1); // D
		expect(addNote(5, 4, 'natural')).toBe(true); // F
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '65 @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(2); // the E, ready for the next letter
		expect(stepEntry.selectionMode).toBe('edit');
	});

	it('a chain of letters re-pitches a line and keeps its rhythm', () => {
		setDuration('half');
		addNote(0, 4, 'natural');
		setDuration('eighth');
		addNote(2, 4, 'natural');
		addNote(4, 4, 'natural');
		selectNote(0);
		// Each letter lands in the octave nearest the note it replaces (C4 → A4,
		// D4 → B3, E4 → C4); Shift+↑/↓ moves one an octave afterwards.
		addNote(9, 4, 'natural'); // A over the half
		addNote(11, 4, 'natural'); // B over the first eighth
		addNote(0, 5, 'natural'); // C over the second eighth
		expect(rows(stepEntry.enteredNotes)).toEqual(['69 @0/1 ×1/2', '59 @1/2 ×1/8', '60 @5/8 ×1/8']);
		expect(stepEntry.selectedNoteIndex).toBeNull(); // past the end: entering again
		expect(stepEntry.selectionMode).toBe('entry');
	});

	it('places the new pitch in the octave nearest the note it replaces', () => {
		fourQuarters();
		selectNote(3); // G4 (67)
		addNote(9, 4, 'natural'); // A: nearest to G4 is A4, not A3
		expect(stepEntry.enteredNotes[3].pitch).toBe(69);
	});

	it('typing over a rest fills it with the current duration', () => {
		addNote(0, 4, 'natural');
		addRest();
		addNote(4, 4, 'natural');
		selectNote(1);
		expect(addNote(2, 4, 'natural')).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '64 @1/2 ×1/4']);
	});

	it('refuses a replacement that would run past the end of the bars, changing nothing', () => {
		stepEntry.barCount = 1;
		fourQuarters();
		selectNote(3);
		stepEntry.currentDuration = 'half'; // armed by hand: the key itself would refuse (see the resize tests)
		expect(addNote(9, 4, 'natural')).toBe(false);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(3);
	});
});

describe('0 on an edit selection rests the element', () => {
	it('turns the selected note into a rest of the current duration and moves on', () => {
		fourQuarters();
		selectNote(1);
		expect(addRest()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(2);
	});
});

describe('duration keys on an edit selection resize the element', () => {
	it('shortening leaves a rest for the remainder', () => {
		setDuration('half');
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		selectNote(0);
		setDuration('quarter');
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', '62 @1/2 ×1/2']);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('lengthening overwrites what follows, MuseScore-style', () => {
		fourQuarters();
		selectNote(0);
		setDuration('half');
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/2', '64 @1/2 ×1/4', '67 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('dotting and tripletting resize too', () => {
		fourQuarters();
		selectNote(0);
		toggleDotted();
		expect(rows(stepEntry.enteredNotes)[0]).toBe('60 @0/1 ×3/8');
		expect(rows(stepEntry.enteredNotes)[1]).toBe('62 @3/8 ×1/8'); // the D keeps its tail
		toggleDotted(); // back to a quarter: the remainder becomes a rest
		expect(rows(stepEntry.enteredNotes).slice(0, 3)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/8', '62 @3/8 ×1/8']);
	});

	it('refuses a resize past the end of the bars and leaves the duration as it was', () => {
		stepEntry.barCount = 1;
		fourQuarters();
		selectNote(3);
		setDuration('half');
		expect(stepEntry.currentDuration).toBe('quarter');
		expect(rows(stepEntry.enteredNotes)[3]).toBe('67 @3/4 ×1/4');
	});

	it('on an entry selection the keys only set the next duration, as before', () => {
		fourQuarters();
		setDuration('half');
		expect(rows(stepEntry.enteredNotes)[3]).toBe('67 @3/4 ×1/4');
		expect(stepEntry.currentDuration).toBe('half');
	});
});

describe('+ on an edit selection', () => {
	it('ties the selected note to a following note of the same pitch, and toggles it off again', () => {
		addNote(0, 4, 'natural');
		addNote(0, 4, 'natural');
		selectNote(0);
		expect(enterTiedNote()).toBe(true);
		expect(stepEntry.enteredNotes[0].tied).toBe(true);
		expect(enterTiedNote()).toBe(true);
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
	});

	it('otherwise writes a tied continuation over what follows', () => {
		fourQuarters();
		selectNote(1); // D, followed by E
		expect(enterTiedNote()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4 ~', '62 @1/2 ×1/4', '67 @3/4 ×1/4']);
	});

	it('is a no-op on a selected rest', () => {
		addNote(0, 4, 'natural');
		addRest();
		addNote(4, 4, 'natural');
		selectNote(1);
		expect(enterTiedNote()).toBe(false);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', '64 @1/2 ×1/4']);
	});
});
