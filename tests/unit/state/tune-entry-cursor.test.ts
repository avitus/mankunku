import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import type { Note } from '$lib/types/music';
import { settings } from '$lib/state/settings.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { fractionToFloat, addFractions, compareFractions } from '$lib/music/intervals';
import {
	stepEntry,
	addNote,
	selectNote,
	deleteSelectedNote,
	setDuration,
	toggleTriplet
} from '$lib/state/step-entry.svelte';
import {
	PAGE_BARS,
	tuneEntry,
	initNewTune,
	loadPage,
	commitBuffer,
	buildDraftTune,
	addSection,
	setSectionBars,
	loadFromTune,
	flattenedBufferBase,
	suspendEntryBuffer,
	resumeEntryBuffer,
	nextPagePosition,
	prevPagePosition,
	cursorToFlattened,
	cursorToBar,
	advanceToNextPage,
	retreatToPrevPage,
	selectNextAcrossPages,
	selectPrevAcrossPages,
	tuneAddNote,
	tuneAddRest,
	tuneEnterTiedNote,
	clearEntryCursor,
	entryCursorPosition
} from '$lib/state/tune-entry.svelte';

// ─── Mock localStorage (settings persist on write) ────────────────────
const store: Record<string, string> = {};
const localStorageMock = {
	getItem: vi.fn((key: string) => store[key] ?? null),
	setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
	removeItem: vi.fn((key: string) => { delete store[key]; }),
	clear: vi.fn(() => { for (const key of Object.keys(store)) delete store[key]; }),
	get length() { return Object.keys(store).length; },
	key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

beforeEach(() => {
	localStorageMock.clear();
	settings.instrumentId = 'concert';
	// Duration modifiers survive resetStepEntry — clear them explicitly so a
	// triplet/dotted test can't leak its mode into later tests.
	stepEntry.tripletMode = false;
	stepEntry.dottedMode = false;
	initNewTune();
});

// ─── Group 1: page-position walking ───────────────────────────────────

describe('nextPagePosition / prevPagePosition', () => {
	it('steps within a section', () => {
		// Default section: 8 bars → 2 pages.
		expect(nextPagePosition(0, 0)).toEqual({ sectionIdx: 0, pageIdx: 1 });
		expect(prevPagePosition(0, 1)).toEqual({ sectionIdx: 0, pageIdx: 0 });
	});

	it('crosses section boundaries in both directions', () => {
		addSection(); // B (8 bars)
		expect(nextPagePosition(0, 1)).toEqual({ sectionIdx: 1, pageIdx: 0 });
		expect(prevPagePosition(1, 0)).toEqual({ sectionIdx: 0, pageIdx: 1 });
	});

	it('counts a short last page as a full page position', () => {
		setSectionBars(0, 6); // pages: 0 (bars 0-3), 1 (bars 4-5)
		addSection(); // B
		expect(nextPagePosition(0, 0)).toEqual({ sectionIdx: 0, pageIdx: 1 });
		expect(nextPagePosition(0, 1)).toEqual({ sectionIdx: 1, pageIdx: 0 });
		expect(prevPagePosition(1, 0)).toEqual({ sectionIdx: 0, pageIdx: 1 });
	});

	it('returns null at both ends of the form', () => {
		expect(prevPagePosition(0, 0)).toBeNull();
		expect(nextPagePosition(0, 1)).toBeNull();
	});

	it('handles a single one-bar section', () => {
		setSectionBars(0, 1);
		expect(nextPagePosition(0, 0)).toBeNull();
		expect(prevPagePosition(0, 0)).toBeNull();
	});
});

describe('advanceToNextPage / retreatToPrevPage', () => {
	it('navigates and preserves un-committed buffer content', () => {
		addNote(0, 4, 'natural');
		expect(advanceToNextPage()).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		expect(tuneEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(1);
		expect(retreatToPrevPage()).toBe(true);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes.some((n) => n.pitch === 60)).toBe(true);
	});

	it('returns false at the ends of the form without moving', () => {
		expect(retreatToPrevPage()).toBe(false);
		expect(tuneEntry.currentPage).toBe(0);
		loadPage(0, 1);
		expect(advanceToNextPage()).toBe(false);
		expect(tuneEntry.currentPage).toBe(1);
	});
});

// ─── Group 2: cursorToFlattened ───────────────────────────────────────

function sheet(sections: Tune['sections'], timeSignature: [number, number] = [4, 4]): Tune {
	return {
		id: 'sheet-c-ursor',
		title: 'Cursor',
		key: 'C',
		timeSignature,
		tags: [],
		sections,
		source: 'user'
	};
}

describe('cursorToFlattened', () => {
	it('selects the correct buffer index for a same-page click', () => {
		addNote(0, 4, 'natural'); // C4 eighth
		addNote(2, 4, 'natural'); // D4
		addNote(4, 4, 'natural'); // E4
		expect(cursorToFlattened(1)).toBe(true);
		expect(tuneEntry.currentSection).toBe(0);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(stepEntry.enteredNotes[1].pitch).toBe(62);
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('commits a dirty buffer before a cross-page hop', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [4, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		addNote(2, 4, 'natural'); // dirty D4 at [1,4]
		expect(cursorToFlattened(2)).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		// The just-entered note survived the hop.
		const committed = tuneEntry.sections[0].notes;
		expect(committed.some((n) => n.pitch === 62 && compareFractions(n.offset, [1, 4]) === 0)).toBe(true);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(stepEntry.enteredNotes[0].pitch).toBe(64);
	});

	it('selects by offset on a sparse page with a synthesized leading rest', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 4], offset: [11, 2] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		// Buffer is [rest(1.5), note] — index arithmetic would pick 0.
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(stepEntry.enteredNotes[1].pitch).toBe(60);
	});

	it('hops across sections', () => {
		loadFromTune(sheet([
			{ label: 'A', bars: 4, notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }], harmony: [] },
			{ label: 'B', bars: 4, notes: [{ pitch: 64, duration: [1, 4], offset: [2, 1] }], harmony: [] }
		]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(1)).toBe(true);
		expect(tuneEntry.currentSection).toBe(1);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(1); // [rest(2), note]
		expect(stepEntry.enteredNotes[1].pitch).toBe(64);
	});

	it('navigates without selection or buffer content on non-4/4 sheets', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 65, duration: [1, 4], offset: [15, 4] } // bar 5 in 3/4
			],
			harmony: []
		}], [3, 4]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(1)).toBe(true);
		expect(tuneEntry.currentSection).toBe(0);
		expect(tuneEntry.currentPage).toBe(1); // bar 5 → page 1
		expect(stepEntry.enteredNotes).toEqual([]);
		expect(stepEntry.selectedNoteIndex).toBeNull();
	});

	it('returns false for a stale index without mutating navigation', () => {
		addNote(0, 4, 'natural');
		loadPage(0, 1);
		addNote(2, 4, 'natural'); // dirty on page 1
		expect(cursorToFlattened(99)).toBe(false);
		expect(cursorToFlattened(-1)).toBe(false);
		expect(tuneEntry.currentSection).toBe(0);
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes.some((n) => n.pitch === 62)).toBe(true);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});
});

