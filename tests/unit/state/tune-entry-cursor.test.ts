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
	selectNext,
	toggleTriplet,
	toggleInsertMode,
	extendSelection,
	rangeBounds
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
	entryCursorPosition,
	tuneDeleteSelected,
	tuneRemoveSelectedTime,
	setTunePickup,
	setChord,
	selectBarAcrossPages,
	selectFirstInSection,
	selectLastInSection,
	insertBar,
	deleteBar,
	selectRangeToFlattened,
	tuneSelectGap
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

	it('addresses a stored rest by flattened index', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: null, duration: [1, 1], offset: [4, 1] },
				{ pitch: 64, duration: [1, 4], offset: [5, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(1)).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(stepEntry.enteredNotes[0].pitch).toBeNull();
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

	// 2026-10-15 (phase 2 of the score-editing plan): ONE write policy — note
	// input overwrites what sits at the cursor, pitched notes included
	// (MuseScore). These two pins replaced "blocks on a pitched collision" and
	// "blocks on a straddling imported note", the 2026-07-26 refusals.
	it('overwrites a pitched note the new span covers', () => {
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
		setDuration('half'); // [1.75, 2.25) covers E4 at [2, 2.25)
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		const notes = stepEntry.enteredNotes;
		expect(notes.map((n) => n.pitch)).toEqual([null, 60]);
		expect(compareFractions(notes[0].duration, [7, 4])).toBe(0);
		expect(compareFractions(notes[1].offset, [7, 4])).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(2.25, 9);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		assertPrefixSum(notes);
	});

	it('trims a note straddling in from the previous page when one is written under it', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			// Whole note at bar 3.5 overhangs the page-0 window into page 1.
			notes: [{ pitch: 62, duration: [1, 1], offset: [7, 2] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 4, 0); // page 1, cursor 0 — under the overhang
		expect(tuneEntry.currentPage).toBe(1);
		setDuration('quarter');
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60]);
		// The draft (what the chart shows) and the committed section agree: the
		// straddler ends where the new note begins.
		// (Page 0's leading gap rest was stored when the bar click committed it;
		// only the pitched notes are compared.)
/** Pitched notes as [pitch, offset, duration] floats. */
		const shape = (notes: Note[]) => notes.filter((n) => n.pitch !== null).map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)]);
		expect(shape(buildDraftTune().sections[0].notes)).toEqual([[62, 3.5, 0.5], [60, 4, 0.25]]);
		commitBuffer();
		expect(shape(tuneEntry.sections[0].notes)).toEqual([[62, 3.5, 0.5], [60, 4, 0.25]]);
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

	it('the roll overwrites a pitched note at the target start (2026-10-15, one write policy)', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 64, duration: [1, 4], offset: [4, 1] }], // beat 0 of page 1
			harmony: []
		}]), INSTRUMENTS['concert']);
		fillPageWithWholeNotes(4);
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		// The whole note covers the quarter E4 at beat 0: the E is gone.
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60]);
		expect(compareFractions(stepEntry.enteredNotes[0].duration, [1, 1])).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(1, 9);
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

	it('a split tail overwrites the pitched note it lands on (2026-10-15, one write policy)', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 64, duration: [1, 4], offset: [4, 1] }], // beat 0 of page 1
			harmony: []
		}]), INSTRUMENTS['concert']);
		fillPageToThreeAndAHalfBars();
		setDuration('whole');
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		// The half-note tail covers the quarter E4 at beat 0: the E is gone and
		// the head on page 0 is tied into the tail.
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([62]);
		expect(compareFractions(stepEntry.enteredNotes[0].duration, [1, 2])).toBe(0);
		const head = tuneEntry.sections[0].notes.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(head.pitch).toBe(62);
		expect(head.tied).toBe(true);
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

	it('hops across the page boundary in both directions, stopping on gap rests', () => {
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
		// First press stops on the synthesized leading gap rest (bar 4→5),
		// MuseScore-style — same page.
		selectPrevAcrossPages();
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.selectedNoteIndex).toBe(0);
		expect(stepEntry.enteredNotes[0].pitch).toBeNull();
		// Second press crosses back to page 0.
		selectPrevAcrossPages();
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(60);
	});

	it('cross-page hop lands on a stored rest', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: null, duration: [1, 1], offset: [4, 1] },
				{ pitch: 64, duration: [1, 4], offset: [5, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(cursorToFlattened(0)).toBe(true);
		selectNextAcrossPages();
		// The stored whole-bar rest at bar 4 is a real flattened element — the
		// hop navigates to page 1 and selects it (slash bars render without a
		// click anchor, so arrow keys are how this element is reached).
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBeNull();
		selectNextAcrossPages();
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
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

// ─── Group 9: tune-level delete (2026-10-15) ──────────────────────────

describe('tuneDeleteSelected / tuneRemoveSelectedTime', () => {
	/** A: C D E G in bar 1, F on bar 5 (page 1), A on bar 6; a chord on bar 6. */
	function twoPageSheet(withRest = false): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: withRest ? null : 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [1, 2] },
				{ pitch: 67, duration: [1, 4], offset: [3, 4] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] },
				{ pitch: 69, duration: [1, 4], offset: [5, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(setChord(0, 5, 0, 'C7')).toBe(true);
	}

/** Section 0's stored notes as `pitch @offset ×duration` rows. */
	function storedRows(): string[] {
		return tuneEntry.sections[0].notes.map(
			(n) => `${n.pitch ?? 'z'} @${n.offset[0]}/${n.offset[1]} ×${n.duration[0]}/${n.duration[1]}`
		);
	}

	it('turns a note before the section end into a rest; nothing on this or a later page moves', () => {
		twoPageSheet();
		expect(cursorToFlattened(1)).toBe(true); // D
		expect(tuneDeleteSelected()).toBe('rested');
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, null, 64, 67]);
		expect(stepEntry.enteredNotes[1].offset).toEqual([1, 4]);
		expect(stepEntry.enteredNotes[1].duration).toEqual([1, 4]);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(stepEntry.selectionMode).toBe('edit');
		// The selected rest IS the position: the rail reads it and typing fills it.
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 0, beatInBar: 1 });
		commitBuffer();
		expect(storedRows()).toEqual([
			'60 @0/1 ×1/4', 'z @1/4 ×1/4', '64 @1/2 ×1/4', '67 @3/4 ×1/4', '65 @4/1 ×1/4', '69 @5/1 ×1/4'
		]);
	});

	it('typing after Delete→rest replaces the rest, not the end of the page', () => {
		twoPageSheet();
		cursorToFlattened(1);
		tuneDeleteSelected();
		setDuration('quarter');
		expect(tuneAddNote(9, 4, 'natural')).toBe(true); // A
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 69, 64, 67]);
		expect(stepEntry.enteredNotes[1].offset).toEqual([1, 4]);
	});

	it('removes a rest\'s time across the page boundary, leaving the section tail silent and the chords in place', () => {
		twoPageSheet(true);
		expect(cursorToFlattened(1)).toBe(true); // the stored rest
		expect(tuneDeleteSelected()).toBe('removed');
		expect(storedRows()).toEqual([
			'60 @0/1 ×1/4', '64 @1/4 ×1/4', '67 @1/2 ×1/4', '65 @15/4 ×1/4', '69 @19/4 ×1/4'
		]);
		expect(tuneEntry.sections[0].harmony[0].startOffset).toEqual([5, 1]);
		expect(tuneEntry.sections[0].bars).toBe(8);
		// Reloaded page 0: the E that slid into the slot is selected, no bar cursor.
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(stepEntry.enteredNotes[1].pitch).toBe(64);
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('removes a selected note\'s time on Ctrl/⌘+Backspace, section-wide', () => {
		twoPageSheet();
		cursorToFlattened(1); // D
		expect(tuneRemoveSelectedTime()).toBe('removed');
		expect(storedRows()).toEqual([
			'60 @0/1 ×1/4', '64 @1/4 ×1/4', '67 @1/2 ×1/4', '65 @15/4 ×1/4', '69 @19/4 ×1/4'
		]);
	});

	it('removes the section\'s last element outright — the entry flow\'s Backspace', () => {
		setDuration('quarter');
		tuneAddNote(0, 4, 'natural');
		tuneAddNote(2, 4, 'natural');
		expect(tuneDeleteSelected()).toBe('removed');
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60]);
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(tuneEntry.entryCursor).toBeNull();
	});

	it('refuses a no-selection Backspace on a page that is not the section\'s end', () => {
		twoPageSheet();
		cursorToFlattened(0);
		selectNote(null);
		expect(tuneDeleteSelected()).toBe('no-selection');
		expect(stepEntry.enteredNotes).toHaveLength(4);
		expect(storedRows()).toHaveLength(6);
	});

	it('refuses to remove the pickup lead-in rest', () => {
		setTunePickup([1, 4]); // a one-bar pickup section with a 3/4 lead-in rest
		loadPage(0, 0);
		expect(stepEntry.enteredNotes[0].pitch).toBeNull();
		selectNote(0);
		expect(tuneDeleteSelected()).toBe('lead-in');
		expect(tuneRemoveSelectedTime()).toBe('lead-in');
		expect(stepEntry.enteredNotes[0].duration).toEqual([3, 4]);
		expect(tuneEntry.sections[0].pickupLength).toEqual([1, 4]);
	});

	it('deleting the only note of a bar clears the selection and parks the cursor at the bar (slash bars have no anchor)', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [1, 1] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		// The first page load stores its synthesized gap rest on commit, so E is
		// found by pitch rather than by a fixed flattened index.
		commitBuffer();
		cursorToFlattened(tuneEntry.sections[0].notes.findIndex((n) => n.pitch === 64)); // E, alone in bar 2
		expect(tuneDeleteSelected()).toBe('rested');
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(tuneEntry.entryCursor).toEqual([1, 1]);
		const rest = stepEntry.enteredNotes.find((n) => compareFractions(n.offset, [1, 1]) === 0)!;
		expect(rest.pitch).toBeNull();
	});
});

