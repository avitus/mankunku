import { describe, it, expect, beforeEach } from 'vitest';
import type { Note } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import {
	stepEntry,
	addNote,
	addRest,
	adjustSelectedNotePitch,
	clearClipboard,
	copySelection,
	deleteSelectedNote,
	extendSelection,
	pasteClipboard,
	rangeBounds,
	removeSelectedTime,
	repeatSelection,
	reset,
	selectNote,
	selectRangeTo,
	setDuration
} from '$lib/state/step-entry.svelte';

/**
 * Range selection (phase 5, 2026-10-16) — MuseScore's range: Shift+←/→ or
 * Shift+click extends the selection from its anchor; Delete turns the whole
 * passage into rests (merged, so the engraving regroups them by the meter);
 * Ctrl/⌘+Backspace removes the passage and its time; ↑/↓ transpose it;
 * Ctrl/⌘+C / V copy and paste it (overwriting from the selection's start,
 * or appending with no selection); R repeats it right after itself.
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
	clearClipboard(); // the clipboard outlives reset() on purpose: a lick can be pasted into another
});

/** C D E G | A B — six quarters. */
function sixQuarters(): void {
	for (const pc of [0, 2, 4, 7, 9, 11]) addNote(pc, 4, 'natural');
}

describe('extending the selection', () => {
	it('Shift+→ grows the range from the anchor, Shift+← shrinks it back and past the anchor, both clamp', () => {
		sixQuarters();
		selectNote(2); // E
		expect(rangeBounds()).toBeNull();
		extendSelection(1);
		expect(rangeBounds()).toEqual({ start: 2, end: 3 });
		extendSelection(1);
		extendSelection(1);
		extendSelection(1);
		expect(rangeBounds()).toEqual({ start: 2, end: 5 }); // clamped at the end
		for (let i = 0; i < 5; i++) extendSelection(-1);
		expect(rangeBounds()).toEqual({ start: 0, end: 2 }); // past the anchor, clamped at the start
		expect(stepEntry.selectionMode).toBe('edit');
	});

	it('with no selection Shift+→ starts a range at the first element', () => {
		sixQuarters();
		selectNote(null);
		extendSelection(1);
		expect(rangeBounds()).toEqual({ start: 0, end: 1 });
	});

	it('Shift+click extends to the clicked element; a plain select or Esc drops the range', () => {
		sixQuarters();
		selectNote(1);
		selectRangeTo(4);
		expect(rangeBounds()).toEqual({ start: 1, end: 4 });
		selectRangeTo(0);
		expect(rangeBounds()).toEqual({ start: 0, end: 1 });
		selectNote(3);
		expect(rangeBounds()).toBeNull();
		selectRangeTo(5);
		selectNote(null);
		expect(rangeBounds()).toBeNull();
		expect(stepEntry.selectionEnd).toBeNull();
	});
});

describe('Delete and Ctrl/⌘+Backspace on a range', () => {
	it('Delete turns the passage into rests, one per note so each stays selectable, and selects the first', () => {
		sixQuarters();
		selectNote(1);
		extendSelection(1);
		extendSelection(1); // D E G
		deleteSelectedNote();
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', 'z @1/2 ×1/4', 'z @3/4 ×1/4', '69 @1/1 ×1/4', '71 @5/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(rangeBounds()).toBeNull();
	});

	it('Delete on a range that reaches the end still leaves rests (no entry-edge removal)', () => {
		sixQuarters();
		selectNote(4);
		extendSelection(1); // A B
		deleteSelectedNote();
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4', 'z @1/1 ×1/4', 'z @5/4 ×1/4']);
	});

	it('Ctrl/⌘+Backspace removes the passage and its time; what follows slides in and is selected', () => {
		sixQuarters();
		selectNote(1);
		extendSelection(1); // D E
		removeSelectedTime();
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '67 @1/4 ×1/4', '69 @1/2 ×1/4', '71 @3/4 ×1/4']);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(rangeBounds()).toBeNull();
	});
});

