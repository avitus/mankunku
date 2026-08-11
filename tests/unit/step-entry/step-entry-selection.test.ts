import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry,
	addNote,
	addRest,
	adjustSelectedNotePitch,
	deleteSelectedNote,
	flipSelectedNoteSpelling,
	enterTiedNote,
	reset,
	selectNote,
	selectPrev,
	selectNext,
	setBarCount,
	setDuration
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
	stepEntry.currentDuration = 'quarter';
	stepEntry.tripletMode = false;
	stepEntry.dottedMode = false;
	stepEntry.barCount = 4;
});

describe('addNote selects the appended note', () => {
	it('auto-selects each newly entered pitched note', () => {
		addNote(0, 4, 'natural'); // C4
		expect(stepEntry.selectedNoteIndex).toBe(0);
		addNote(2, 4, 'natural'); // D4
		expect(stepEntry.selectedNoteIndex).toBe(1);
		addNote(4, 4, 'natural'); // E4
		expect(stepEntry.selectedNoteIndex).toBe(2);
	});

	it('selects the appended rest, same as a pitched note', () => {
		addNote(0, 4, 'natural'); // selection = 0
		expect(stepEntry.selectedNoteIndex).toBe(0);
		addRest();
		// Rests are first-class elements: entry moves selection onto them so an
		// immediate Backspace removes the rest just entered.
		expect(stepEntry.selectedNoteIndex).toBe(1);
	});

	it('enterTiedNote selects the appended tied duplicate', () => {
		addNote(0, 4, 'natural');
		enterTiedNote();
		expect(stepEntry.selectedNoteIndex).toBe(1);
	});
});