// ─── Group 10: edit selection in the tune editor (2026-10-15, phase 2) ────

describe('edit selection: position, re-pitch, resize', () => {
/** C D E G in bar 1 and an F on bar 5 (page 1). */
	function fourQuartersAndMore(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [1, 2] },
				{ pitch: 67, duration: [1, 4], offset: [3, 4] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
	}

	it('a clicked note is the position the rail reads, and its duration becomes current', () => {
		fourQuartersAndMore();
		setDuration('whole');
		expect(cursorToFlattened(2)).toBe(true); // E at beat 3
		expect(stepEntry.selectionMode).toBe('edit');
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 0, beatInBar: 2 });
		expect(stepEntry.currentDuration).toBe('quarter');
		// Esc: back to the bar cursor / append edge.
		selectNote(null);
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 1, beatInBar: 0 });
	});

	it('a letter on a clicked note replaces it in place and the selection moves on', () => {
		fourQuartersAndMore();
		cursorToFlattened(1); // D
		expect(tuneAddNote(5, 4, 'natural')).toBe(true); // F
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 65, 64, 67]);
		expect(compareFractions(stepEntry.enteredNotes[2].offset, [1, 2])).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(2);
		expect(stepEntry.selectionMode).toBe('edit');
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 0, beatInBar: 2 });
		// The later page is untouched.
		commitBuffer();
		expect(tuneEntry.sections[0].notes.at(-1)).toMatchObject({ pitch: 65, offset: [4, 1] });
	});

	it('a duration key on a clicked note resizes it in place', () => {
		fourQuartersAndMore();
		cursorToFlattened(0); // C
		expect(setDuration('half')).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 64, 67]);
		expect(compareFractions(stepEntry.enteredNotes[0].duration, [1, 2])).toBe(0);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});

	it('0 on a clicked note rests it; + on a clicked note ties it into what follows', () => {
		fourQuartersAndMore();
		cursorToFlattened(2); // E
		expect(tuneAddRest()).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 62, null, 67]);
		cursorToFlattened(1); // D (the flattened index is stable: the rest is stored)
		expect(tuneEnterTiedNote()).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 62, 62, 67]);
		expect(stepEntry.enteredNotes[1].tied).toBe(true);
	});

	it('replacing the clicked last note of a page hands over to the append edge', () => {
		setDuration('quarter');
		tuneAddNote(0, 4, 'natural');
		tuneAddNote(2, 4, 'natural');
		commitBuffer();
		cursorToFlattened(1);
		expect(tuneAddNote(4, 4, 'natural')).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 64]);
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 0, beatInBar: 2 });
	});
});