// ─── Group 3: cursorToBar ─────────────────────────────────────────────

describe('cursorToBar', () => {
	it('sets the entry cursor on the current page and clears selection', () => {
		addNote(0, 4, 'natural'); // sets a selection
		cursorToBar(0, 1);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1, 9);
		cursorToBar(0, 2, 2);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(2.5, 9);
	});

	it('loads the target page before setting the page-local cursor', () => {
		cursorToBar(0, 5, 1); // bar 5 → page 1, local bar 1 beat 1
		expect(tuneEntry.currentPage).toBe(1);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1.25, 9);
	});

	it('clamps the bar into the section and the beat into the page window', () => {
		cursorToBar(0, 99); // 8-bar section → bar 7 → page 1, local bar 3
		expect(tuneEntry.currentPage).toBe(1);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(3, 9);
		cursorToBar(0, -3);
		expect(tuneEntry.currentPage).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0, 9);
		setSectionBars(0, 6); // page 1 window = 2 bars
		cursorToBar(0, 5, 7); // local bar 1 + 7 beats = 2.75 → clamp to window end 2
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(2, 9);
	});

	it('ignores an invalid section index', () => {
		cursorToBar(7, 0);
		expect(tuneEntry.currentSection).toBe(0);
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('navigates without a cursor on non-4/4 sheets', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }],
			harmony: []
		}], [3, 4]), INSTRUMENTS['concert']);
		cursorToBar(0, 5);
		expect(tuneEntry.currentPage).toBe(1);
		expect(tuneEntry.entryCursor).toBeNull();
		expect(stepEntry.enteredNotes).toEqual([]);
	});

	it('is cleared by loadPage and by suspend/resume', () => {
		cursorToBar(0, 1);
		expect(tuneEntry.entryCursor).not.toBeNull();
		loadPage(0, 1);
		expect(tuneEntry.entryCursor).toBeNull();
		cursorToBar(0, 2);
		expect(tuneEntry.entryCursor).not.toBeNull();
		suspendEntryBuffer();
		resumeEntryBuffer();
		expect(tuneEntry.entryCursor).toBeNull();
	});
});