describe('selectNote / selectPrev / selectNext', () => {
	beforeEach(() => {
		addNote(0, 4, 'natural'); // 0: C4
		addRest();                 // 1: rest
		addNote(4, 4, 'natural'); // 2: E4
		addNote(7, 4, 'natural'); // 3: G4
		stepEntry.selectedNoteIndex = null;
	});

	it('selectNote accepts any in-range element, rest or note', () => {
		selectNote(0);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		selectNote(1); // rest — selectable like any element
		expect(stepEntry.selectedNoteIndex).toBe(1);
		selectNote(2);
		expect(stepEntry.selectedNoteIndex).toBe(2);
		selectNote(null);
		expect(stepEntry.selectedNoteIndex).toBe(null);
		selectNote(99); // out of range — ignored
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('selectPrev from null lands on the last element', () => {
		selectPrev();
		expect(stepEntry.selectedNoteIndex).toBe(3);
	});

	it('selectPrev from null lands on a trailing rest', () => {
		addRest(); // 4: rest at the end
		stepEntry.selectedNoteIndex = null;
		selectPrev();
		expect(stepEntry.selectedNoteIndex).toBe(4);
	});

	it('selectPrev stops on rests (MuseScore-style)', () => {
		selectNote(2); // E4
		selectPrev();
		expect(stepEntry.selectedNoteIndex).toBe(1); // the rest
		selectPrev();
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('selectPrev is a no-op at the start', () => {
		selectNote(0);
		selectPrev();
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('selectNext from null lands on the first element', () => {
		selectNext();
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('selectNext stops on rests (MuseScore-style)', () => {
		selectNote(0);
		selectNext();
		expect(stepEntry.selectedNoteIndex).toBe(1); // the rest
		selectNext();
		expect(stepEntry.selectedNoteIndex).toBe(2);
	});

	it('selectNext is a no-op at the end', () => {
		selectNote(3);
		selectNext();
		expect(stepEntry.selectedNoteIndex).toBe(3);
	});
});

describe('adjustSelectedNotePitch', () => {
	beforeEach(() => {
		addNote(0, 4, 'natural'); // 0: C4 (60)
		addNote(4, 4, 'natural'); // 1: E4 (64)
		addNote(7, 4, 'natural'); // 2: G4 (67)
	});

	it('shifts the explicitly selected note, not the last one', () => {
		selectNote(0);
		adjustSelectedNotePitch(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(61); // C# / Db
		expect(stepEntry.enteredNotes[1].pitch).toBe(64); // unchanged
		expect(stepEntry.enteredNotes[2].pitch).toBe(67); // unchanged
	});

	it('falls back to the last pitched note when selection is null', () => {
		selectNote(null);
		adjustSelectedNotePitch(-1);
		expect(stepEntry.enteredNotes[2].pitch).toBe(66); // G4 → Gb4
		expect(stepEntry.enteredNotes[0].pitch).toBe(60);
		expect(stepEntry.enteredNotes[1].pitch).toBe(64);
	});

	it('breaks a tie when the selected note is tied-from and the pitch diverges', () => {
		reset();
		stepEntry.barCount = 4;
		setDuration('quarter');
		addNote(0, 4, 'natural'); // 0: C4
		enterTiedNote();           // 1: C4 (tied from 0); selection now 1
		expect(stepEntry.enteredNotes[0].tied).toBe(true);

		// Select the FIRST (tied-from) note and shift it — the tie endpoints
		// would no longer agree, so the tie should clear.
		selectNote(0);
		adjustSelectedNotePitch(1);
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
		expect(stepEntry.enteredNotes[0].pitch).toBe(61);
		expect(stepEntry.enteredNotes[1].pitch).toBe(60); // tied duplicate unchanged
	});
});

describe('deleteSelectedNote', () => {
	beforeEach(() => {
		setDuration('quarter');
		addNote(0, 4, 'natural'); // 0: C4
		addNote(2, 4, 'natural'); // 1: D4
		addNote(4, 4, 'natural'); // 2: E4
		addNote(7, 4, 'natural'); // 3: G4
	});

	it('mid-list delete shifts subsequent offsets left and re-selects the previous note', () => {
		selectNote(1); // D4
		deleteSelectedNote();
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 64, 67]);
		// Offsets must collapse so the phrase remains contiguous from 0.
		// addFractions / subtractFractions return reduced form.
		expect(stepEntry.enteredNotes[0].offset).toEqual([0, 1]);
		expect(stepEntry.enteredNotes[1].offset).toEqual([1, 4]);
		expect(stepEntry.enteredNotes[2].offset).toEqual([1, 2]);
		expect(stepEntry.selectedNoteIndex).toBe(0); // re-selected previous pitched note
	});

	it('deleting index 0 falls forward to the new first pitched note', () => {
		selectNote(0);
		deleteSelectedNote();
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([62, 64, 67]);
		expect(stepEntry.selectedNoteIndex).toBe(0); // new first pitched note
	});

	it('deletion from the end clears selection so append-cursor resumes', () => {
		selectNote(3); // last
		deleteSelectedNote();
		expect(stepEntry.enteredNotes).toHaveLength(3);
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('falls back to the last element when no explicit selection', () => {
		selectNote(null);
		deleteSelectedNote();
		expect(stepEntry.enteredNotes).toHaveLength(3);
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('clears a dangling tie when the deletion straddles a tie', () => {
		reset();
		stepEntry.barCount = 4;
		setDuration('quarter');
		addNote(0, 4, 'natural'); // 0: C4
		enterTiedNote();           // 1: C4 tied-from 0
		addNote(2, 4, 'natural'); // 2: D4
		// Deleting the tied duplicate (index 1) leaves [C4 tied → D4] — pitches
		// disagree, so the tie should clear.
		selectNote(1);
		deleteSelectedNote();
		expect(stepEntry.enteredNotes).toHaveLength(2);
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
	});
});

describe('rest selection and deletion', () => {
	beforeEach(() => {
		setDuration('quarter');
	});

	it('Backspace with no selection deletes a trailing rest, not the note before it', () => {
		addNote(0, 4, 'natural'); // 0: C4
		addNote(2, 4, 'natural'); // 1: D4
		addRest();                 // 2: rest
		selectNote(null);
		deleteSelectedNote();
		// The historical bug: this used to delete D4 and orphan the rest.
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 62]);
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('deletes a selected mid-list rest and shifts subsequent offsets left', () => {
		addNote(0, 4, 'natural'); // 0: C4
		addRest();                 // 1: rest
		addNote(4, 4, 'natural'); // 2: E4
		addNote(7, 4, 'natural'); // 3: G4
		selectNote(1);
		deleteSelectedNote();
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 64, 67]);
		expect(stepEntry.enteredNotes[0].offset).toEqual([0, 1]);
		expect(stepEntry.enteredNotes[1].offset).toEqual([1, 4]);
		expect(stepEntry.enteredNotes[2].offset).toEqual([1, 2]);
		expect(stepEntry.selectedNoteIndex).toBe(0); // previous element
	});

	it('post-delete reselection can land on a neighboring rest', () => {
		addNote(0, 4, 'natural'); // 0: C4
		addRest();                 // 1: rest
		addNote(4, 4, 'natural'); // 2: E4
		addNote(7, 4, 'natural'); // 3: G4
		selectNote(2); // E4 — not at the end, so reselection runs
		deleteSelectedNote();
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, null, 67]);
		expect(stepEntry.selectedNoteIndex).toBe(1); // the rest, not C4
	});

	it('deleting a rest after a tied pair leaves the tie intact', () => {
		addNote(0, 4, 'natural'); // 0: C4
		enterTiedNote();           // 1: C4 tied-from 0
		addRest();                 // 2: rest
		addNote(2, 4, 'natural'); // 3: D4
		selectNote(2);
		deleteSelectedNote();
		expect(stepEntry.enteredNotes).toHaveLength(3);
		expect(stepEntry.enteredNotes[0].tied).toBe(true);
	});

	it('adjustSelectedNotePitch on a selected rest changes nothing', () => {
		addNote(0, 4, 'natural'); // 0: C4
		addRest();                 // 1: rest
		addNote(4, 4, 'natural'); // 2: E4
		selectNote(1);
		adjustSelectedNotePitch(1);
		// Hard no-op: no silent retarget to a pitched note.
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, null, 64]);
	});

	it('flipSelectedNoteSpelling on a selected rest changes nothing', () => {
		addNote(0, 4, 'sharp');   // 0: C#4 (flippable)
		addRest();                 // 1: rest
		selectNote(1);
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBeUndefined();
	});

	it('pitch ops with no selection still target the last pitched note past a trailing rest', () => {
		addNote(7, 4, 'natural'); // 0: G4 (67)
		addRest();                 // 1: rest
		selectNote(null);
		adjustSelectedNotePitch(-1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(66);
		expect(stepEntry.enteredNotes[1].pitch).toBe(null);
	});
});

describe('flipSelectedNoteSpelling', () => {
	it('flips only the selected note', () => {
		setDuration('quarter');
		addNote(0, 4, 'sharp'); // C#4 (chromatic, flippable)
		addNote(2, 4, 'sharp'); // D#4 (chromatic, flippable)
		expect(stepEntry.enteredNotes[0].spelling).toBeUndefined();
		expect(stepEntry.enteredNotes[1].spelling).toBeUndefined();

		selectNote(0);
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBe('flat');
		expect(stepEntry.enteredNotes[1].spelling).toBeUndefined();
	});

	it('is a no-op on a non-chromatic pitch', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural'); // C4 (white key)
		selectNote(0);
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBeUndefined();
	});
});

describe('reset and setBarCount touching selection', () => {
	it('reset clears selection', () => {
		addNote(0, 4, 'natural');
		expect(stepEntry.selectedNoteIndex).toBe(0);
		reset();
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('setBarCount clears selection when the trim pops the selected note', () => {
		stepEntry.barCount = 4;
		setDuration('whole');
		addNote(0, 4, 'natural'); // 0: C4, bar 1
		addNote(2, 4, 'natural'); // 1: D4, bar 2
		addNote(4, 4, 'natural'); // 2: E4, bar 3
		expect(stepEntry.enteredNotes).toHaveLength(3);

		selectNote(2);
		expect(stepEntry.selectedNoteIndex).toBe(2);

		// Shrink the canvas to 2 bars — the third whole note is popped, and the
		// dangling selection must clear instead of pointing past the new end.
		setBarCount(2);
		expect(stepEntry.enteredNotes).toHaveLength(2);
		expect(stepEntry.selectedNoteIndex).toBe(null);
	});

	it('setBarCount preserves selection when the selected note survives the trim', () => {
		stepEntry.barCount = 4;
		setDuration('whole');
		addNote(0, 4, 'natural'); // 0: C4
		addNote(2, 4, 'natural'); // 1: D4
		addNote(4, 4, 'natural'); // 2: E4

		selectNote(0);
		setBarCount(2); // pops index 2 but leaves 0 and 1 intact
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});
});
