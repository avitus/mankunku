import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Note } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import {
	stepEntry,
	addNote,
	addRest,
	adjustSelectedNotePitch,
	deleteSelectedNote,
	enterTiedNote,
	getCurrentCursorOffset,
	reset,
	selectNote,
	selectPrev,
	setDuration,
	toggleDotted
} from '$lib/state/step-entry.svelte';
import {
	tuneEntry,
	initNewTune,
	cursorToBar,
	tuneAddNote,
	tuneAddRest,
	tuneDeleteSelected,
	tuneEnterTiedNote
} from '$lib/state/tune-entry.svelte';

/**
 * Characterization pin of the ENTRY flow — writing a line from scratch —
 * taken before the 2026-10-15 editing changes (delete-to-rest, in-place
 * replace). Entering a score worked; correcting one did not. Every edit to
 * the editors must leave this flow byte-identical: the just-entered element
 * is the "entry edge", and Backspace there removes what was typed last.
 *
 * Each step snapshots the buffer as `pitch @offset ×duration [~tied]` rows
 * plus the selection. A change in these values is a change to the entry
 * flow and needs its own decision, not a snapshot update.
 */

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
	value: {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
		removeItem: vi.fn((key: string) => { delete store[key]; }),
		clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
		get length() { return Object.keys(store).length; },
		key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
	},
	writable: true
});

function row(n: Note): string {
	return `${n.pitch ?? 'z'} @${n.offset[0]}/${n.offset[1]} ×${n.duration[0]}/${n.duration[1]}${n.tied ? ' ~' : ''}`;
}

function state(): { notes: string[]; selected: number | null } {
	return { notes: stepEntry.enteredNotes.map(row), selected: stepEntry.selectedNoteIndex };
}