// ─── Group 11: bar-wise and whole-section navigation (phase 3) ────────────

describe('selectBarAcrossPages / selectFirstInSection / selectLastInSection', () => {
/** Notes in bars 1, 4, 5 and 7 of an 8-bar section, with silent bars between. */
	function twoPages(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [3, 1] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] },
				{ pitch: 67, duration: [1, 4], offset: [6, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
	}

	/** Select a stored note by pitch: the first commit stores page 0's gap rest, so fixed flattened indices drift. */
	function selectPitch(pitch: number): void {
		commitBuffer();
		cursorToFlattened(tuneEntry.sections[0].notes.findIndex((n) => n.pitch === pitch));
	}

	it('Ctrl/⌘+→ crosses the page boundary to the next bar\'s first element', () => {
		twoPages();
		selectPitch(64); // E, bar 4 (page 0)
		selectBarAcrossPages(1);
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(65); // F, bar 5
		selectBarAcrossPages(-1);
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
	});

	it('an empty bar arms the bar cursor there instead of selecting', () => {
		twoPages();
		cursorToFlattened(1); // D, bar 1
		selectBarAcrossPages(1); // bar 2 is silent
		expect(stepEntry.selectedNoteIndex).toBeNull();
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 1, beatInBar: 0 });
		selectBarAcrossPages(1); // bar 3, silent too
		expect(entryCursorPosition()).toEqual({ sectionIdx: 0, barInSection: 2, beatInBar: 0 });
		selectBarAcrossPages(1); // bar 4: E
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(64);
	});

	it('Home and End reach the section\'s first and last element across pages', () => {
		twoPages();
		selectPitch(65); // F on page 1
		selectFirstInSection();
		expect(tuneEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(60);
		selectLastInSection();
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(67);
	});
});