// ─── Group 4: cursor-mode entry ───────────────────────────────────────

function assertPrefixSum(notes: Note[]): void {
	for (let i = 0; i + 1 < notes.length; i++) {
		expect(
			compareFractions(addFractions(notes[i].offset, notes[i].duration), notes[i + 1].offset)
		).toBe(0);
	}
}

describe('cursor-mode entry', () => {
	it('materializes one gap rest when inserting past the buffer content end', () => {
		setDuration('quarter');
		cursorToBar(0, 1, 2); // cursor at 1.5
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(stepEntry.enteredNotes).toHaveLength(2);
		expect(stepEntry.enteredNotes[0].pitch).toBeNull();
		expect(fractionToFloat(stepEntry.enteredNotes[0].duration)).toBeCloseTo(1.5, 9);
		expect(stepEntry.enteredNotes[1].pitch).toBe(60);
		expect(fractionToFloat(stepEntry.enteredNotes[1].offset)).toBeCloseTo(1.5, 9);
		assertPrefixSum(stepEntry.enteredNotes);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1.75, 9);
	});

	it('splices over a covering rest with exact remainders, later notes untouched', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: null, duration: [2, 1], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [2, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		setDuration('quarter');
		cursorToBar(0, 0, 2); // cursor at 0.5, mid-rest
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		const notes = stepEntry.enteredNotes;
		expect(notes).toHaveLength(4);
		expect(notes[0].pitch).toBeNull();
		expect(fractionToFloat(notes[0].duration)).toBeCloseTo(0.5, 9);
		expect(notes[1].pitch).toBe(60); // octave placed near the following E4
		expect(fractionToFloat(notes[1].offset)).toBeCloseTo(0.5, 9);
		expect(notes[2].pitch).toBeNull();
		expect(fractionToFloat(notes[2].offset)).toBeCloseTo(0.75, 9);
		expect(fractionToFloat(notes[2].duration)).toBeCloseTo(1.25, 9);
		// The later pitched note keeps its exact offset.
		expect(notes[3].pitch).toBe(64);
		expect(compareFractions(notes[3].offset, [2, 1])).toBe(0);
		assertPrefixSum(notes);
	});

	it('splices a triplet eighth over a covering rest with exact remainders', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: null, duration: [2, 1], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [2, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		setDuration('eighth');
		toggleTriplet(); // [1, 12]
		cursorToBar(0, 0, 2); // cursor at 0.5, mid-rest
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		const notes = stepEntry.enteredNotes;
		expect(notes).toHaveLength(4);
		expect(notes[0].pitch).toBeNull();
		expect(compareFractions(notes[0].duration, [1, 2])).toBe(0);
		expect(notes[1].pitch).toBe(60);
		expect(compareFractions(notes[1].offset, [1, 2])).toBe(0);
		expect(compareFractions(notes[1].duration, [1, 12])).toBe(0);
		// Trailing rest remainder is exact: 2 − 1/2 − 1/12 = 17/12 at 7/12.
		expect(notes[2].pitch).toBeNull();
		expect(compareFractions(notes[2].offset, [7, 12])).toBe(0);
		expect(compareFractions(notes[2].duration, [17, 12])).toBe(0);
		// The later pitched note keeps its exact offset.
		expect(notes[3].pitch).toBe(64);
		expect(compareFractions(notes[3].offset, [2, 1])).toBe(0);
		assertPrefixSum(notes);
	});

	it('blocks on a pitched collision with zero mutation', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: null, duration: [2, 1], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [2, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 1, 3); // cursor at 1.75
		setDuration('half'); // [1.75, 2.25) overlaps E4 at [2, 2.25)
		const before = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(before);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1.75, 9);
		expect(stepEntry.selectedNoteIndex).toBeNull();
	});

	it('blocks on a straddling imported note at section level', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			// Whole note at bar 3.5 overhangs the page-0 window into page 1.
			notes: [{ pitch: 62, duration: [1, 1], offset: [7, 2] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 4, 0); // page 1, cursor 0 — under the overhang
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes).toHaveLength(0); // straddler lives on page 0
		setDuration('quarter');
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0, 9);
	});

	it('advances the cursor without mutation on tuneAddRest', () => {
		cursorToBar(0, 0, 0);
		setDuration('half');
		expect(tuneAddRest()).toBe(true);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.5, 9);
	});

	it('keeps cursor mode alive across consecutive inserts', () => {
		setDuration('quarter');
		cursorToBar(0, 0);
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		const notes = stepEntry.enteredNotes;
		expect(notes).toHaveLength(2);
		expect(notes[1].pitch).toBe(62);
		expect(compareFractions(notes[1].offset, [1, 4])).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.5, 9);
	});

	it('clearEntryCursor returns to append mode', () => {
		cursorToBar(0, 1);
		clearEntryCursor();
		expect(tuneEntry.entryCursor).toBeNull();
		setDuration('quarter');
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		// Appended at the buffer cursor (0 on an empty page), not at bar 1.
		expect(compareFractions(stepEntry.enteredNotes[0].offset, [0, 1])).toBe(0);
	});

	it('reports the cursor position, falling back to the append cursor', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 0, beatInBar: 1 });
		cursorToBar(0, 5, 2);
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 5, beatInBar: 2 });
		loadFromTune(sheet([{ label: 'A', bars: 4, notes: [], harmony: [] }], [3, 4]),
			INSTRUMENTS['concert']);
		expect(entryCursorPosition()).toBeNull();
	});
});

