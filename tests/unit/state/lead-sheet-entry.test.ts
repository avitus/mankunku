import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { settings } from '$lib/state/settings.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { stepEntry, addNote } from '$lib/state/step-entry.svelte';
import {
	PAGE_BARS,
	leadSheetEntry,
	initNewLeadSheet,
	loadPage,
	commitBuffer,
	buildDraftLeadSheet,
	addSection,
	removeSection,
	updateSectionMeta,
	setSectionBars,
	setChord,
	removeChord,
	chordTextAt,
	setSheetWrittenKey,
	loadFromLeadSheet,
	currentSectionPageCount,
	flattenedBufferBase,
	suspendEntryBuffer,
	resumeEntryBuffer,
	melodyEditingSupported
} from '$lib/state/lead-sheet-entry.svelte';

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
	initNewLeadSheet();
});

describe('initNewLeadSheet', () => {
	it('starts with one 8-bar A section and an empty buffer', () => {
		expect(leadSheetEntry.sections).toHaveLength(1);
		expect(leadSheetEntry.sections[0].label).toBe('A');
		expect(leadSheetEntry.sections[0].bars).toBe(8);
		expect(leadSheetEntry.currentSection).toBe(0);
		expect(leadSheetEntry.currentPage).toBe(0);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(stepEntry.barCount).toBe(PAGE_BARS);
	});

	it('pages the section in 4-bar windows', () => {
		expect(currentSectionPageCount()).toBe(2);
		setSectionBars(0, 10);
		expect(currentSectionPageCount()).toBe(3);
	});
});

describe('buffer paging', () => {
	it('commits buffer notes into the section at the page offset', () => {
		// Enter a C4 whole note on page 0 (concert instrument: written == concert).
		addNote(0, 4, 'natural');
		loadPage(0, 1); // implicit commit
		expect(leadSheetEntry.sections[0].notes).toHaveLength(1);
		expect(leadSheetEntry.sections[0].notes[0].offset).toEqual([0, 1]);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(stepEntry.barCount).toBe(4);

		// Enter another note on page 1 → lands at bar 4 in section coordinates.
		addNote(2, 4, 'natural');
		commitBuffer();
		const offsets = leadSheetEntry.sections[0].notes.map((n) => n.offset);
		expect(offsets).toContainEqual([0, 1]);
		expect(offsets).toContainEqual([4, 1]);
	});

	it('loads a page with page-local offsets and gap-filled rests', () => {
		// Sparse melody: single note at bar 5, beat 3 (offset 5.5).
		leadSheetEntry.sections[0].notes = [
			{ pitch: 60, duration: [1, 4], offset: [11, 2] }
		];
		loadPage(0, 1);
		// Buffer covers bars 4-7; the note appears at local offset 1.5 preceded
		// by a gap-filling rest so the append cursor stays consistent.
		const pitched = stepEntry.enteredNotes.filter((n) => n.pitch !== null);
		expect(pitched).toHaveLength(1);
		expect(pitched[0].offset).toEqual([3, 2]);
		const restSpan = stepEntry.enteredNotes
			.filter((n) => n.pitch === null)
			.reduce((sum, n) => sum + n.duration[0] / n.duration[1], 0);
		expect(restSpan).toBeCloseTo(1.5, 9);
	});

	it('sizes the last page window to the remaining bars', () => {
		setSectionBars(0, 6);
		loadPage(0, 1);
		expect(stepEntry.barCount).toBe(2);
	});
});

describe('draft building', () => {
	it('merges the live buffer into the draft without committing', () => {
		addNote(0, 4, 'natural');
		const draft = buildDraftLeadSheet();
		expect(draft.sections[0].notes).toHaveLength(1);
		// State itself not committed yet.
		expect(leadSheetEntry.sections[0].notes).toHaveLength(0);
	});

	it('converts the written key to concert on the built sheet', () => {
		settings.instrumentId = 'tenor-sax';
		setSheetWrittenKey('D', false);
		const draft = buildDraftLeadSheet();
		expect(draft.key).toBe('C'); // written D on tenor = concert C
	});

	it('reports the flattened index base of the current buffer for highlight mapping', () => {
		addNote(0, 4, 'natural');
		loadPage(0, 1);
		addNote(2, 4, 'natural');
		expect(flattenedBufferBase()).toBe(1);
	});
});