describe('transposing a range', () => {
	it('↑ moves every pitched note in the range and leaves the rests alone', () => {
		addNote(0, 4, 'natural');
		addRest();
		addNote(4, 4, 'natural');
		addNote(7, 4, 'natural');
		selectNote(0);
		extendSelection(1);
		extendSelection(1);
		adjustSelectedNotePitch(1);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([61, null, 65, 67]);
		expect(rangeBounds()).toEqual({ start: 0, end: 2 });
	});

	it('refuses the whole move when one note would leave the written range', () => {
		stepEntry.enteredNotes = [
			{ pitch: 60, duration: [1, 4], offset: [0, 1] },
			{ pitch: 89, duration: [1, 4], offset: [1, 4] } // F6, the ceiling
		];
		selectNote(0);
		extendSelection(1);
		adjustSelectedNotePitch(1);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 89]);
	});
});

describe('copy, paste and repeat', () => {
	it('pastes the copied passage from the selection\'s start, overwriting, offsets and rests kept, and selects what it pasted', () => {
		addNote(0, 4, 'natural');
		addRest();
		setDuration('eighth');
		addNote(4, 4, 'natural');
		addNote(7, 4, 'natural'); // C z E♪ G♪ — then room for more
		setDuration('quarter');
		addNote(9, 4, 'natural');
		addNote(11, 4, 'natural');
		selectNote(0);
		extendSelection(1);
		extendSelection(1);
		extendSelection(1); // C z E G
		expect(copySelection()).toBe(true);
		selectNote(4); // A
		expect(pasteClipboard()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual([
			'60 @0/1 ×1/4', 'z @1/4 ×1/4', '64 @1/2 ×1/8', '67 @5/8 ×1/8',
			'60 @3/4 ×1/4', 'z @1/1 ×1/4', '64 @5/4 ×1/8', '67 @11/8 ×1/8'
		]);
		expect(rangeBounds()).toEqual({ start: 4, end: 7 });
	});

	it('pastes what fits when the clipboard runs past the end of the bars', () => {
		stepEntry.barCount = 1;
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		addNote(4, 4, 'natural');
		selectNote(0);
		extendSelection(1);
		extendSelection(1);
		copySelection();
		selectNote(2); // E, at beat 3: only two quarters fit
		expect(pasteClipboard()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '60 @1/2 ×1/4', '62 @3/4 ×1/4']);
	});

	it('with no selection, paste appends at the end; with nothing copied it does nothing', () => {
		addNote(0, 4, 'natural');
		expect(pasteClipboard()).toBe(false);
		selectNote(0);
		copySelection();
		selectNote(null);
		expect(pasteClipboard()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '60 @1/4 ×1/4']);
	});

	it('R repeats the selection right after itself and selects the copy', () => {
		addNote(0, 4, 'natural');
		addNote(4, 4, 'natural');
		selectNote(0);
		extendSelection(1);
		expect(repeatSelection()).toBe(true);
		expect(rows(stepEntry.enteredNotes)).toEqual(['60 @0/1 ×1/4', '64 @1/4 ×1/4', '60 @1/2 ×1/4', '64 @3/4 ×1/4']);
		expect(rangeBounds()).toEqual({ start: 2, end: 3 });
		selectNote(3);
		expect(repeatSelection()).toBe(true); // a single note repeats too
		expect(stepEntry.enteredNotes).toHaveLength(5);
		expect(stepEntry.selectedNoteIndex).toBe(4);
	});

	it('R is refused when nothing is selected or the copy would not fit', () => {
		stepEntry.barCount = 1;
		setDuration('half');
		addNote(0, 4, 'natural');
		addNote(4, 4, 'natural');
		selectNote(null);
		expect(repeatSelection()).toBe(false);
		selectNote(1);
		expect(repeatSelection()).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(2);
	});
});

describe('letters on a range', () => {
	it('a letter re-pitches the first note of the range and drops the range', () => {
		sixQuarters();
		selectNote(1);
		extendSelection(1);
		expect(addNote(5, 4, 'natural')).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 65, 64, 67, 69, 71]);
		expect(rangeBounds()).toBeNull();
		expect(stepEntry.selectedNoteIndex).toBe(2);
	});
});