// ─── Group 4b: section-end overhang guard ─────────────────────────────

/** Every committed note of section `sectionIdx` ends within the section span. */
function assertSectionWithinSpan(sectionIdx: number): void {
	const sec = tuneEntry.sections[sectionIdx];
	for (const n of sec.notes) {
		expect(compareFractions(addFractions(n.offset, n.duration), [sec.bars, 1]) <= 0).toBe(true);
	}
}

describe('cursor-mode section-end overhang guard', () => {
	it('rejects an insert that would overhang the section end, with zero mutation', () => {
		cursorToBar(0, 7, 2); // last window (bars 5-8), local cursor 3.5
		expect(tuneEntry.currentPage).toBe(1);
		setDuration('whole'); // would span [3.5, 4.5) — half a bar past the section
		const bufferBefore = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		const sectionsBefore = JSON.parse(JSON.stringify(tuneEntry.sections));
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(bufferBefore);
		expect(JSON.parse(JSON.stringify(tuneEntry.sections))).toEqual(sectionsBefore);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(3.5, 9);
		expect(stepEntry.selectedNoteIndex).toBeNull();
		commitBuffer();
		assertSectionWithinSpan(0);
	});

	it('rejects a tie that would overhang the section end, with zero mutation', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 2], offset: [7, 1] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 7, 2); // the C4 ends exactly at the cursor (local 3.5)
		setDuration('whole'); // tie would span [3.5, 4.5)
		const bufferBefore = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		expect(tuneEnterTiedNote()).toBe(false);
		// Zero mutation includes the would-be predecessor's tie flag.
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(bufferBefore);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(3.5, 9);
		commitBuffer();
		assertSectionWithinSpan(0);
	});

	it('rejects an overhang of a short last window', () => {
		setSectionBars(0, 6); // last window = bars 5-6 (2 bars)
		cursorToBar(0, 5, 3); // local cursor 1.75
		setDuration('half'); // would span [1.75, 2.25) — past the 2-bar window
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1.75, 9);
		commitBuffer();
		assertSectionWithinSpan(0);
	});

	it('accepts an insert ending exactly at the window end', () => {
		cursorToBar(0, 7, 2); // last window, local cursor 3.5
		setDuration('half'); // ends exactly at 4.0
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		const last = stepEntry.enteredNotes.at(-1)!;
		expect(last.pitch).toBe(60);
		expect(fractionToFloat(addFractions(last.offset, last.duration))).toBeCloseTo(4, 9);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(4, 9);
		commitBuffer();
		assertSectionWithinSpan(0);
	});

	it('accepts a tie ending exactly at the window end', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 2], offset: [7, 1] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 7, 2); // local cursor 3.5, prev C4 ends here
		setDuration('half'); // tie fills [3.5, 4.0) exactly
		expect(tuneEnterTiedNote()).toBe(true);
		const notes = stepEntry.enteredNotes;
		const prev = notes.find((n) => n.pitch === 60 && compareFractions(n.offset, [3, 1]) === 0)!;
		expect(prev.tied).toBe(true);
		const tail = notes.at(-1)!;
		expect(tail.pitch).toBe(60);
		expect(fractionToFloat(addFractions(tail.offset, tail.duration))).toBeCloseTo(4, 9);
		commitBuffer();
		assertSectionWithinSpan(0);
	});
});

