import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tune } from '$lib/types/tune';
import { settings } from '$lib/state/settings.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import { stepEntry, addNote } from '$lib/state/step-entry.svelte';
import {
	PAGE_BARS,
	tuneEntry,
	initNewTune,
	loadPage,
	commitBuffer,
	buildDraftTune,
	addSection,
	removeSection,
	updateSectionMeta,
	setSectionBars,
	setChord,
	removeChord,
	chordTextAt,
	setSheetWrittenKey,
	loadFromTune,
	currentSectionPageCount,
	flattenedBufferBase,
	suspendEntryBuffer,
	resumeEntryBuffer,
	melodyEditingSupported,
	setSourceTransposition
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
	initNewTune();
});

describe('initNewTune', () => {
	it('starts with one 8-bar A section and an empty buffer', () => {
		expect(tuneEntry.sections).toHaveLength(1);
		expect(tuneEntry.sections[0].label).toBe('A');
		expect(tuneEntry.sections[0].bars).toBe(8);
		expect(tuneEntry.currentSection).toBe(0);
		expect(tuneEntry.currentPage).toBe(0);
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
		expect(tuneEntry.sections[0].notes).toHaveLength(1);
		expect(tuneEntry.sections[0].notes[0].offset).toEqual([0, 1]);
		expect(stepEntry.enteredNotes).toHaveLength(0);
		expect(stepEntry.barCount).toBe(4);

		// Enter another note on page 1 → lands at bar 4 in section coordinates.
		addNote(2, 4, 'natural');
		commitBuffer();
		const offsets = tuneEntry.sections[0].notes.map((n) => n.offset);
		expect(offsets).toContainEqual([0, 1]);
		expect(offsets).toContainEqual([4, 1]);
	});

	it('loads a page with page-local offsets and gap-filled rests', () => {
		// Sparse melody: single note at bar 5, beat 3 (offset 5.5).
		tuneEntry.sections[0].notes = [
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
		const draft = buildDraftTune();
		expect(draft.sections[0].notes).toHaveLength(1);
		// State itself not committed yet.
		expect(tuneEntry.sections[0].notes).toHaveLength(0);
	});

	it('converts the written key to concert on the built sheet', () => {
		// The source transposition defaults from the instrument at init time.
		settings.instrumentId = 'tenor-sax';
		initNewTune();
		setSheetWrittenKey('D', false);
		const draft = buildDraftTune();
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
		expect(tuneEntry.sections).toHaveLength(2);
		expect(tuneEntry.sections[1].label).toBe('B');
		expect(tuneEntry.currentSection).toBe(1);
	});

	it('never removes the last section', () => {
		removeSection(0);
		expect(tuneEntry.sections).toHaveLength(1);
	});

	it('updates repeat and ending markers', () => {
		addSection();
		updateSectionMeta(0, { repeatStart: true, repeatEnd: true });
		updateSectionMeta(1, { ending: 2, label: 'Coda' });
		expect(tuneEntry.sections[0].repeatStart).toBe(true);
		expect(tuneEntry.sections[1].ending).toBe(2);
		expect(tuneEntry.sections[1].label).toBe('Coda');
	});

	it('truncates overflowing notes and chords when bars shrink', () => {
		// Hydrate through the real API — the buffer owns the current page
		// window, so content must arrive via loadFromTune, not by
		// mutating sections directly underneath a loaded buffer.
		loadFromTune({
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
		expect(tuneEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(1);
		expect(tuneEntry.sections[0].harmony).toHaveLength(1);
	});
});

describe('chords', () => {
	it('stores parsed chords in concert pitch with derived duration and scale', () => {
		expect(setChord(0, 0, 0, 'Dm7')).toBe(true);
		expect(setChord(0, 2, 0, 'G7')).toBe(true);
		const harmony = tuneEntry.sections[0].harmony;
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
		// The source transposition defaults from the instrument at init time.
		settings.instrumentId = 'tenor-sax';
		initNewTune();
		setChord(0, 0, 0, 'Em7');
		const seg = tuneEntry.sections[0].harmony[0];
		// Written Em7 on tenor (+2 pitch class) is concert Dm7.
		expect(seg.chord.root).toBe('D');
		expect(seg.symbol).toBe('D-7');
		// The editor reads it back in written pitch.
		expect(chordTextAt(0, 0, 0)).toBe('E-7');
	});

	it('rejects unparseable chord text', () => {
		expect(setChord(0, 0, 0, 'Xyz9')).toBe(false);
		expect(tuneEntry.sections[0].harmony).toHaveLength(0);
	});

	it('replaces a chord at the same position and removes chords', () => {
		setChord(0, 1, 2, 'Fmaj7');
		setChord(0, 1, 2, 'F7');
		expect(tuneEntry.sections[0].harmony).toHaveLength(1);
		expect(chordTextAt(0, 1, 2)).toBe('F7');
		removeChord(0, 1, 2);
		expect(tuneEntry.sections[0].harmony).toHaveLength(0);
	});
});

describe('key changes', () => {
	it('re-transposes melody and chords when moving notes', () => {
		addNote(0, 4, 'natural'); // C4
		setChord(0, 0, 0, 'C');
		commitBuffer();
		setSheetWrittenKey('D', true);
		const draft = buildDraftTune();
		expect(draft.key).toBe('D');
		const pitched = draft.sections[0].notes.filter((n) => n.pitch !== null);
		expect(pitched[0].pitch).toBe(62);
		expect(draft.sections[0].harmony[0].chord.root).toBe('D');
	});

	it('relabels without moving when moveNotes is off', () => {
		addNote(0, 4, 'natural');
		commitBuffer();
		setSheetWrittenKey('D', false);
		const draft = buildDraftTune();
		expect(draft.key).toBe('D');
		const pitched = draft.sections[0].notes.filter((n) => n.pitch !== null);
		expect(pitched[0].pitch).toBe(60);
	});
});

describe('non-4/4 time signatures (imported charts)', () => {
	function waltzSheet(): Tune {
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
		loadFromTune(waltzSheet(), INSTRUMENTS['concert']);
		expect(buildDraftTune().timeSignature).toEqual([3, 4]);
		expect(melodyEditingSupported()).toBe(false);
	});

	it('never lets the 4/4 buffer corrupt a non-4/4 sheet', () => {
		loadFromTune(waltzSheet(), INSTRUMENTS['concert']);
		// Buffer stays empty and commits are no-ops.
		expect(stepEntry.enteredNotes).toEqual([]);
		commitBuffer();
		expect(tuneEntry.sections[0].notes).toHaveLength(1);
		expect(tuneEntry.sections[0].notes[0].offset).toEqual([0, 1]);
	});

	it('keeps the stored melody in the built draft (the save path)', () => {
		// The editor's handleSave runs commitBuffer() (a guarded no-op here)
		// then buildDraftTune(); the draft's virtual buffer merge must be
		// gated the same way — an ungated mergeWindow against the EMPTY
		// buffer would silently drop every stored note in the current page
		// window from the saved sheet.
		loadFromTune(waltzSheet(), INSTRUMENTS['concert']);
		commitBuffer();
		const draft = buildDraftTune();
		expect(draft.sections[0].notes).toEqual([
			{ pitch: 65, duration: [1, 4], offset: [0, 1] }
		]);
	});

	it('places chords on the meter grid, not a hardcoded 4/4 grid', () => {
		loadFromTune(waltzSheet(), INSTRUMENTS['concert']);
		expect(setChord(0, 1, 2, 'F7')).toBe(true);
		const seg = tuneEntry.sections[0].harmony[0];
		expect(seg.startOffset).toEqual([5, 4]); // bar 1 (3/4) + 2 beats
		expect(seg.duration).toEqual([7, 4]); // to the 4-bar section end (3.0)
	});

	it('resets to 4/4 for a fresh sheet', () => {
		loadFromTune(waltzSheet(), INSTRUMENTS['concert']);
		initNewTune();
		expect(buildDraftTune().timeSignature).toEqual([4, 4]);
		expect(melodyEditingSupported()).toBe(true);
	});

	it('truncates against the meter-scaled section end, not the raw bar count', () => {
		const sheet = waltzSheet();
		sheet.sections[0].bars = 8;
		// Bar 5 (0-based bar 4) of 3/4 starts at whole-note offset 3.0 —
		// numerically BELOW the new bar count of 4, so a bar-unit filter
		// would wrongly keep it past a 4-bar resize.
		sheet.sections[0].notes = [
			{ pitch: 65, duration: [1, 4], offset: [0, 1] },
			{ pitch: 67, duration: [1, 4], offset: [3, 1] }
		];
		loadFromTune(sheet, INSTRUMENTS['concert']);
		setChord(0, 0, 0, 'F');
		setChord(0, 4, 0, 'C7'); // bar 5 → startOffset [3, 1]
		setSectionBars(0, 4);
		expect(tuneEntry.sections[0].notes).toHaveLength(1);
		expect(tuneEntry.sections[0].harmony).toHaveLength(1);
		// The surviving chord runs to the 4-bar (3.0 whole-note) section end.
		expect(tuneEntry.sections[0].harmony[0].duration).toEqual([3, 1]);
	});

	it('keeps content inside the resize when bars exceed a whole note (6/4)', () => {
		const sheet = waltzSheet();
		sheet.timeSignature = [6, 4];
		sheet.sections[0].bars = 4;
		// Bar 3 (0-based bar 2) of 6/4 spans 3.0–4.5 whole notes: a note at
		// 4.0 survives a 3-bar resize, but a bar-unit filter would drop it.
		sheet.sections[0].notes = [{ pitch: 65, duration: [1, 4], offset: [4, 1] }];
		loadFromTune(sheet, INSTRUMENTS['concert']);
		setSectionBars(0, 3);
		expect(tuneEntry.sections[0].notes).toHaveLength(1);
	});
});

describe('review handoff flag (import → editor navigation)', () => {
	it('is raised by loadFromTune so the editor mount keeps the draft', () => {
		loadFromTune({
			id: 'sheet-h-andf',
			title: 'Handoff',
			key: 'C',
			timeSignature: [4, 4],
			tags: [],
			sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
			source: 'imported-pdf'
		}, INSTRUMENTS['concert']);
		// A draft with a pre-assigned id has editingId set but NO ?edit= param —
		// without the flag, the editor's stale-state guard wipes it on mount.
		expect(tuneEntry.editingId).toBe('sheet-h-andf');
		expect(tuneEntry.reviewHandoff).toBe(true);
	});

	it('is consumed by initNewTune', () => {
		loadFromTune({
			id: 'sheet-h-andf',
			title: 'Handoff',
			key: 'C',
			timeSignature: [4, 4],
			tags: [],
			sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
			source: 'imported-pdf'
		}, INSTRUMENTS['concert']);
		initNewTune();
		expect(tuneEntry.reviewHandoff).toBe(false);
	});
});

describe('buffer suspend/resume across navigation', () => {
	it('commits and empties the shared step-entry buffer on suspend, restores on resume', () => {
		addNote(0, 4, 'natural');
		suspendEntryBuffer();
		// The shared buffer is clean for the lick entry page…
		expect(stepEntry.enteredNotes).toHaveLength(0);
		// …but the content is committed into the section.
		expect(tuneEntry.sections[0].notes).toHaveLength(1);

		resumeEntryBuffer();
		expect(stepEntry.enteredNotes.filter((n) => n.pitch !== null)).toHaveLength(1);
		// Resume must not double-commit or lose the note.
		expect(tuneEntry.sections[0].notes.filter((n) => n.pitch !== null)).toHaveLength(1);
	});
});

describe('edit-mode hydration', () => {
	it('loads a sheet back into the editor with the written key', () => {
		const sheet: Tune = {
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
		loadFromTune(sheet, INSTRUMENTS['tenor-sax']);
		expect(tuneEntry.editingId).toBe('sheet-7-zzzz');
		expect(tuneEntry.editingSource).toBe('imported-ireal');
		expect(tuneEntry.editingPdfUrl).toBe('me/sheet-7-zzzz.pdf');
		expect(tuneEntry.title).toBe('Round Trip');
		expect(tuneEntry.writtenKey).toBe('D'); // concert C on tenor
		expect(tuneEntry.sections[0].repeatStart).toBe(true);
		// The first page is loaded into the buffer.
		expect(stepEntry.enteredNotes.some((n) => n.pitch === 60)).toBe(true);
	});

	it('round-trips through buildDraftTune preserving id and source', () => {
		const sheet: Tune = {
			id: 'sheet-7-zzzz',
			title: 'Round Trip',
			key: 'F',
			timeSignature: [4, 4],
			tags: [],
			sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }],
			source: 'user'
		};
		loadFromTune(sheet, INSTRUMENTS['concert']);
		const draft = buildDraftTune();
		expect(draft.id).toBe('sheet-7-zzzz');
		expect(draft.source).toBe('user');
		expect(draft.key).toBe('F');
	});
});

// ─── Source transposition (chart written for) ─────────────────────────

describe('source transposition', () => {
	beforeEach(() => {
		settings.instrumentId = 'tenor-sax';
		initNewTune();
	});

	it('defaults to the user instrument family and arms the buffer override', () => {
		expect(tuneEntry.sourceTransposition).toBe('Bb');
		expect(stepEntry.transpositionOverride).toBe(14);

		settings.instrumentId = 'concert';
		initNewTune();
		expect(tuneEntry.sourceTransposition).toBe('C');
		expect(stepEntry.transpositionOverride).toBe(0);
	});

	it('switching the source re-labels the written key, concert stays fixed', () => {
		// Tenor default: written C = concert Bb.
		expect(buildDraftTune().key).toBe('Bb');
		setSourceTransposition('C');
		expect(tuneEntry.writtenKey).toBe('Bb');
		expect(buildDraftTune().key).toBe('Bb');
		expect(stepEntry.phraseKey).toBe('Bb');
		expect(stepEntry.transpositionOverride).toBe(0);
	});

	it('chords are read/written at the SOURCE pitch, not the instrument', () => {
		// Concert-book source on a tenor: Dm7 on the page is concert Dm7.
		setSourceTransposition('C');
		expect(setChord(0, 0, 0, 'Dm7')).toBe(true);
		expect(tuneEntry.sections[0].harmony[0].chord.root).toBe('D');
		expect(chordTextAt(0, 0, 0)).toBe('D-7');
	});

	it('under the default Bb source, chords transpose as before', () => {
		expect(setChord(0, 0, 0, 'Dm7')).toBe(true);
		expect(tuneEntry.sections[0].harmony[0].chord.root).toBe('C');
		expect(chordTextAt(0, 0, 0)).toBe('D-7');
	});

	it('typed melody follows the source: concert book C4 stores concert 60', () => {
		setSourceTransposition('C');
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(60);
	});

	it('loadFromTune re-defaults the source from the instrument', () => {
		setSourceTransposition('C');
		const sheet: Tune = {
			id: 'sheet-1',
			title: 'T',
			key: 'C',
			timeSignature: [4, 4],
			tags: [],
			source: 'user',
			sections: [{ label: 'A', bars: 4, notes: [], harmony: [] }]
		};
		loadFromTune(sheet, INSTRUMENTS['tenor-sax']);
		expect(tuneEntry.sourceTransposition).toBe('Bb');
		expect(tuneEntry.writtenKey).toBe('D');
		expect(stepEntry.transpositionOverride).toBe(14);
	});

	it('suspend clears the shared-buffer override; resume restores it', () => {
		suspendEntryBuffer();
		expect(stepEntry.transpositionOverride).toBeNull();
		resumeEntryBuffer();
		expect(stepEntry.transpositionOverride).toBe(14);
	});

	it('buildDraftTune converts the written key through the source', () => {
		setSheetWrittenKey('D', false);
		expect(buildDraftTune().key).toBe('C'); // Bb source: written D = concert C
		setSourceTransposition('C');
		expect(tuneEntry.writtenKey).toBe('C');
		expect(buildDraftTune().key).toBe('C');
	});
});