// ─── Group 12: phase 4 — insert with push, cursor split, bar operations ───

describe('insert mode in the tune editor', () => {
/** C D E in bar 1, F on bar 5, G on the section's last beat, a chord on bar 5. */
	function twoPageLine(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [1, 2] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] },
				{ pitch: 67, duration: [1, 4], offset: [31, 4] } // the section's last beat
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(setChord(0, 4, 0, 'F7')).toBe(true);
	}

/** Section 0's pitched notes as [pitch, offset]. */
	function stored(): [number | null, number][] {
		return tuneEntry.sections[0].notes.filter((n) => n.pitch !== null).map((n) => [n.pitch, fractionToFloat(n.offset)]);
	}

	it('a letter at a clicked note inserts before it and pushes the SECTION later, across pages; chords stay', () => {
		twoPageLine();
		// Make room first: the line ends on the last beat.
		commitBuffer();
		cursorToFlattened(tuneEntry.sections[0].notes.findIndex((n) => n.pitch === 67));
		tuneDeleteSelected(); // G → rest (not the section end? it IS the last element → removed)
		cursorToFlattened(tuneEntry.sections[0].notes.findIndex((n) => n.pitch === 62)); // D
		toggleInsertMode();
		setDuration('quarter');
		expect(tuneAddNote(9, 4, 'natural')).toBe(true); // A before D
		commitBuffer();
		expect(stored()).toEqual([[60, 0], [69, 0.25], [62, 0.5], [64, 0.75], [65, 4.25]]);
		expect(tuneEntry.sections[0].harmony[0].startOffset).toEqual([4, 1]);
		expect(tuneEntry.sections[0].bars).toBe(8);
	});

	it('refuses an insert that would push a pitched note past the section end', () => {
		twoPageLine();
		commitBuffer();
		cursorToFlattened(tuneEntry.sections[0].notes.findIndex((n) => n.pitch === 62));
		toggleInsertMode();
		setDuration('half');
		expect(tuneAddNote(9, 4, 'natural')).toBe(false);
		expect(tuneEntry.lastRefusal).toBe('insert-no-room');
		commitBuffer();
		expect(stored()).toEqual([[60, 0], [62, 0.25], [64, 0.5], [65, 4], [67, 7.75]]);
	});
});