// ─── Group 5: append-mode auto-advance ────────────────────────────────

/** Fill the current page exactly with whole-note C4s. */
function fillPageWithWholeNotes(bars: number): void {
	setDuration('whole');
	for (let i = 0; i < bars; i++) {
		expect(addNote(0, 4, 'natural')).toBe(true);
	}
}

describe('append-mode auto-advance', () => {
	it('rolls onto the next page at exact capacity, entering at its start', () => {
		fillPageWithWholeNotes(4);
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes).toHaveLength(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(62);
		expect(compareFractions(stepEntry.enteredNotes[0].offset, [0, 1])).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1, 9);
		// Page 0 was committed; the new note still lives in the page-1 buffer.
		expect(tuneEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(4);
		commitBuffer();
		expect(tuneEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(5);
	});

	it('rolls into a page with a later pickup note, entering at beat 0', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 64, duration: [1, 4], offset: [6, 1] }], // pickup at bar 6
			harmony: []
		}]), INSTRUMENTS['concert']);
		fillPageWithWholeNotes(4);
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		const notes = stepEntry.enteredNotes;
		expect(notes[0].pitch).toBe(60);
		expect(compareFractions(notes[0].offset, [0, 1])).toBe(0);
		// The pickup keeps its place after the note and the trimmed rest.
		expect(notes.at(-1)!.pitch).toBe(64);
		expect(compareFractions(notes.at(-1)!.offset, [2, 1])).toBe(0);
		assertPrefixSum(notes);
	});

	it('blocks the roll when the target start is occupied by a pitched note', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 64, duration: [1, 4], offset: [4, 1] }], // beat 0 of page 1
			harmony: []
		}]), INSTRUMENTS['concert']);
		fillPageWithWholeNotes(4);
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		// Navigation happened (spec: delegate to cursor-mode insertion there)…
		expect(tuneEntry.currentPage).toBe(1);
		// …but nothing was inserted over the pitched note.
		expect(stepEntry.enteredNotes.filter((n) => n.pitch !== null)).toHaveLength(1);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0, 9);
	});

	it('rolls across a section boundary', () => {
		setSectionBars(0, 4);
		addSection(); // B
		loadPage(0, 0);
		fillPageWithWholeNotes(4);
		expect(tuneAddNote(4, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentSection).toBe(1);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[0].pitch).toBe(64);
	});

	it('respects a short last page window', () => {
		setSectionBars(0, 6);
		addSection(); // B
		loadPage(0, 1); // 2-bar window
		fillPageWithWholeNotes(2);
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentSection).toBe(1);
		expect(tuneEntry.currentPage).toBe(0);
	});

	it('stops hard at the end of the form with zero mutation', () => {
		setSectionBars(0, 4);
		fillPageWithWholeNotes(4);
		const before = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		expect(tuneAddNote(0, 4, 'natural')).toBe(false);
		expect(tuneEntry.sections).toHaveLength(1);
		expect(tuneEntry.currentPage).toBe(0);
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(before);
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('hops a page-end cursor onto the next page before inserting', () => {
		setDuration('whole');
		cursorToBar(0, 3); // cursor at bar 3
		expect(tuneAddNote(0, 4, 'natural')).toBe(true); // fills to the window end
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(4, 9);
		expect(tuneAddNote(2, 4, 'natural')).toBe(true); // cursor at page end → hop
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(62);
		expect(compareFractions(stepEntry.enteredNotes[0].offset, [0, 1])).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1, 9);
	});
});