describe('sections', () => {
	it('adds sections with successive labels and navigates to them', () => {
		addSection();
		expect(leadSheetEntry.sections).toHaveLength(2);
		expect(leadSheetEntry.sections[1].label).toBe('B');
		expect(leadSheetEntry.currentSection).toBe(1);
	});

	it('never removes the last section', () => {
		removeSection(0);
		expect(leadSheetEntry.sections).toHaveLength(1);
	});

	it('updates repeat and ending markers', () => {
		addSection();
		updateSectionMeta(0, { repeatStart: true, repeatEnd: true });
		updateSectionMeta(1, { ending: 2, label: 'Coda' });
		expect(leadSheetEntry.sections[0].repeatStart).toBe(true);
		expect(leadSheetEntry.sections[1].ending).toBe(2);
		expect(leadSheetEntry.sections[1].label).toBe('Coda');
	});

	it('truncates overflowing notes and chords when bars shrink', () => {
		// Hydrate through the real API — the buffer owns the current page
		// window, so content must arrive via loadFromLeadSheet, not by
		// mutating sections directly underneath a loaded buffer.
		loadFromLeadSheet({
			id: 'sheet-t-runc',
			title: 'Truncate Me',
			key: 'C',
			timeSignature: [4, 4],
			tags: [],
			sections: [{
				label: 'A',
				bars: 8,
				notes: [
					{ pitch: 60, duration: [1, 4], offset: [0, 1] },
					{ pitch: 62, duration: [1, 4], offset: [5, 1] }
				],
				harmony: []
			}],
			source: 'user'
		}, INSTRUMENTS['concert']);
		setChord(0, 0, 0, 'C');
		setChord(0, 6, 0, 'G7');
		setSectionBars(0, 4);
		expect(leadSheetEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(1);
		expect(leadSheetEntry.sections[0].harmony).toHaveLength(1);
	});
});

describe('chords', () => {
	it('stores parsed chords in concert pitch with derived duration and scale', () => {
		expect(setChord(0, 0, 0, 'Dm7')).toBe(true);
		expect(setChord(0, 2, 0, 'G7')).toBe(true);
		const harmony = leadSheetEntry.sections[0].harmony;
		expect(harmony).toHaveLength(2);
		// Concert instrument: written == concert.
		expect(harmony[0].chord.root).toBe('D');
		expect(harmony[0].chord.quality).toBe('min7');
		expect(harmony[0].startOffset).toEqual([0, 1]);
		// First chord runs until the second one.
		expect(harmony[0].duration).toEqual([2, 1]);
		// Second runs to the section end (8 bars).
		expect(harmony[1].duration).toEqual([6, 1]);
		expect(typeof harmony[0].scaleId).toBe('string');
		expect(harmony[0].symbol).toBe('D-7');
	});

	it('converts written chord symbols to concert for transposing instruments', () => {
		settings.instrumentId = 'tenor-sax';
		setChord(0, 0, 0, 'Em7');
		const seg = leadSheetEntry.sections[0].harmony[0];
		// Written Em7 on tenor (+2 pitch class) is concert Dm7.
		expect(seg.chord.root).toBe('D');
		expect(seg.symbol).toBe('D-7');
		// The editor reads it back in written pitch.
		expect(chordTextAt(0, 0, 0)).toBe('E-7');
	});

	it('rejects unparseable chord text', () => {
		expect(setChord(0, 0, 0, 'Xyz9')).toBe(false);
		expect(leadSheetEntry.sections[0].harmony).toHaveLength(0);
	});

	it('replaces a chord at the same position and removes chords', () => {
		setChord(0, 1, 2, 'Fmaj7');
		setChord(0, 1, 2, 'F7');
		expect(leadSheetEntry.sections[0].harmony).toHaveLength(1);
		expect(chordTextAt(0, 1, 2)).toBe('F7');
		removeChord(0, 1, 2);
		expect(leadSheetEntry.sections[0].harmony).toHaveLength(0);
	});
});

describe('key changes', () => {
	it('re-transposes melody and chords when moving notes', () => {
		addNote(0, 4, 'natural'); // C4
		setChord(0, 0, 0, 'C');
		commitBuffer();
		setSheetWrittenKey('D', true);
		const draft = buildDraftLeadSheet();
		expect(draft.key).toBe('D');
		const pitched = draft.sections[0].notes.filter((n) => n.pitch !== null);
		expect(pitched[0].pitch).toBe(62);
		expect(draft.sections[0].harmony[0].chord.root).toBe('D');
	});

	it('relabels without moving when moveNotes is off', () => {
		addNote(0, 4, 'natural');
		commitBuffer();
		setSheetWrittenKey('D', false);
		const draft = buildDraftLeadSheet();
		expect(draft.key).toBe('D');
		const pitched = draft.sections[0].notes.filter((n) => n.pitch !== null);
		expect(pitched[0].pitch).toBe(60);
	});
});

describe('non-4/4 time signatures (imported charts)', () => {
	function waltzSheet(): LeadSheet {
		return {
			id: 'sheet-w-altz',
			title: 'Waltz',
			key: 'F',
			timeSignature: [3, 4],
			tags: [],
			sections: [{
				label: 'A',
				bars: 4,
				notes: [{ pitch: 65, duration: [1, 4], offset: [0, 1] }],
				harmony: []
			}],
			source: 'imported-ireal'
		};
	}

	it('preserves the imported time signature through the draft', () => {
		loadFromLeadSheet(waltzSheet(), INSTRUMENTS['concert']);
		expect(buildDraftLeadSheet().timeSignature).toEqual([3, 4]);
		expect(melodyEditingSupported()).toBe(false);
	});

	it('never lets the 4/4 buffer corrupt a non-4/4 sheet', () => {
		loadFromLeadSheet(waltzSheet(), INSTRUMENTS['concert']);
		// Buffer stays empty and commits are no-ops.
		expect(stepEntry.enteredNotes).toEqual([]);
		commitBuffer();
		expect(leadSheetEntry.sections[0].notes).toHaveLength(1);
		expect(leadSheetEntry.sections[0].notes[0].offset).toEqual([0, 1]);
	});

	it('places chords on the meter grid, not a hardcoded 4/4 grid', () => {
		loadFromLeadSheet(waltzSheet(), INSTRUMENTS['concert']);
		expect(setChord(0, 1, 2, 'F7')).toBe(true);
		const seg = leadSheetEntry.sections[0].harmony[0];
		expect(seg.startOffset).toEqual([5, 4]); // bar 1 (3/4) + 2 beats
		expect(seg.duration).toEqual([7, 4]); // to the 4-bar section end (3.0)
	});

	it('resets to 4/4 for a fresh sheet', () => {
		loadFromLeadSheet(waltzSheet(), INSTRUMENTS['concert']);
		initNewLeadSheet();
		expect(buildDraftLeadSheet().timeSignature).toEqual([4, 4]);
		expect(melodyEditingSupported()).toBe(true);
	});
});

describe('buffer suspend/resume across navigation', () => {
	it('commits and empties the shared step-entry buffer on suspend, restores on resume', () => {
		addNote(0, 4, 'natural');
		suspendEntryBuffer();
		// The shared buffer is clean for the lick entry page…
		expect(stepEntry.enteredNotes).toHaveLength(0);
		// …but the content is committed into the section.
		expect(leadSheetEntry.sections[0].notes).toHaveLength(1);

		resumeEntryBuffer();
		expect(stepEntry.enteredNotes.filter((n) => n.pitch !== null)).toHaveLength(1);
		// Resume must not double-commit or lose the note.
		expect(leadSheetEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(1);
	});
});

describe('edit-mode hydration', () => {
	it('loads a sheet back into the editor with the written key', () => {
		const sheet: LeadSheet = {
			id: 'sheet-7-zzzz',
			title: 'Round Trip',
			composer: 'Me',
			key: 'C',
			timeSignature: [4, 4],
			style: 'Swing',
			tags: ['x'],
			sections: [
				{
					label: 'A',
					bars: 8,
					repeatStart: true,
					notes: [{ pitch: 60, duration: [1, 1], offset: [0, 1] }],
					harmony: [{
						chord: { root: 'D', quality: 'min7' },
						scaleId: 'major.dorian',
						startOffset: [0, 1],
						duration: [8, 1],
						symbol: 'Dm7'
					}]
				}
			],
			source: 'imported-ireal',
			pdfUrl: 'me/sheet-7-zzzz.pdf'
		};
		loadFromLeadSheet(sheet, INSTRUMENTS['tenor-sax']);
		expect(leadSheetEntry.editingId).toBe('sheet-7-zzzz');
		expect(leadSheetEntry.editingSource).toBe('imported-ireal');
		expect(leadSheetEntry.editingPdfUrl).toBe('me/sheet-7-zzzz.pdf');
		expect(leadSheetEntry.title).toBe('Round Trip');
		expect(leadSheetEntry.writtenKey).toBe('D'); // concert C on tenor
		expect(leadSheetEntry.sections[0].repeatStart).toBe(true);
		// The first page is loaded into the buffer.
		expect(stepEntry.enteredNotes.some((n) => n.pitch === 60)).toBe(true);
	});

	it('round-trips through buildDraftLeadSheet preserving id and source', () => {
		const sheet: LeadSheet = {
			id: 'sheet-7-zzzz',
			title: 'Round Trip',
			key: 'F',
			timeSignature: [4, 4],
			tags: [],
			sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
			source: 'user'
		};
		loadFromLeadSheet(sheet, INSTRUMENTS['concert']);
		const draft = buildDraftLeadSheet();
		expect(draft.id).toBe('sheet-7-zzzz');
		expect(draft.source).toBe('user');
		expect(draft.key).toBe('F');
	});
});