describe('lick editor entry flow (step-entry)', () => {
	beforeEach(() => {
		settings.instrumentId = 'concert';
		reset();
		stepEntry.phraseKey = 'C';
		stepEntry.selectedOctave = 4;
		stepEntry.tripletMode = false;
		stepEntry.dottedMode = false;
		stepEntry.barCount = 4;
		setDuration('quarter');
	});

	it('types notes, rests and a tie, then backspaces the last entry', () => {
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			  ],
			  "selected": 1,
			}
		`);

		setDuration('eighth');
		addNote(4, 4, 'natural');
		addRest();
		expect(enterTiedNote()).toBe(false); // nothing to tie off a rest
		addNote(7, 4, 'natural');
		expect(enterTiedNote()).toBe(true);
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/8",
			    "z @5/8 ×1/8",
			    "67 @3/4 ×1/8 ~",
			    "67 @7/8 ×1/8",
			  ],
			  "selected": 5,
			}
		`);

		toggleDotted();
		addNote(9, 4, 'natural');
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/8",
			    "z @5/8 ×1/8",
			    "67 @3/4 ×1/8 ~",
			    "67 @7/8 ×1/8",
			    "69 @1/1 ×3/16",
			  ],
			  "selected": 6,
			}
		`);

		// Backspace right after typing removes the dotted A and steps back.
		deleteSelectedNote();
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/8",
			    "z @5/8 ×1/8",
			    "67 @3/4 ×1/8 ~",
			    "67 @7/8 ×1/8",
			  ],
			  "selected": null,
			}
		`);

		// A second Backspace removes the tied duplicate and clears the tie.
		deleteSelectedNote();
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/8",
			    "z @5/8 ×1/8",
			    "67 @3/4 ×1/8",
			  ],
			  "selected": null,
			}
		`);
	});

	it('nudges an earlier note by arrow and keeps typing at the end', () => {
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		addNote(4, 4, 'natural');
		selectPrev();
		selectPrev();
		adjustSelectedNotePitch(1);
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "61 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/4",
			  ],
			  "selected": 0,
			}
		`);

		// Escape, then type on: the new note appends after E.
		selectNote(null);
		addNote(5, 4, 'natural');
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "61 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/4",
			    "65 @3/4 ×1/4",
			  ],
			  "selected": 3,
			}
		`);

		// Backspace with no selection removes the last element, rest included.
		addRest();
		selectNote(null);
		deleteSelectedNote();
		deleteSelectedNote();
		expect(state()).toMatchInlineSnapshot(`
			{
			  "notes": [
			    "61 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "64 @1/2 ×1/4",
			  ],
			  "selected": null,
			}
		`);
	});
});

describe('tune editor entry flow (tune-entry wrappers)', () => {
	beforeEach(() => {
		settings.instrumentId = 'concert';
		stepEntry.tripletMode = false;
		stepEntry.dottedMode = false;
		initNewTune();
		setDuration('quarter');
	});

	/**
	 * The route's Backspace handler. Before 2026-10-15 it was
	 * `deleteSelectedNote(); clearEntryCursor();` — the snapshots below were
	 * taken under that code and must hold under `tuneDeleteSelected`.
	 */
	function routeDelete(): void {
		tuneDeleteSelected();
	}

	/** Where the next typed note lands — the armed cursor or the append edge. */
	function effectiveCursor(): string {
		const c = tuneEntry.entryCursor ?? getCurrentCursorOffset();
		return `${c[0]}/${c[1]}`;
	}

	function tuneState() {
		return {
			...state(),
			page: tuneEntry.currentPage,
			next: effectiveCursor(),
			stored: tuneEntry.sections[0].notes.map(row)
		};
	}

	it('appends, backspaces the last entry, then splits a whole note onto page 1', () => {
		tuneAddNote(0, 4, 'natural');
		tuneAddNote(2, 4, 'natural');
		tuneAddRest();
		tuneAddNote(4, 4, 'natural');
		expect(tuneState()).toMatchInlineSnapshot(`
			{
			  "next": "1/1",
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "z @1/2 ×1/4",
			    "64 @3/4 ×1/4",
			  ],
			  "page": 0,
			  "selected": 3,
			  "stored": [],
			}
		`);

		// Backspace right after typing: the E goes, the next note lands on beat 4.
		routeDelete();
		expect(tuneState()).toMatchInlineSnapshot(`
			{
			  "next": "3/4",
			  "notes": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "z @1/2 ×1/4",
			  ],
			  "page": 0,
			  "selected": null,
			  "stored": [],
			}
		`);

		// Four whole notes from beat 4 of bar 1: three fit the page, the fourth
		// overhangs it and splits with a tie onto page 1 (head committed to the
		// section, tail in the new buffer).
		setDuration('whole');
		tuneAddNote(5, 4, 'natural');
		tuneAddNote(5, 4, 'natural');
		tuneAddNote(5, 4, 'natural');
		tuneAddNote(5, 4, 'natural');
		expect(tuneState()).toMatchInlineSnapshot(`
			{
			  "next": "3/4",
			  "notes": [
			    "65 @0/1 ×3/4",
			  ],
			  "page": 1,
			  "selected": 0,
			  "stored": [
			    "60 @0/1 ×1/4",
			    "62 @1/4 ×1/4",
			    "z @1/2 ×1/4",
			    "65 @3/4 ×1/1",
			    "65 @7/4 ×1/1",
			    "65 @11/4 ×1/1",
			    "65 @15/4 ×1/4 ~",
			  ],
			}
		`);
	});

	it('enters at a clicked bar, ties, and backspaces there', () => {
		cursorToBar(0, 2, 0);
		tuneAddNote(0, 4, 'natural');
		tuneAddNote(2, 4, 'natural');
		expect(tuneEnterTiedNote()).toBe(true);
		expect(tuneState()).toMatchInlineSnapshot(`
			{
			  "next": "11/4",
			  "notes": [
			    "z @0/1 ×2/1",
			    "60 @2/1 ×1/4",
			    "62 @9/4 ×1/4 ~",
			    "62 @5/2 ×1/4",
			  ],
			  "page": 0,
			  "selected": 3,
			  "stored": [],
			}
		`);

		routeDelete();
		expect(tuneState()).toMatchInlineSnapshot(`
			{
			  "next": "5/2",
			  "notes": [
			    "z @0/1 ×2/1",
			    "60 @2/1 ×1/4",
			    "62 @9/4 ×1/4",
			  ],
			  "page": 0,
			  "selected": null,
			  "stored": [],
			}
		`);
	});
});