// ─── Group 6: split-with-tie ──────────────────────────────────────────

/** Fill the current page to 3.5 bars: three whole notes + one half note. */
function fillPageToThreeAndAHalfBars(): void {
	setDuration('whole');
	for (let i = 0; i < 3; i++) expect(addNote(0, 4, 'natural')).toBe(true);
	setDuration('half');
	expect(addNote(0, 4, 'natural')).toBe(true);
}

describe('split-with-tie on page overflow', () => {
	it('splits an overflowing note across the page boundary with a tie', () => {
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		// Head committed at 3.5, filling the page exactly, tied.
		const head = tuneEntry.sections[0].notes.find(
			(n) => compareFractions(n.offset, [7, 2]) === 0
		)!;
		expect(head.pitch).toBe(62);
		expect(head.duration).toEqual([1, 2]);
		expect(head.tied).toBe(true);
		// Tail on page 1: same concert pitch, the remainder, selected.
		expect(tuneEntry.currentPage).toBe(1);
		const tail = stepEntry.enteredNotes[0];
		expect(tail.pitch).toBe(62);
		expect(fractionToFloat(tail.duration)).toBeCloseTo(0.5, 9);
		expect(compareFractions(tail.offset, [0, 1])).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.5, 9);
	});

	it('leaves the committed section contiguous across the boundary', () => {
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		commitBuffer();
		const notes = tuneEntry.sections[0].notes;
		assertPrefixSum(notes);
		const headIdx = notes.findIndex((n) => compareFractions(n.offset, [7, 2]) === 0);
		expect(notes[headIdx].tied).toBe(true);
		expect(notes[headIdx + 1].pitch).toBe(62);
		expect(compareFractions(notes[headIdx + 1].offset, [4, 1])).toBe(0);
	});

	it('splits across a section boundary', () => {
		setSectionBars(0, 4);
		addSection(); // B
		loadPage(0, 0);
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentSection).toBe(1);
		expect(tuneEntry.currentPage).toBe(0);
		const head = tuneEntry.sections[0].notes.find(
			(n) => compareFractions(n.offset, [7, 2]) === 0
		)!;
		expect(head.tied).toBe(true);
		const tail = stepEntry.enteredNotes[0];
		expect(tail.pitch).toBe(62);
		commitBuffer();
		expect(tuneEntry.sections[1].notes[0].pitch).toBe(62);
		expect(head.tied).toBe(true); // survives the commit sweep
	});

	it('blocks an end-of-form split entirely pre-mutation', () => {
		setSectionBars(0, 4);
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		const before = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		expect(tuneAddNote(2, 4, 'natural')).toBe(false);
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(before);
		expect(tuneEntry.currentPage).toBe(0);
		expect(tuneEntry.sections[0].notes).toHaveLength(0); // nothing committed
	});

	it('blocks a split whose tail would land on a pitched note, pre-navigation', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 64, duration: [1, 4], offset: [4, 1] }], // beat 0 of page 1
			harmony: []
		}]), INSTRUMENTS['concert']);
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		const before = JSON.parse(JSON.stringify(stepEntry.enteredNotes));
		expect(tuneAddNote(2, 4, 'natural')).toBe(false);
		expect(tuneEntry.currentPage).toBe(0); // no navigation
		expect(JSON.parse(JSON.stringify(stepEntry.enteredNotes))).toEqual(before);
	});

	it('rolls tuneEnterTiedNote across the boundary as head + tail', () => {
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneEnterTiedNote()).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		const committed = tuneEntry.sections[0].notes;
		const prev = committed.find((n) => compareFractions(n.offset, [3, 1]) === 0)!;
		const head = committed.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(prev.pitch).toBe(60);
		expect(prev.tied).toBe(true);
		expect(head.pitch).toBe(60);
		expect(head.duration).toEqual([1, 2]);
		expect(head.tied).toBe(true);
		const tail = stepEntry.enteredNotes[0];
		expect(tail.pitch).toBe(60);
		expect(fractionToFloat(tail.duration)).toBeCloseTo(0.5, 9);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.5, 9);
	});

	it('ties at the cursor only off a note ending exactly there', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 2], offset: [0, 1] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		setDuration('quarter');
		cursorToBar(0, 1); // nothing ends at bar 1
		expect(tuneEnterTiedNote()).toBe(false);
		cursorToBar(0, 0, 2); // the C4 half note ends exactly here
		expect(tuneEnterTiedNote()).toBe(true);
		const notes = stepEntry.enteredNotes;
		expect(notes[0].tied).toBe(true);
		expect(notes[1].pitch).toBe(60);
		expect(compareFractions(notes[1].offset, [1, 2])).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.75, 9);
	});
});