describe('cursor-mode entry splits across the page boundary with a tie', () => {
	it('a long note at the page\'s last beats puts its head here, tied, and its tail on the next page', () => {
		setDuration('whole');
		cursorToBar(0, 3, 2); // page 0, bar 4, beat 3 → cursor 3.5
		expect(tuneAddNote(2, 4, 'natural')).toBe(true);
		expect(tuneEntry.currentPage).toBe(1);
		expect(stepEntry.enteredNotes.map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)])).toEqual([[62, 0, 0.5]]);
		const head = tuneEntry.sections[0].notes.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(head.pitch).toBe(62);
		expect(head.tied).toBe(true);
		expect(compareFractions(head.duration, [1, 2])).toBe(0);
		expect(fractionToFloat(tuneEntry.entryCursor!)).toBeCloseTo(0.5, 9);
	});
});

describe('insertBar / deleteBar', () => {
/** A 4-bar section of whole notes C D E with a chord on each. */
	function form(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 4,
			notes: [
				{ pitch: 60, duration: [1, 1], offset: [0, 1] },
				{ pitch: 62, duration: [1, 1], offset: [1, 1] },
				{ pitch: 64, duration: [1, 1], offset: [2, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(setChord(0, 0, 0, 'C7')).toBe(true);
		expect(setChord(0, 1, 0, 'D7')).toBe(true);
		expect(setChord(0, 2, 0, 'E7')).toBe(true);
	}
/** The section's bar count, pitched notes and chords, for one-shot comparison. */
	const shape = () => ({
		bars: tuneEntry.sections[0].bars,
		notes: tuneEntry.sections[0].notes.filter((n) => n.pitch !== null).map((n) => [n.pitch, fractionToFloat(n.offset)]),
		chords: tuneEntry.sections[0].harmony.map((h) => [h.symbol, fractionToFloat(h.startOffset), fractionToFloat(h.duration)])
	});

	it('inserts an empty bar before a bar, moving later notes and chords a bar later', () => {
		form();
		insertBar(0, 1);
		expect(shape()).toEqual({
			bars: 5,
			notes: [[60, 0], [62, 2], [64, 3]],
			chords: [['C7', 0, 2], ['D7', 2, 1], ['E7', 3, 2]]
		});
	});

	it('deletes a bar with its notes and chords, pulling the rest a bar earlier', () => {
		form();
		deleteBar(0, 1);
		expect(shape()).toEqual({
			bars: 3,
			notes: [[60, 0], [64, 1]],
			chords: [['C7', 0, 1], ['E7', 1, 2]]
		});
	});

	it('never deletes the last bar of a section', () => {
		form();
		setSectionBars(0, 1);
		deleteBar(0, 0);
		expect(tuneEntry.sections[0].bars).toBe(1);
	});
});

// ─── Group 13: phase 5 — ranges in the tune editor ───────────────────────

describe('ranges in the tune editor', () => {
/** C D E G in bar 1 and an F on bar 5 (page 1). */
	function line(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] },
				{ pitch: 64, duration: [1, 4], offset: [1, 2] },
				{ pitch: 67, duration: [1, 4], offset: [3, 4] },
				{ pitch: 65, duration: [1, 4], offset: [4, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
	}

	it('Shift+click within the page extends the range; on another page it is a plain select', () => {
		line();
		cursorToFlattened(1); // D
		selectRangeToFlattened(3); // G, same page
		expect(rangeBounds()).toEqual({ start: 1, end: 3 });
		selectRangeToFlattened(4); // F on page 1: plain select there
		expect(tuneEntry.currentPage).toBe(1);
		expect(rangeBounds()).toBeNull();
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!].pitch).toBe(65);
	});

	it('Delete on a range rests the passage in place; Ctrl/⌘+Backspace removes its time section-wide', () => {
		line();
		cursorToFlattened(1);
		extendSelection(1); // D E
		expect(tuneDeleteSelected()).toBe('rested');
		// One rest per note — they are never merged, so each stays selectable.
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, null, null, 67]);
		expect(compareFractions(stepEntry.enteredNotes[1].duration, [1, 4])).toBe(0);
		cursorToFlattened(1); // the first rest
		extendSelection(1);
		extendSelection(1); // rest + rest + G
		expect(tuneRemoveSelectedTime()).toBe('removed');
		const pitched = tuneEntry.sections[0].notes.filter((n) => n.pitch !== null).map((n) => [n.pitch, fractionToFloat(n.offset)]);
		expect(pitched).toEqual([[60, 0], [65, 3.25]]); // F pulled from bar 5 onto bar 4, beat 2
	});
});