// ─── Group 7: tie sanitization on commit ──────────────────────────────

describe('tie sanitization on commit', () => {
	function splitWholeNoteAcrossPages(): void {
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
	}

	it('keeps a legitimate cross-page tie through commit/reload round-trips', () => {
		splitWholeNoteAcrossPages();
		commitBuffer(); // tail committed
		loadPage(0, 0);
		loadPage(0, 1);
		const head = tuneEntry.sections[0].notes.find(
			(n) => compareFractions(n.offset, [7, 2]) === 0
		)!;
		expect(head.tied).toBe(true);
	});

	it('clears a dangling head tie once the tail is deleted', () => {
		splitWholeNoteAcrossPages();
		deleteSelectedNote(); // the tail is selected post-split
		commitBuffer();
		const head = tuneEntry.sections[0].notes.find(
			(n) => compareFractions(n.offset, [7, 2]) === 0
		)!;
		expect(head.tied).toBeFalsy();
	});

	it('clears a tie whose boundary successor changed pitch', () => {
		splitWholeNoteAcrossPages();
		deleteSelectedNote();
		clearEntryCursor();
		setDuration('half');
		expect(addNote(4, 4, 'natural')).toBe(true); // E4 replaces the D tail
		commitBuffer();
		const head = tuneEntry.sections[0].notes.find(
			(n) => compareFractions(n.offset, [7, 2]) === 0
		)!;
		expect(head.tied).toBeFalsy();
	});
});

// ─── Group 8: cross-page selection stepping ───────────────────────────

describe('selectNextAcrossPages / selectPrevAcrossPages', () => {
	it('delegates within the buffer', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		selectNote(0);
		selectNextAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(1);
		selectPrevAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(tuneEntry.currentPage).toBe(0); // never left the page
	});

	it('preserves the null-selection fallbacks', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		selectNote(null);
		selectNextAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(0); // start-at-0 fallback
		selectNote(null);
		selectPrevAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(1); // select-last fallback
	});

	it('stepping the selection drops a live entry cursor', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		cursorToBar(0, 2); // arms the cursor, clears selection
		expect(tuneEntry.entryCursor).not.toBeNull();
		selectNextAcrossPages(); // delegates into the buffer
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('hops across the page boundary in both directions', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [5, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		selectNextAcrossPages();
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
		selectPrevAcrossPages(); // on the buffer's first pitched note → cross back
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(60);
	});

	it('skips an entirely empty middle page', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 12,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [8, 1] } // page 2
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		selectNextAcrossPages();
		expect(tuneEntry.currentPage).toBe(2);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
		selectPrevAcrossPages();
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(60);
	});

	it('skips an empty section', () => {
		loadFromTune(sheet([
			{ label: 'A', bars: 4, notes: [{ pitch: 60, duration: [1, 4], offset: [0, 1] }], harmony: [] },
			{ label: 'B', bars: 4, notes: [], harmony: [] },
			{ label: 'C', bars: 4, notes: [{ pitch: 64, duration: [1, 4], offset: [0, 1] }], harmony: [] }
		]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		selectNextAcrossPages();
		expect(tuneEntry.currentSection).toBe(2);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
		selectPrevAcrossPages();
		expect(tuneEntry.currentSection).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(60);
	});

	it('no-ops at the first and last pitched notes of the tune', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		selectNote(0);
		selectNextAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(tuneEntry.currentPage).toBe(0);
		selectPrevAcrossPages();
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(tuneEntry.currentPage).toBe(0);
	});

	it('no-ops on non-4/4 sheets', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [3, 1] }
			],
			harmony: []
		}], [3, 4]), INSTRUMENTS['concert']);
		selectNextAcrossPages();
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(stepEntry.enteredNotes).toEqual([]);
	});
});

// ─── Group 9: invariants ──────────────────────────────────────────────

describe('cursor-layer invariants', () => {
	it('double commits are idempotent', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		addNote(2, 4, 'natural');
		// cursorToFlattened commits, then its loadPage commits again.
		expect(cursorToFlattened(0)).toBe(true);
		const snapshot = JSON.stringify(tuneEntry.sections);
		commitBuffer();
		expect(JSON.stringify(tuneEntry.sections)).toBe(snapshot);
	});

	it('suspend leaves the shared buffer clean; resume clears a live cursor', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		cursorToBar(0, 2, 1);
		expect(tuneEntry.entryCursor).not.toBeNull();
		suspendEntryBuffer();
		expect(stepEntry.enteredNotes).toEqual([]);
		expect(stepEntry.transpositionOverride).toBeNull();
		resumeEntryBuffer();
		expect(tuneEntry.entryCursor).toBeNull();
		expect(stepEntry.enteredNotes.filter((n) => n.pitch !== null)).toHaveLength(1);
	});

	it('keeps flattenedBufferBase + selection aligned with the draft after a hop', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 60, duration: [1, 4], offset: [11, 2] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		// The buffer gained a synthesized leading rest; the draft (what the
		// preview renders) must agree with base + selection.
		const draftFlat = buildDraftTune().sections.flatMap((s) => s.notes);
		const idx = flattenedBufferBase() + stepEntry.selectedNoteIndex!;
		expect(draftFlat[idx].pitch).toBe(60);
		expect(compareFractions(draftFlat[idx].offset, [11, 2])).toBe(0);
	});

	it('a range reject in append mode causes no navigation', () => {
		// With capacity available: plain delegation reject.
		setDuration('quarter');
		expect(tuneAddNote(0, 8, 'natural')).toBe(false); // C8 written, out of range
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		// On the split path: page 3.5 bars of rests (no octave reference), then
		// an out-of-range overflow note — rejected before any navigation.
		setDuration('whole');
		for (let i = 0; i < 3; i++) expect(tuneAddRest()).toBe(true);
		setDuration('half');
		expect(tuneAddRest()).toBe(true);
		setDuration('whole');
		expect(tuneAddNote(0, 8, 'natural')).toBe(false);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes).toHaveLength(4); // no head was pushed
	});
});