// ─── Group 14: CodeRabbit round 1 on PR #278 ─────────────────────────────

describe('CodeRabbit round 1 (PR #278)', () => {
	it('navigating onto a page and back never shortens a note straddling into it', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 62, duration: [1, 1], offset: [7, 2], tied: true }, // D from bar 4 beat 3 into bar 5
				{ pitch: 62, duration: [1, 4], offset: [9, 2] },
				{ pitch: 64, duration: [1, 4], offset: [5, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		loadPage(0, 1);
		loadPage(0, 0);
		commitBuffer();
		const d = tuneEntry.sections[0].notes.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(compareFractions(d.duration, [1, 1])).toBe(0);
		expect(d.tied).toBe(true);
		// The draft agrees — nothing under the straddler but its own tail.
		const drafted = buildDraftTune().sections[0].notes.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(compareFractions(drafted.duration, [1, 1])).toBe(0);
	});

	it('a pitched note written under a straddler still trims it (the overwrite rule holds)', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [{ pitch: 62, duration: [1, 1], offset: [7, 2] }],
			harmony: []
		}]), INSTRUMENTS['concert']);
		cursorToBar(0, 4, 0);
		setDuration('quarter');
		expect(tuneAddNote(0, 4, 'natural')).toBe(true);
		commitBuffer();
		const d = tuneEntry.sections[0].notes.find((n) => compareFractions(n.offset, [7, 2]) === 0)!;
		expect(compareFractions(d.duration, [1, 2])).toBe(0);
	});

	it('insert mode keeps the chosen duration across inserts in the tune editor', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 60, duration: [1, 4], offset: [0, 1] },
				{ pitch: 62, duration: [1, 4], offset: [1, 4] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		commitBuffer();
		cursorToFlattened(1); // D
		toggleInsertMode();
		setDuration('eighth');
		expect(tuneAddNote(4, 4, 'natural')).toBe(true);
		expect(tuneAddNote(5, 4, 'natural')).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => [n.pitch, fractionToFloat(n.duration)])).toEqual([[60, 0.25], [64, 0.125], [65, 0.125], [62, 0.25]]);
		expect(stepEntry.currentDuration).toBe('eighth');
	});

	it('a refused insert\'s reason does not outlive the next entry attempt', () => {
		loadFromTune(sheet([{
			label: 'A',
			bars: 1,
			notes: [
				{ pitch: 60, duration: [1, 2], offset: [0, 1] },
				{ pitch: 62, duration: [1, 2], offset: [1, 2] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		commitBuffer();
		cursorToFlattened(1);
		toggleInsertMode();
		setDuration('quarter');
		expect(tuneAddNote(4, 4, 'natural')).toBe(false);
		expect(tuneEntry.lastRefusal).toBe('insert-no-room');
		toggleInsertMode();
		selectNote(null);
		expect(tuneAddNote(4, 4, 'natural')).toBe(false); // the form is full: an unrelated refusal
		expect(tuneEntry.lastRefusal).toBeNull();
	});
});

// ─── Group 15: clicking a gap rest (2026-10-16) ───────────────────────────

describe('tuneSelectGap — a rest the section never stored becomes a selectable element', () => {
	/** Black Orpheus's shape after a PDF import: notes only, every rest a gap. */
	function pdfShaped(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 8,
			notes: [
				{ pitch: 62, duration: [1, 2], offset: [0, 1] }, // D, then a half-bar gap
				{ pitch: 64, duration: [1, 4], offset: [1, 1] }, // E in bar 2, a 3/4 gap after it
				{ pitch: 65, duration: [1, 2], offset: [4, 1] } // F on page 1, a half gap after it
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
	}

	it('the trailing half gap of the current page becomes a half rest, selected, its length armed; splitting and filling it works', () => {
		pdfShaped();
		commitBuffer(); // bar 1's gap between D and E is now a stored rest, the tail of the page is not
		loadPage(0, 0);
		// After E there is nothing on the page; the chart draws bar 2's tail as
		// a quarter rest (beat 2) and a half rest (beats 3–4). Click the half.
		expect(tuneSelectGap(0, 1.5, 0.5)).toBe(true);
		const sel = stepEntry.selectedNoteIndex!;
		expect(stepEntry.enteredNotes[sel]).toMatchObject({ pitch: null, offset: [3, 2], duration: [1, 2] });
		expect(stepEntry.enteredNotes[sel - 1]).toMatchObject({ pitch: null, offset: [5, 4], duration: [1, 4] }); // the silence before it, bridged
		expect(stepEntry.selectionMode).toBe('edit');
		expect(stepEntry.currentDuration).toBe('half');
		expect(tuneEntry.entryCursor).toBeNull();
		// Andy's flow: shorten it to a quarter — two rests — step onto the remainder and type the note.
		expect(setDuration('quarter')).toBe(true);
		expect(stepEntry.enteredNotes.slice(sel, sel + 2).map((n) => fractionToFloat(n.duration))).toEqual([0.25, 0.25]);
		selectNext();
		expect(tuneAddNote(7, 4, 'natural')).toBe(true);
		commitBuffer();
		const bar2 = tuneEntry.sections[0].notes.filter((n) => { const o = fractionToFloat(n.offset); return o >= 1 && o < 2; });
		expect(bar2.map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)])).toEqual([[64, 1, 0.25], [null, 1.25, 0.25], [null, 1.5, 0.25], [67, 1.75, 0.25]]);
	});

	it('a gap on another page loads that page first', () => {
		pdfShaped();
		expect(tuneEntry.currentPage).toBe(0);
		expect(tuneSelectGap(0, 4.5, 0.5)).toBe(true); // the half rest after F, bar 5 beats 3–4
		expect(tuneEntry.currentPage).toBe(1);
		const sel = stepEntry.selectedNoteIndex!;
		expect(stepEntry.enteredNotes[sel]).toMatchObject({ pitch: null, offset: [1, 2], duration: [1, 2] });
	});

	it('a gap that is already a buffer rest is selected, not duplicated', () => {
		pdfShaped();
		const before = stepEntry.enteredNotes.length; // D, gap rest, E
		expect(tuneSelectGap(0, 0.5, 0.5)).toBe(true);
		expect(stepEntry.enteredNotes).toHaveLength(before);
		expect(stepEntry.enteredNotes[stepEntry.selectedNoteIndex!]).toMatchObject({ pitch: null, offset: [1, 2], duration: [1, 2] });
		expect(stepEntry.currentDuration).toBe('half');
	});
});

describe('tuneSelectGap splits a spanning buffer rest at the clicked segment (CodeRabbit, PR #280)', () => {
	/** D, a 3/4 gap (engraved as a quarter on beat 2 and a half on beats 3–4), E on bar 2. */
	function gapBetweenNotes(): void {
		loadFromTune(sheet([{
			label: 'A',
			bars: 4,
			notes: [
				{ pitch: 62, duration: [1, 4], offset: [0, 1] },
				{ pitch: 64, duration: [1, 4], offset: [1, 1] }
			],
			harmony: []
		}]), INSTRUMENTS['concert']);
		expect(stepEntry.enteredNotes.map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)])).toEqual([[62, 0, 0.25], [null, 0.25, 0.75], [64, 1, 0.25]]);
	}

	it('clicking the half segment selects a half rest on beats 3–4, leaving the quarter before it', () => {
		gapBetweenNotes();
		expect(tuneSelectGap(0, 0.5, 0.5)).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)])).toEqual([[62, 0, 0.25], [null, 0.25, 0.25], [null, 0.5, 0.5], [64, 1, 0.25]]);
		expect(stepEntry.selectedNoteIndex).toBe(2);
		expect(stepEntry.currentDuration).toBe('half');
	});

	it('clicking the quarter segment selects a quarter rest on beat 2, leaving the half after it', () => {
		gapBetweenNotes();
		expect(tuneSelectGap(0, 0.25, 0.25)).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => [n.pitch, fractionToFloat(n.offset), fractionToFloat(n.duration)])).toEqual([[62, 0, 0.25], [null, 0.25, 0.25], [null, 0.5, 0.5], [64, 1, 0.25]]);
		expect(stepEntry.selectedNoteIndex).toBe(1);
		expect(stepEntry.currentDuration).toBe('quarter');
	});
});
