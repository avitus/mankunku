/**
 * Tune entry state — long-form manual entry built on top of the
 * step-entry melody buffer.
 *
 * The model: a tune is a list of sections; melody editing happens
 * through the EXISTING `stepEntry` rune one PAGE at a time (a ≤4-bar window,
 * matching step-entry's capacity model), so `PitchEntryPanel`,
 * `DurationSelector`, and all keyboard entry work unmodified. The section
 * list is authoritative; the buffer holds the current page in page-local
 * offsets and is committed back on page/section navigation and save.
 *
 * Pitch conventions match step-entry exactly: sections store CONCERT pitch;
 * the user sees/types WRITTEN. `writtenKey` converts to concert once at
 * `buildDraftTune`; chords are typed as written symbols and stored with
 * concert roots + a concert-canonical raw symbol. Manual entry is 4/4 (the
 * step-entry buffer's assumption); imported sheets in other meters are
 * edited through the import review flow's own tooling.
 */

import type { Fraction, HarmonicSegment, Note, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { Tune, TuneSection } from '$lib/types/tune';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	gcd,
	subtractFractions
} from '$lib/music/intervals';
import { transposePitchClass } from '$lib/music/transposition';
import { parseChordSymbol, formatChordSymbol, type ChordSymbol } from '$lib/music/chord-symbol';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { harmonicSegmentFromChordSymbol } from '$lib/tunes/segment-from-symbol';
import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
import {
	stepEntry,
	reset as resetStepEntry,
	selectNote,
	selectNext,
	selectPrev,
	addNote as stepAddNote,
	addRest as stepAddRest,
	enterTiedNote as stepEnterTiedNote,
	deleteSelectedNote,
	removeSelectedTime,
	isEditSelection,
	markEntered,
	rangeBounds,
	selectRangeTo,
	canAddDuration,
	getCurrentCursorOffset,
	getRemainingCapacity,
	resolveEntryPitch
} from '$lib/state/step-entry.svelte';
import { getDurationFraction } from '$lib/step-entry/durations';
import { coalesceRests, removeTime, replaceWithRest, spliceElement, trimOverlappingNotes } from '$lib/step-entry/buffer-ops';
import { transposeTune } from '$lib/tunes/book-loader';
import { isPickupOnlySection, pickupPrefix, resolvePickupLength } from '$lib/music/pickup';
import {
	defaultSourceTransposition,
	sourceTranspositionSemitones,
	type SourceTransposition
} from '$lib/tunes/source-transposition';

/** Bars per editing page — matches step-entry's maximum bar capacity. */
export const PAGE_BARS = 4;

/** Semitones the source chart is written above concert. */
export function entryTranspositionSemitones(): number {
	return sourceTranspositionSemitones(tuneEntry.sourceTransposition, getInstrument());
}

const MAX_SECTION_BARS = 64;

export const tuneEntry = $state({
	title: '',
	composer: '',
	style: '',
	/** WRITTEN key shown in the key selector (at the SOURCE's pitch). */
	writtenKey: 'C' as PitchClass,
	/**
	 * What pitch the chart being copied is written in. The whole entry
	 * surface — key selector, chord text, typed melody, preview — reads and
	 * writes at this pitch; storage stays concert. Defaults to the user's
	 * instrument family.
	 */
	sourceTransposition: 'C' as SourceTransposition,
	/**
	 * Sheet meter. Manual entry is 4/4 (the step-entry buffer's assumption);
	 * imported charts in other meters keep theirs, with melody editing gated
	 * off (`melodyEditingSupported`) so the 4/4 buffer can't corrupt them.
	 */
	timeSignature: [4, 4] as [number, number],
	tags: [] as string[],
	/** Authoritative section list (CONCERT pitch), except the current page. */
	sections: [] as TuneSection[],
	currentSection: 0,
	currentPage: 0,
	/**
	 * Page-local insertion offset for cursor-mode entry (click-to-edit).
	 * null = classic append-at-end mode. Relationship to the step-entry note
	 * selection: arming the cursor clears the selection, but NOT vice versa —
	 * a cursor-mode insert selects the inserted note AND keeps the cursor
	 * armed (advanced past the insert), so both can be live at once.
	 */
	entryCursor: null as Fraction | null,
	editingId: null as string | null,
	editingSource: null as string | null,
	editingPdfUrl: null as string | null,
	/**
	 * Raised by the import flows when they hydrate a draft and navigate to
	 * the editor. The editor mount consumes it and KEEPS the draft — without
	 * it, a PDF draft's pre-assigned editingId (arriving with no ?edit=
	 * param) looks exactly like stale state and gets wiped.
	 */
	reviewHandoff: false,
	/**
	 * Import review notes (warnings + suspect bar numbers, absolute
	 * notation order) surfaced by the PDF import so mandatory review
	 * starts at the bars the pipeline knows are uncertain. Not persisted;
	 * cleared on any fresh load.
	 */
	importReview: null as { warnings: string[]; suspectBars: number[]; sourceBarImages?: string[] } | null,
	/** Why the last entry was refused, for the rail's status line; cleared by the next success. */
	lastRefusal: null as null | 'insert-no-room'
});

function makeSection(label: string, bars = 8): TuneSection {
	return { label, bars, notes: [], harmony: [] };
}

function cloneSection(sec: TuneSection): TuneSection {
	return {
		...sec,
		notes: sec.notes.map((n) => ({ ...n })),
		harmony: sec.harmony.map((h) => ({ ...h, chord: { ...h.chord } }))
	};
}

/** Bars covered by a given page of a section (the last page may be short). */
function pageWindowBars(sec: TuneSection, page: number): number {
	return Math.max(1, Math.min(PAGE_BARS, sec.bars - page * PAGE_BARS));
}

export function currentSectionPageCount(): number {
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return 1;
	return Math.max(1, Math.ceil(sec.bars / PAGE_BARS));
}

/** Section-timeline start offset of the current page, in whole notes (4/4). */
function pageStartFraction(page: number): Fraction {
	return [page * PAGE_BARS, 1];
}

/**
 * Merge a page-local buffer into a section's notes: notes outside the window
 * survive, the window is replaced by the shifted buffer, result sorted.
 */
function mergeWindow(
	notes: Note[],
	buffer: Note[],
	pageStart: Fraction,
	windowBars: number
): Note[] {
	const startF = fractionToFloat(pageStart);
	const endF = startF + windowBars;
	const outside = notes.filter((n) => {
		const o = fractionToFloat(n.offset);
		return o < startF - 1e-9 || o >= endF - 1e-9;
	});
	const shifted = buffer.map((n) => ({ ...n, offset: addFractions(n.offset, pageStart) }));
	// An overwrite at a page's start may have reached under a note straddling
	// in from the previous page: keep the section monophonic (2026-10-15).
	return trimOverlappingNotes([...outside, ...shifted]);
}

/**
 * Extract a page's notes into buffer form: page-local offsets, gaps between
 * notes filled with exact-duration rests so the append cursor (a running sum
 * of durations) stays consistent with sparse imported melodies. The trailing
 * span stays open for appending.
 */
function extractWindow(notes: Note[], pageStart: Fraction, windowBars: number): Note[] {
	const startF = fractionToFloat(pageStart);
	const endF = startF + windowBars;
	const inWindow = notes
		.filter((n) => {
			const o = fractionToFloat(n.offset);
			return o >= startF - 1e-9 && o < endF - 1e-9;
		})
		.sort((a, b) => compareFractions(a.offset, b.offset));

	const buffer: Note[] = [];
	let cursor: Fraction = [0, 1];
	for (const n of inWindow) {
		const local = subtractFractions(n.offset, pageStart);
		const gap = subtractFractions(local, cursor);
		if (gap[0] > 0) {
			buffer.push({ pitch: null, duration: gap, offset: cursor });
			cursor = addFractions(cursor, gap);
		}
		buffer.push({ ...n, offset: local });
		cursor = addFractions(cursor, n.duration);
	}
	return buffer;
}

/** True when the melody buffer can edit this sheet (4/4 only). */
export function melodyEditingSupported(): boolean {
	return tuneEntry.timeSignature[0] === 4 && tuneEntry.timeSignature[1] === 4;
}

/** Write the step-entry buffer back into the current section. */
export function commitBuffer(): void {
	if (!melodyEditingSupported()) return;
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return;
	sec.notes = mergeWindow(
		sec.notes,
		stepEntry.enteredNotes,
		pageStartFraction(tuneEntry.currentPage),
		pageWindowBars(sec, tuneEntry.currentPage)
	);
	sanitizeTies();
}

/**
 * Clear `tied` on any pitched note whose immediate flattened successor is
 * not a same-pitch note starting exactly at its end (sections concatenate,
 * so cross-section adjacency counts as contiguous). mergeWindow has no tie
 * handling, so a dangling head tie — its tail edited away on another page —
 * would otherwise render as a hanging tie. Legitimate cross-page split ties
 * satisfy the predicate and survive. Runs post-merge, when the whole tune
 * (current window included) lives in section notes.
 */
function sanitizeTies(): void {
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const flattened: { note: Note; absStart: Fraction }[] = [];
	let base: Fraction = [0, 1];
	for (const sec of tuneEntry.sections) {
		const sorted = [...sec.notes].sort((a, b) => compareFractions(a.offset, b.offset));
		for (const n of sorted) flattened.push({ note: n, absStart: addFractions(base, n.offset) });
		base = addFractions(base, [sec.bars * tsNum, tsDen]);
	}
	for (let i = 0; i < flattened.length; i++) {
		const cur = flattened[i];
		if (cur.note.pitch === null || !cur.note.tied) continue;
		const next = flattened[i + 1];
		const contiguous =
			next !== undefined &&
			next.note.pitch === cur.note.pitch &&
			compareFractions(addFractions(cur.absStart, cur.note.duration), next.absStart) === 0;
		if (!contiguous) cur.note.tied = false;
	}
}

/** Load a section page into the step-entry buffer (no commit). */
function loadBuffer(sectionIdx: number, pageIdx: number): void {
	// Every load path (page nav, section ops, resume, hydration) drops any
	// live entry cursor alongside the note selection.
	tuneEntry.entryCursor = null;
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	// The shared buffer interprets typed pitches at the SOURCE's transposition
	// while a tune is being edited (cleared by suspendEntryBuffer).
	stepEntry.transpositionOverride = entryTranspositionSemitones();
	if (!melodyEditingSupported()) {
		stepEntry.enteredNotes = [];
		stepEntry.selectedNoteIndex = null;
		stepEntry.phraseKey = tuneEntry.writtenKey;
		return;
	}
	const windowBars = pageWindowBars(sec, pageIdx);
	stepEntry.enteredNotes = extractWindow(sec.notes, pageStartFraction(pageIdx), windowBars);
	stepEntry.barCount = windowBars;
	stepEntry.selectedNoteIndex = null;
	stepEntry.phraseKey = tuneEntry.writtenKey;
}

/** Navigate to a section page, committing the current buffer first. */
export function loadPage(sectionIdx: number, pageIdx: number): void {
	commitBuffer();
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	const maxPage = Math.max(0, Math.ceil(sec.bars / PAGE_BARS) - 1);
	tuneEntry.currentSection = sectionIdx;
	tuneEntry.currentPage = Math.max(0, Math.min(pageIdx, maxPage));
	loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
}

/** Reset to a fresh single-section sheet. */
export function initNewTune(): void {
	resetStepEntry();
	tuneEntry.title = '';
	tuneEntry.composer = '';
	tuneEntry.style = '';
	tuneEntry.sourceTransposition = defaultSourceTransposition(getInstrument());
	tuneEntry.writtenKey = 'C';
	tuneEntry.timeSignature = [4, 4];
	tuneEntry.tags = [];
	tuneEntry.sections = [makeSection('A')];
	tuneEntry.currentSection = 0;
	tuneEntry.currentPage = 0;
	tuneEntry.editingId = null;
	tuneEntry.editingSource = null;
	tuneEntry.editingPdfUrl = null;
	tuneEntry.reviewHandoff = false;
	loadBuffer(0, 0);
	tuneEntry.importReview = null;
	tuneEntry.lastRefusal = null;
}

export const resetTuneEntry = initNewTune;

/** Hydrate the editor from an existing sheet (edit mode). */
export function loadFromTune(sheet: Tune, instrument: InstrumentConfig): void {
	resetStepEntry();
	tuneEntry.title = sheet.title;
	tuneEntry.composer = sheet.composer ?? '';
	tuneEntry.style = sheet.style ?? '';
	tuneEntry.sourceTransposition = defaultSourceTransposition(instrument);
	tuneEntry.writtenKey = transposePitchClass(
		sheet.key,
		sourceTranspositionSemitones(tuneEntry.sourceTransposition, instrument)
	);
	tuneEntry.timeSignature = [sheet.timeSignature[0], sheet.timeSignature[1]];
	tuneEntry.tags = [...sheet.tags];
	tuneEntry.sections = sheet.sections.map(cloneSection);
	tuneEntry.currentSection = 0;
	tuneEntry.currentPage = 0;
	tuneEntry.editingId = sheet.id;
	tuneEntry.editingSource = sheet.source;
	tuneEntry.editingPdfUrl = sheet.pdfUrl ?? null;
	tuneEntry.reviewHandoff = true;
	tuneEntry.importReview = null;
	loadBuffer(0, 0);
}

/** Attach import review notes AFTER a load (loads always clear them). */
export function setImportReview(
	review: { warnings: string[]; suspectBars: number[]; sourceBarImages?: string[] } | null
): void {
	tuneEntry.importReview =
		review && (review.warnings.length > 0 || !!review.sourceBarImages?.length)
			? { ...review, warnings: [...new Set(review.warnings)] }
			: null;
}

/**
 * Load an UNSAVED import draft for review: hydrates the editor but keeps it
 * in create mode (no editingId), so Save assigns a fresh id. Drafts that
 * already carry a pre-assigned id (the PDF flow, which stores the original
 * file under that id) should use `loadFromTune` instead.
 */
export function loadDraftForReview(sheet: Tune, instrument: InstrumentConfig): void {
	loadFromTune(sheet, instrument);
	tuneEntry.editingId = null;
	tuneEntry.editingSource = sheet.source;
}

/**
 * Build the current draft as a Tune, virtually merging the live buffer
 * (no state mutation) and converting the written key to concert once.
 */
export function buildDraftTune(): Tune {
	const concertKey = transposePitchClass(tuneEntry.writtenKey, -entryTranspositionSemitones());
	const sections = tuneEntry.sections.map((sec, i) => {
		const clone = cloneSection(sec);
		// Gate the virtual merge exactly like commitBuffer and
		// effectiveSectionNotes: on a non-4/4 sheet the buffer is EMPTY by
		// construction, and merging it would drop every stored note in the
		// current page window from the draft (the save path).
		if (i === tuneEntry.currentSection && melodyEditingSupported()) {
			clone.notes = mergeWindow(
				sec.notes,
				stepEntry.enteredNotes,
				pageStartFraction(tuneEntry.currentPage),
				pageWindowBars(sec, tuneEntry.currentPage)
			);
		}
		return clone;
	});
	const draft: Tune = {
		id: tuneEntry.editingId ?? '',
		title: tuneEntry.title.trim() || 'Untitled',
		key: concertKey,
		timeSignature: [tuneEntry.timeSignature[0], tuneEntry.timeSignature[1]],
		tags: [...tuneEntry.tags],
		sections,
		source: tuneEntry.editingSource ?? 'user'
	};
	if (tuneEntry.composer.trim()) draft.composer = tuneEntry.composer.trim();
	if (tuneEntry.style.trim()) draft.style = tuneEntry.style.trim();
	if (tuneEntry.editingPdfUrl) draft.pdfUrl = tuneEntry.editingPdfUrl;
	return draft;
}

/**
 * Flattened-note index of the buffer's first note — maps step-entry's
 * selection onto the full-sheet notation preview's anchor indices.
 */
export function flattenedBufferBase(): number {
	let base = 0;
	for (let i = 0; i < tuneEntry.currentSection; i++) {
		base += tuneEntry.sections[i]?.notes.length ?? 0;
	}
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (sec) {
		const startF = tuneEntry.currentPage * PAGE_BARS;
		base += sec.notes.filter((n) => fractionToFloat(n.offset) < startF - 1e-9).length;
	}
	return base;
}

/**
 * Park the editor when navigating away: commit the page into the section
 * list and empty the SHARED step-entry buffer so the lick entry page never
 * sees tune content. `resumeEntryBuffer` reloads the same page on
 * return without re-committing (the buffer is empty at that point).
 */
export function suspendEntryBuffer(): void {
	commitBuffer();
	stepEntry.enteredNotes = [];
	stepEntry.selectedNoteIndex = null;
	// Hand the shared buffer back to lick entry with instrument semantics.
	stepEntry.transpositionOverride = null;
}

/** Reload the current page into the buffer after a suspend. */
export function resumeEntryBuffer(): void {
	loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
}

// ─── Cursor layer (implicit paging) ─────────────────────────────────────

/** Pages in a section: ceil(bars / PAGE_BARS), at least 1. */
function sectionPageCount(sec: TuneSection): number {
	return Math.max(1, Math.ceil(sec.bars / PAGE_BARS));
}

/**
 * The page after (sectionIdx, pageIdx), crossing section boundaries.
 * Exported for tests. Returns null at the end of the form.
 */
export function nextPagePosition(
	sectionIdx: number,
	pageIdx: number
): { sectionIdx: number; pageIdx: number } | null {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return null;
	if (pageIdx + 1 < sectionPageCount(sec)) return { sectionIdx, pageIdx: pageIdx + 1 };
	if (sectionIdx + 1 < tuneEntry.sections.length) return { sectionIdx: sectionIdx + 1, pageIdx: 0 };
	return null;
}

/**
 * The page before (sectionIdx, pageIdx), crossing section boundaries.
 * Exported for tests. Returns null at the start of the form.
 */
export function prevPagePosition(
	sectionIdx: number,
	pageIdx: number
): { sectionIdx: number; pageIdx: number } | null {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return null;
	if (pageIdx > 0) return { sectionIdx, pageIdx: pageIdx - 1 };
	if (sectionIdx > 0) {
		return {
			sectionIdx: sectionIdx - 1,
			pageIdx: sectionPageCount(tuneEntry.sections[sectionIdx - 1]) - 1
		};
	}
	return null;
}

/**
 * Move the cursor to the stored note at a flattened index (a click on the
 * rendered chart). Commits first — flattened→(section, page, note) mapping is
 * only trustworthy post-commit — then navigates to the note's page and
 * selects the matching buffer element by page-local OFFSET (never index
 * arithmetic: extractWindow synthesizes gap rests). Non-4/4 sheets navigate
 * only. Returns false for a stale/out-of-range index (the commit stands, no
 * navigation happens).
 */
export function cursorToFlattened(flatIdx: number): boolean {
	commitBuffer();
	if (flatIdx < 0 || !Number.isInteger(flatIdx)) return false;
	let remaining = flatIdx;
	let sectionIdx = -1;
	let note: Note | null = null;
	for (let i = 0; i < tuneEntry.sections.length; i++) {
		const len = tuneEntry.sections[i].notes.length;
		if (remaining < len) {
			sectionIdx = i;
			note = tuneEntry.sections[i].notes[remaining];
			break;
		}
		remaining -= len;
	}
	if (!note || sectionIdx < 0) return false;

	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const barDuration = tsNum / tsDen;
	const bar = Math.floor(fractionToFloat(note.offset) / barDuration + 1e-9);
	const pageIdx = Math.floor(bar / PAGE_BARS);
	loadPage(sectionIdx, pageIdx);
	if (!melodyEditingSupported()) return true;

	const local = subtractFractions(note.offset, pageStartFraction(pageIdx));
	// Kind- and pitch-exact: extractWindow copies stored elements verbatim, so
	// a stored rest matches the buffer rest at the same offset (a synthesized
	// gap rest can share the offset only when the stored one isn't in-window).
	const bufferIdx = stepEntry.enteredNotes.findIndex(
		(n) => n.pitch === note.pitch && compareFractions(n.offset, local) === 0
	);
	if (bufferIdx >= 0) selectNote(bufferIdx);
	tuneEntry.entryCursor = null;
	return true;
}

/** Navigate to the next page (committing first). False at the form's end. */
export function advanceToNextPage(): boolean {
	const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
	if (!target) return false;
	loadPage(target.sectionIdx, target.pageIdx);
	return true;
}

/** Navigate to the previous page (committing first). False at the start. */
export function retreatToPrevPage(): boolean {
	const target = prevPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
	if (!target) return false;
	loadPage(target.sectionIdx, target.pageIdx);
	return true;
}

/** Reduce a raw numerator/denominator pair to a canonical Fraction. */
function makeFraction(num: number, den: number): Fraction {
	if (num === 0) return [0, 1];
	const g = gcd(Math.abs(num), den);
	return [num / g, den / g];
}

/**
 * Move the cursor to a bar/beat position (a click on empty chart space).
 * Loads the containing page; on 4/4 sheets it then arms cursor-mode entry at
 * the page-local offset (clamped to the page window) and clears the note
 * selection. Non-4/4 sheets navigate only. Invalid section indices no-op;
 * the bar is clamped into the section.
 */
export function cursorToBar(sectionIdx: number, barInSection: number, beatGuess?: number): void {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	const bar = Math.max(0, Math.min(sec.bars - 1, Math.floor(barInSection)));
	const pageIdx = Math.floor(bar / PAGE_BARS);
	loadPage(sectionIdx, pageIdx);
	if (!melodyEditingSupported()) return;

	const windowBars = pageWindowBars(sec, pageIdx);
	const barInPage = bar - pageIdx * PAGE_BARS;
	// Quantize the beat guess to sixteenths so fractional guesses still yield
	// integer fraction terms.
	let cursor = makeFraction(barInPage * 16 + Math.round((beatGuess ?? 0) * 4), 16);
	if (compareFractions(cursor, [0, 1]) < 0) cursor = [0, 1];
	if (compareFractions(cursor, [windowBars, 1]) > 0) cursor = [windowBars, 1];
	selectNote(null);
	tuneEntry.entryCursor = cursor;
}

/** The duration currently armed on the step-entry surface. */
function currentDurationFraction(): Fraction {
	return getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode);
}

/**
 * A section's notes with the live buffer treated as authoritative for the
 * current window (virtual merge, no mutation). Occupancy checks must run at
 * this level: imported notes can straddle page boundaries.
 */
function effectiveSectionNotes(sectionIdx: number): Note[] {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return [];
	if (sectionIdx === tuneEntry.currentSection && melodyEditingSupported()) {
		return mergeWindow(
			sec.notes,
			stepEntry.enteredNotes,
			pageStartFraction(tuneEntry.currentPage),
			pageWindowBars(sec, tuneEntry.currentPage)
		);
	}
	return sec.notes;
}

/** True when a PITCHED note in the section overlaps [spanStart, spanEnd). */
function spanHasPitchedCollision(
	sectionIdx: number,
	spanStart: Fraction,
	spanEnd: Fraction
): boolean {
	const startF = fractionToFloat(spanStart);
	const endF = fractionToFloat(spanEnd);
	return effectiveSectionNotes(sectionIdx).some((n) => {
		if (n.pitch === null) return false;
		const o = fractionToFloat(n.offset);
		return o < endF - 1e-9 && o + fractionToFloat(n.duration) > startF + 1e-9;
	});
}

/**
 * Octave-placement reference for cursor-mode entry: nearest pitched buffer
 * note PRECEDING the cursor, falling back to the nearest following one.
 */
function cursorModeReference(cursor: Fraction): number | null {
	let preceding: Note | null = null;
	let following: Note | null = null;
	for (const n of stepEntry.enteredNotes) {
		if (n.pitch === null) continue;
		if (compareFractions(n.offset, cursor) < 0) {
			if (!preceding || compareFractions(n.offset, preceding.offset) > 0) preceding = n;
		} else if (!following || compareFractions(n.offset, following.offset) < 0) {
			following = n;
		}
	}
	return preceding?.pitch ?? following?.pitch ?? null;
}

/**
 * Write a resolved note into the buffer at page-local offset `cursor`
 * through `spliceElement`: rests and pitched notes under its span are
 * overwritten alike (the one write policy since 2026-10-15), durations are
 * conserved and no later element's offset moves. Returns the note's index.
 */
function spliceNoteIntoBuffer(
	concert: number,
	duration: Fraction,
	cursor: Fraction,
	spelling?: 'sharp' | 'flat',
	tied?: boolean
): number {
	const newNote: Note = { pitch: concert, duration, offset: cursor };
	if (spelling) newNote.spelling = spelling;
	if (tied) newNote.tied = true;
	const { notes, index } = spliceElement(stepEntry.enteredNotes, newNote);
	stepEntry.enteredNotes = notes;
	return index;
}

/** Bars covered by the current page's window. */
function currentWindowBars(): number {
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	return sec ? pageWindowBars(sec, tuneEntry.currentPage) : PAGE_BARS;
}

/**
 * Hop the entry cursor onto the next page, carrying any overshoot past the
 * window end as the new page-local cursor. Returns false at the end of the
 * form (no mutation).
 */
function hopCursorToNextPage(cursor: Fraction): boolean {
	const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
	if (!target) return false;
	const overshoot = subtractFractions(cursor, [currentWindowBars(), 1]);
	loadPage(target.sectionIdx, target.pageIdx);
	tuneEntry.entryCursor = compareFractions(overshoot, [0, 1]) > 0 ? overshoot : [0, 1];
	return true;
}

/** The last pitched note in the buffer (append-mode octave reference). */
function lastPitchedInBuffer(): number | null {
	for (let i = stepEntry.enteredNotes.length - 1; i >= 0; i--) {
		const pitch = stepEntry.enteredNotes[i].pitch;
		if (pitch !== null) return pitch;
	}
	return null;
}

/**
 * Enter a note through the tune-entry cursor layer.
 *
 * Append mode (entryCursor null) delegates to step-entry while the page has
 * capacity; on exhaustion it auto-advances — splitting the note across the
 * page boundary with a tie when the page is partially full. Cursor mode
 * inserts at the cursor, overwriting rests and blocking on pitched notes
 * (section-level occupancy). Returns false without mutation when blocked,
 * out of range, or at the end of the form.
 */
export function tuneAddNote(
	pitchClass: number,
	octave: number,
	accidental: 'sharp' | 'flat' | 'natural'
): boolean {
	if (!melodyEditingSupported()) return false;
	const duration = currentDurationFraction();
	// Insert mode (phase 4): a note goes in front of the selection or the
	// cursor and pushes the SECTION later, across pages.
	if (stepEntry.insertMode && (isEditSelection() || tuneEntry.entryCursor !== null)) {
		const local = isEditSelection()
			? stepEntry.enteredNotes[stepEntry.selectedNoteIndex as number].offset
			: (tuneEntry.entryCursor as Fraction);
		const concert = resolveEntryPitch(pitchClass, octave, accidental, cursorModeReference(local));
		if (concert === null) return false;
		return insertInSection(local, { pitch: concert, duration });
	}
	// A clicked or arrowed element is replaced in place by step-entry's own
	// edit path (bounded by the page window, which is the buffer's capacity).
	if (isEditSelection()) return stepAddNote(pitchClass, octave, accidental);

	if (tuneEntry.entryCursor !== null) {
		const cursor = tuneEntry.entryCursor;
		const windowEnd: Fraction = [currentWindowBars(), 1];
		// At (or past) the page window end: hop first, then insert there.
		if (compareFractions(cursor, windowEnd) >= 0) {
			if (!hopCursorToNextPage(cursor)) return false;
			return tuneAddNote(pitchClass, octave, accidental);
		}
		const concert = resolveEntryPitch(pitchClass, octave, accidental, cursorModeReference(cursor));
		if (concert === null) return false;
		if (compareFractions(addFractions(cursor, duration), windowEnd) > 0) {
			// Overhanging the window: split with a tie across the page boundary,
			// as append mode does (phase 4 — this used to be refused).
			const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
			if (!target) return false;
			const headDuration = subtractFractions(windowEnd, cursor);
			const tailDuration = subtractFractions(duration, headDuration);
			const headAbsOffset = addFractions(pageStartFraction(tuneEntry.currentPage), cursor);
			const headSectionIdx = tuneEntry.currentSection;
			spliceNoteIntoBuffer(concert, headDuration, cursor, undefined, true);
			loadPage(target.sectionIdx, target.pageIdx); // commits the head
			markEntered(spliceNoteIntoBuffer(concert, tailDuration, [0, 1]));
			stepEntry.accidental = 'natural';
			tuneEntry.entryCursor = tailDuration;
			restoreTie(headSectionIdx, headAbsOffset, concert);
			return true;
		}
		markEntered(spliceNoteIntoBuffer(concert, duration, cursor));
		stepEntry.accidental = 'natural';
		tuneEntry.entryCursor = addFractions(cursor, duration);
		return true;
	}

	// Append mode.
	if (canAddDuration(duration)) return stepAddNote(pitchClass, octave, accidental);
	const remaining = getRemainingCapacity();
	const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
	if (target === null) return false; // end of form: hard stop, zero mutation

	if (compareFractions(remaining, [0, 1]) > 0) {
		// Split with tie: head fills this page, tail starts the next.
		const concert = resolveEntryPitch(pitchClass, octave, accidental, lastPitchedInBuffer());
		if (concert === null) return false; // range reject, no navigation
		const tailDuration = subtractFractions(duration, remaining);
		const headOffset = getCurrentCursorOffset();
		const headAbsOffset = addFractions(pageStartFraction(tuneEntry.currentPage), headOffset);
		const headSectionIdx = tuneEntry.currentSection;
		stepEntry.enteredNotes.push({ pitch: concert, duration: remaining, offset: headOffset, tied: true });
		loadPage(target.sectionIdx, target.pageIdx); // commits the head
		markEntered(spliceNoteIntoBuffer(concert, tailDuration, [0, 1]));
		stepEntry.accidental = 'natural';
		tuneEntry.entryCursor = addFractions([0, 1], tailDuration);
		// The commit's tie sweep cleared the head's tie (its tail did not exist
		// yet) — restore it now that the tail is in the buffer.
		restoreTie(headSectionIdx, headAbsOffset, concert);
		return true;
	}

	// Page exactly full: roll onto the next page and insert at its start.
	loadPage(target.sectionIdx, target.pageIdx);
	tuneEntry.entryCursor = [0, 1];
	return tuneAddNote(pitchClass, octave, accidental);
}

/** Re-mark a committed note as tied (post-commit tie restoration). */
function restoreTie(sectionIdx: number, absOffset: Fraction, pitch: number): void {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	const head = sec.notes.find(
		(n) => n.pitch === pitch && compareFractions(n.offset, absOffset) === 0
	);
	if (head) head.tied = true;
}

/**
 * Enter a rest through the cursor layer. Append mode delegates to
 * step-entry. Cursor mode never mutates the buffer — silence is the absence
 * of notes — it just advances the cursor (clamped to the page window end; a
 * press at the window end hops to the next page; false at the end of the
 * form).
 */
export function tuneAddRest(): boolean {
	if (!melodyEditingSupported()) return false;
	if (stepEntry.insertMode && (isEditSelection() || tuneEntry.entryCursor !== null)) {
		const local = isEditSelection()
			? stepEntry.enteredNotes[stepEntry.selectedNoteIndex as number].offset
			: (tuneEntry.entryCursor as Fraction);
		return insertInSection(local, { pitch: null, duration: currentDurationFraction() });
	}
	if (isEditSelection() || tuneEntry.entryCursor === null) return stepAddRest();
	const cursor = tuneEntry.entryCursor;
	const windowEnd: Fraction = [currentWindowBars(), 1];
	if (compareFractions(cursor, windowEnd) >= 0) return hopCursorToNextPage(cursor);
	let next = addFractions(cursor, currentDurationFraction());
	if (compareFractions(next, windowEnd) > 0) next = windowEnd;
	tuneEntry.entryCursor = next;
	return true;
}

/**
 * Enter a tied note through the cursor layer. Append mode delegates to
 * step-entry; on capacity exhaustion it follows the same split path as
 * tuneAddNote (head = the remaining capacity, tied; tail on the next page).
 * Cursor mode ties only off a pitched element ending exactly at the cursor.
 */
export function tuneEnterTiedNote(): boolean {
	if (!melodyEditingSupported()) return false;
	if (isEditSelection()) return stepEnterTiedNote();
	const duration = currentDurationFraction();

	if (tuneEntry.entryCursor !== null) {
		const cursor = tuneEntry.entryCursor;
		const prev = stepEntry.enteredNotes.find(
			(n) => compareFractions(addFractions(n.offset, n.duration), cursor) === 0
		);
		if (!prev || prev.pitch === null) return false;
		const atWindowEnd = compareFractions(cursor, [currentWindowBars(), 1]) >= 0;
		if (atWindowEnd) {
			// Tie across the page boundary: pre-flight the tail span, hop, splice.
			const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
			if (!target) return false;
			const pitch = prev.pitch;
			const spelling = prev.spelling;
			const prevAbsOffset = addFractions(pageStartFraction(tuneEntry.currentPage), prev.offset);
			const prevSectionIdx = tuneEntry.currentSection;
			loadPage(target.sectionIdx, target.pageIdx);
			markEntered(spliceNoteIntoBuffer(pitch, duration, [0, 1], spelling));
			tuneEntry.entryCursor = addFractions([0, 1], duration);
			restoreTie(prevSectionIdx, prevAbsOffset, pitch);
			return true;
		}
		// Same window-fit pre-flight as tuneAddNote: a mid-window tie may not
		// overhang the window (nor, on the last window, the section) end.
		if (compareFractions(addFractions(cursor, duration), [currentWindowBars(), 1]) > 0) {
			return false;
		}
		const prevOffset = prev.offset;
		markEntered(spliceNoteIntoBuffer(prev.pitch, duration, cursor, prev.spelling));
		// The splice rebuilt the buffer: re-find the head by offset to tie it.
		const head = stepEntry.enteredNotes.find((n) => compareFractions(n.offset, prevOffset) === 0);
		if (head) head.tied = true;
		tuneEntry.entryCursor = addFractions(cursor, duration);
		return true;
	}

	// Append mode.
	if (canAddDuration(duration)) return stepEnterTiedNote();
	const last = stepEntry.enteredNotes.at(-1);
	if (!last || last.pitch === null) return false;
	const remaining = getRemainingCapacity();
	const target = nextPagePosition(tuneEntry.currentSection, tuneEntry.currentPage);
	if (target === null) return false;
	const tailDuration = subtractFractions(duration, remaining);
	const pitch = last.pitch;
	const spelling = last.spelling;
	const lastSectionIdx = tuneEntry.currentSection;

	if (compareFractions(remaining, [0, 1]) > 0) {
		// prev –tie– head fills the page –tie– tail on the next page.
		const headOffset = getCurrentCursorOffset();
		const headAbsOffset = addFractions(pageStartFraction(tuneEntry.currentPage), headOffset);
		last.tied = true;
		const head: Note = { pitch, duration: remaining, offset: headOffset, tied: true };
		if (spelling) head.spelling = spelling;
		stepEntry.enteredNotes.push(head);
		loadPage(target.sectionIdx, target.pageIdx); // commits prev + head
		markEntered(spliceNoteIntoBuffer(pitch, tailDuration, [0, 1], spelling));
		tuneEntry.entryCursor = addFractions([0, 1], tailDuration);
		restoreTie(lastSectionIdx, headAbsOffset, pitch);
		return true;
	}

	// Page exactly full: tie the committed last note straight to the tail.
	const lastAbsOffset = addFractions(pageStartFraction(tuneEntry.currentPage), last.offset);
	loadPage(target.sectionIdx, target.pageIdx);
	markEntered(spliceNoteIntoBuffer(pitch, tailDuration, [0, 1], spelling));
	tuneEntry.entryCursor = addFractions([0, 1], tailDuration);
	restoreTie(lastSectionIdx, lastAbsOffset, pitch);
	return true;
}

/** Escape hatch: drop cursor mode, returning to append-at-end entry. */
export function clearEntryCursor(): void {
	tuneEntry.entryCursor = null;
}

// ─── Insert with push (phase 4, 2026-10-16) ─────────────────────────────

/**
 * MuseScore's Insert at the SECTION level: `element` goes in front of
 * whatever starts at page-local `local` (an offset inside an element snaps
 * to that element's start) and every later note in the section moves later
 * by its length, across page boundaries; chords stay with the form. Refused
 * — `lastRefusal` 'insert-no-room', nothing changed — when a pitched note
 * would be pushed past the section's end; a rest pushed past it is trimmed.
 * Afterwards the page holding the insertion reloads: with an edit selection
 * the pushed element stays selected (a run of letters inserts in order),
 * in cursor mode the inserted note is the entry edge and the cursor sits
 * after it.
 */
function insertInSection(local: Fraction, element: { pitch: number | null; duration: Fraction }): boolean {
	const wasEdit = isEditSelection();
	const pageStart = pageStartFraction(tuneEntry.currentPage);
	const absOffset = addFractions(pageStart, local);
	commitBuffer();
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return false;
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const sectionEnd: Fraction = [sec.bars * tsNum, tsDen];
	const sorted = [...sec.notes].sort((a, b) => compareFractions(a.offset, b.offset));
	const containing = sorted.find(
		(n) => compareFractions(n.offset, absOffset) < 0 && compareFractions(addFractions(n.offset, n.duration), absOffset) > 0
	);
	const at = containing ? containing.offset : absOffset;
	if (compareFractions(addFractions(at, element.duration), sectionEnd) > 0) {
		tuneEntry.lastRefusal = 'insert-no-room';
		return false;
	}
	const shifted = sorted.map((n) =>
		compareFractions(n.offset, at) >= 0 ? { ...n, offset: addFractions(n.offset, element.duration) } : { ...n }
	);
	const overflow = shifted.some(
		(n) => n.pitch !== null && compareFractions(addFractions(n.offset, n.duration), sectionEnd) > 0
	);
	if (overflow) {
		tuneEntry.lastRefusal = 'insert-no-room';
		return false;
	}
	const kept = shifted
		.filter((n) => compareFractions(n.offset, sectionEnd) < 0)
		.map((n) =>
			compareFractions(addFractions(n.offset, n.duration), sectionEnd) > 0
				? { ...n, duration: subtractFractions(sectionEnd, n.offset) }
				: n
		);
	sec.notes = [...kept, { ...element, offset: at }].sort((a, b) => compareFractions(a.offset, b.offset));
	sanitizeTies();
	tuneEntry.lastRefusal = null;
	// Reload WITHOUT committing: the buffer still holds the page as it was
	// before the section-level edit, and a commit would write it back over it.
	const bar = Math.floor(fractionToFloat(at) + 1e-9);
	tuneEntry.currentPage = Math.floor(bar / PAGE_BARS);
	loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
	const localAt = subtractFractions(at, pageStartFraction(tuneEntry.currentPage));
	const insertedIdx = stepEntry.enteredNotes.findIndex(
		(n) => n.pitch === element.pitch && compareFractions(n.offset, localAt) === 0
	);
	if (insertedIdx < 0) return true;
	if (wasEdit) {
		const pushed = insertedIdx + 1;
		if (pushed < stepEntry.enteredNotes.length) selectNote(pushed, 'edit');
		else selectNote(null);
	} else {
		markEntered(insertedIdx);
		tuneEntry.entryCursor = addFractions(localAt, element.duration);
	}
	stepEntry.accidental = 'natural';
	return true;
}

// ─── Bar operations (phase 4, 2026-10-16) ───────────────────────────────

/**
 * Insert an empty bar in front of bar `barInSection` of a section (at
 * `sec.bars`, append one): the section grows by a bar and every note and
 * chord from that bar on moves a bar later; the chord in force extends
 * across the new bar. A note straddling the insertion point stays put.
 */
export function insertBar(index: number, barInSection: number): void {
	const sec = tuneEntry.sections[index];
	if (!sec || sec.bars >= MAX_SECTION_BARS) return;
	if (index === tuneEntry.currentSection) commitBuffer();
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const barLen: Fraction = [tsNum, tsDen];
	const bar = Math.max(0, Math.min(sec.bars, Math.floor(barInSection)));
	const at: Fraction = [bar * tsNum, tsDen];
	sec.bars += 1;
	sec.notes = sec.notes.map((n) =>
		compareFractions(n.offset, at) >= 0 ? { ...n, offset: addFractions(n.offset, barLen) } : n
	);
	sec.harmony = sec.harmony.map((h) =>
		compareFractions(h.startOffset, at) >= 0 ? { ...h, startOffset: addFractions(h.startOffset, barLen) } : h
	);
	recomputeHarmonyDurations(sec);
	if (index === tuneEntry.currentSection) loadBuffer(index, Math.min(tuneEntry.currentPage, Math.ceil(sec.bars / PAGE_BARS) - 1));
}

/**
 * Delete bar `barInSection` of a section with everything in it: its notes
 * and the chords that start in it go, a note running into it from before is
 * trimmed at its start, and every later note and chord moves a bar earlier;
 * the chord in force before it extends over the join. A section always keeps
 * at least one bar.
 */
export function deleteBar(index: number, barInSection: number): void {
	const sec = tuneEntry.sections[index];
	if (!sec || sec.bars <= 1) return;
	if (index === tuneEntry.currentSection) commitBuffer();
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const barLen: Fraction = [tsNum, tsDen];
	const bar = Math.max(0, Math.min(sec.bars - 1, Math.floor(barInSection)));
	const start: Fraction = [bar * tsNum, tsDen];
	const end = addFractions(start, barLen);
	const notes: Note[] = [];
	for (const n of sec.notes) {
		const nEnd = addFractions(n.offset, n.duration);
		if (compareFractions(n.offset, start) < 0) {
			notes.push(compareFractions(nEnd, start) > 0 ? { ...n, duration: subtractFractions(start, n.offset), tied: false } : n);
		} else if (compareFractions(n.offset, end) >= 0) {
			notes.push({ ...n, offset: subtractFractions(n.offset, barLen) });
		}
	}
	sec.notes = notes;
	sec.harmony = sec.harmony
		.filter((h) => compareFractions(h.startOffset, start) < 0 || compareFractions(h.startOffset, end) >= 0)
		.map((h) =>
			compareFractions(h.startOffset, end) >= 0 ? { ...h, startOffset: subtractFractions(h.startOffset, barLen) } : h
		);
	sec.bars -= 1;
	recomputeHarmonyDurations(sec);
	sanitizeTies();
	if (index === tuneEntry.currentSection) {
		const maxPage = Math.max(0, Math.ceil(sec.bars / PAGE_BARS) - 1);
		loadBuffer(index, Math.min(tuneEntry.currentPage, maxPage));
		tuneEntry.currentPage = Math.min(tuneEntry.currentPage, maxPage);
	}
}

// ─── Delete (2026-10-15) ─────────────────────────────────────────────────

/**
 * Outcome of a tune-level delete, for the editor's status line: `rested`
 * (a note became a rest), `removed` (an element and its time went),
 * `no-selection` (refused: nothing selected on a page that is not the
 * section's end), `lead-in` (refused: the pickup's lead-in rest), `empty`.
 */
export type TuneDeleteResult = 'rested' | 'removed' | 'empty' | 'no-selection' | 'lead-in';

/** True when the current section stores nothing beyond the current page window. */
function bufferEndIsSectionEnd(): boolean {
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return true;
	const endF = fractionToFloat(pageStartFraction(tuneEntry.currentPage)) + currentWindowBars();
	return sec.notes.every((n) => fractionToFloat(n.offset) < endF - 1e-9);
}

/** The pickup sheet shape the resolver reads. */
function currentSheet(): { timeSignature: [number, number]; sections: TuneSection[] } {
	return { timeSignature: tuneEntry.timeSignature, sections: tuneEntry.sections };
}

/**
 * True when buffer element `bufferIdx` is (or has absorbed) the pickup's
 * lead-in rest: a rest at offset 0 on page 0 of a section whose first bar
 * is an anacrusis. The Pickup control owns that silence — removing its time
 * would pull the pickup onto beat 1 and invalidate `pickupLength`.
 */
function isLeadInRest(bufferIdx: number): boolean {
	const el = stepEntry.enteredNotes[bufferIdx];
	if (!el || el.pitch !== null || tuneEntry.currentPage !== 0) return false;
	if (compareFractions(el.offset, [0, 1]) !== 0) return false;
	return resolvePickupLength(currentSheet(), tuneEntry.currentSection) !== null;
}

/**
 * Remove buffer element `bufferIdx` AND its time from the SECTION, not the
 * page: commit, drop the stored element, pull every later note in the
 * section earlier by its duration — across page boundaries, so the hidden
 * pager never shows through as a hole at the page's end — leave the
 * section's tail silent, keep the harmony where it is (chords belong to the
 * form), repair ties, reload the page. Selection lands on the element that slid
 * into the removed one's place (edit intent — the keys act on the
 * selection, and the note before would be the wrong one), else the one
 * ending there; the bar cursor is cleared like any edit selection.
 */
function removeTimeInSection(bufferIdx: number): void {
	const el = stepEntry.enteredNotes[bufferIdx];
	if (!el) return;
	removeSpanInSection(el.offset, addFractions(el.offset, el.duration));
}

/**
 * Remove the page-local span [localStart, localEnd) from the SECTION with
 * everything in it: stored elements inside it go, one running in from before
 * is trimmed at its start, one running out past its end keeps its tail, and
 * every later note moves earlier by the span's length, across pages. Harmony
 * never moves. The page reloads with the element now at the span's start
 * selected (edit intent), else the one ending there.
 */
function removeSpanInSection(localStart: Fraction, localEnd: Fraction): void {
	const local = localStart;
	const pageStart = pageStartFraction(tuneEntry.currentPage);
	const absStart = addFractions(pageStart, localStart);
	const absEnd = addFractions(pageStart, localEnd);
	const span = subtractFractions(absEnd, absStart);
	commitBuffer();
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return;
	const kept: Note[] = [];
	for (const n of sec.notes) {
		const nEnd = addFractions(n.offset, n.duration);
		if (compareFractions(nEnd, absStart) <= 0) {
			kept.push(n);
		} else if (compareFractions(n.offset, absEnd) >= 0) {
			kept.push({ ...n, offset: subtractFractions(n.offset, span) });
		} else if (compareFractions(n.offset, absStart) < 0) {
			const head: Note = { ...n, duration: subtractFractions(absStart, n.offset) };
			if (head.tied) head.tied = false;
			kept.push(head);
			if (compareFractions(nEnd, absEnd) > 0) kept.push({ ...n, offset: absStart, duration: subtractFractions(nEnd, absEnd) });
		} else if (compareFractions(nEnd, absEnd) > 0) {
			kept.push({ ...n, offset: absStart, duration: subtractFractions(nEnd, absEnd) });
		}
	}
	sec.notes = kept.sort((a, b) => compareFractions(a.offset, b.offset));
	sanitizeTies();
	loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
	const notes = stepEntry.enteredNotes;
	let sel = notes.findIndex((n) => compareFractions(n.offset, local) === 0);
	if (sel < 0) sel = notes.findIndex((n) => compareFractions(addFractions(n.offset, n.duration), local) === 0);
	selectNote(sel >= 0 ? sel : null, 'edit');
}

/**
 * Turn buffer element `target` into a rest in place (MuseScore's Del),
 * merged with any rest neighbours in its bar. The rest stays selected (edit
 * intent), so the rail reads it and the next typed note fills it — unless the
 * bar now holds no pitched note at all: such a bar engraves as slashes,
 * which carry no click anchor, so a selection there would be invisible; the
 * selection clears and the cursor parks at the bar's first entry beat (past
 * the lead-in on a pickup bar) instead.
 */
function restInPlace(target: number): void {
	const { notes: merged, indexMap } = coalesceRests(replaceWithRest(stepEntry.enteredNotes, target));
	stepEntry.enteredNotes = merged;
	const restIdx = indexMap[target];
	const rest = merged[restIdx];
	const bar = Math.floor(fractionToFloat(rest.offset) + 1e-9);
	const barStartAbs = addFractions(pageStartFraction(tuneEntry.currentPage), [bar, 1]);
	const barHasPitch = spanHasPitchedCollision(
		tuneEntry.currentSection,
		barStartAbs,
		addFractions(barStartAbs, [1, 1])
	);
	if (barHasPitch) {
		// The selected rest is the position: the rail reads it, letters fill it.
		selectNote(restIdx, 'edit');
		tuneEntry.entryCursor = null;
		return;
	}
	let cursor: Fraction = [bar, 1];
	if (bar === 0 && tuneEntry.currentPage === 0) {
		const pickup = resolvePickupLength(currentSheet(), tuneEntry.currentSection);
		if (pickup !== null) cursor = pickupPrefix(pickup, tuneEntry.timeSignature);
	}
	stepEntry.selectedNoteIndex = null;
	tuneEntry.entryCursor = cursor;
}

/**
 * The tune editor's Backspace/Delete. A NOTE before the section's end
 * becomes a rest (`restInPlace`); a REST removes its time section-wide
 * (`removeTimeInSection`); the section's LAST element is removed outright —
 * nothing follows it, so this is the entry flow's "remove what I just
 * typed". With no selection, the same fallback applies only where the page
 * end is the section's end; elsewhere the delete is refused rather than
 * guessing. The pickup lead-in rest is always refused.
 */
export function tuneDeleteSelected(): TuneDeleteResult {
	if (!melodyEditingSupported()) return 'empty';
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return 'empty';
	if (rangeBounds()) {
		// A range rests the whole passage in place (MuseScore's Del on a range).
		deleteSelectedNote();
		tuneEntry.entryCursor = null;
		return 'rested';
	}
	const sel = stepEntry.selectedNoteIndex;
	const target = sel !== null && sel >= 0 && sel < notes.length ? sel : null;
	const sectionEnd = bufferEndIsSectionEnd();
	if (target === null) {
		if (!sectionEnd) return 'no-selection';
		if (isLeadInRest(notes.length - 1)) return 'lead-in';
		deleteSelectedNote();
		tuneEntry.entryCursor = null;
		return 'removed';
	}
	const el = notes[target];
	const isLast = target === notes.length - 1 && sectionEnd;
	if (el.pitch !== null && !isLast) {
		restInPlace(target);
		return 'rested';
	}
	if (isLeadInRest(target)) return 'lead-in';
	if (isLast) {
		deleteSelectedNote();
		tuneEntry.entryCursor = null;
		return 'removed';
	}
	removeTimeInSection(target);
	return 'removed';
}

/**
 * The explicit remove-time gesture (Ctrl/⌘ + Backspace): the selected
 * element — note or rest — and its time go, section-wide. Same no-selection
 * and lead-in refusals as `tuneDeleteSelected`.
 */
export function tuneRemoveSelectedTime(): TuneDeleteResult {
	if (!melodyEditingSupported()) return 'empty';
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return 'empty';
	const range = rangeBounds();
	if (range) {
		if (isLeadInRest(range.start)) return 'lead-in';
		const last = notes[range.end];
		removeSpanInSection(notes[range.start].offset, addFractions(last.offset, last.duration));
		return 'removed';
	}
	const sel = stepEntry.selectedNoteIndex;
	const target = sel !== null && sel >= 0 && sel < notes.length ? sel : null;
	if (target === null) {
		if (!bufferEndIsSectionEnd()) return 'no-selection';
		if (isLeadInRest(notes.length - 1)) return 'lead-in';
		removeSelectedTime();
		tuneEntry.entryCursor = null;
		return 'removed';
	}
	if (isLeadInRest(target)) return 'lead-in';
	removeTimeInSection(target);
	return 'removed';
}

/**
 * Shift+click on the chart: extend the range to the clicked element when it
 * lies in the current page's buffer (ranges never cross pages); otherwise a
 * plain select there (`cursorToFlattened`).
 */
export function selectRangeToFlattened(flatIdx: number): boolean {
	if (!melodyEditingSupported()) return cursorToFlattened(flatIdx);
	const base = flattenedBufferBase();
	const local = flatIdx - base;
	if (stepEntry.selectedNoteIndex !== null && local >= 0 && local < stepEntry.enteredNotes.length) {
		selectRangeTo(local);
		return true;
	}
	return cursorToFlattened(flatIdx);
}

/** All stored notes in flattened (section) order. Trustworthy post-commit. */
function flattenedStoredNotes(): Note[] {
	const out: Note[] = [];
	for (const sec of tuneEntry.sections) out.push(...sec.notes);
	return out;
}

/**
 * Step the selection to the next element — note or rest, MuseScore-style —
 * crossing page and section boundaries. Delegates to step-entry's selectNext
 * while a later element exists in the buffer (preserving its null-selection
 * start-at-0 fallback); otherwise commits and hops to the tune's next stored
 * element. Pure gaps have no stored element, so empty pages and sections are
 * still skipped. No-op at the tune's last element.
 */
export function selectNextAcrossPages(): void {
	if (!melodyEditingSupported()) return;
	const notes = stepEntry.enteredNotes;
	const sel = stepEntry.selectedNoteIndex;
	const start = sel !== null ? sel + 1 : 0;
	if (start < notes.length) {
		selectNext();
		tuneEntry.entryCursor = null; // selection and cursor are exclusive
		return;
	}
	commitBuffer();
	const startFlat = flattenedBufferBase() + (sel !== null ? sel + 1 : notes.length);
	const flat = flattenedStoredNotes();
	if (startFlat < flat.length) {
		cursorToFlattened(startFlat);
	}
}

/**
 * Symmetric counterpart of selectNextAcrossPages: preserves selectPrev's
 * null-selection select-last-in-buffer behavior, crossing pages only from
 * the buffer's first element (or an empty buffer).
 */
export function selectPrevAcrossPages(): void {
	if (!melodyEditingSupported()) return;
	const notes = stepEntry.enteredNotes;
	const sel = stepEntry.selectedNoteIndex;
	const end = sel !== null ? sel : notes.length;
	if (end - 1 >= 0) {
		selectPrev();
		tuneEntry.entryCursor = null; // selection and cursor are exclusive
		return;
	}
	commitBuffer();
	const startFlat = flattenedBufferBase() + (sel ?? 0) - 1;
	const flat = flattenedStoredNotes();
	const f = Math.min(startFlat, flat.length - 1);
	if (f >= 0) {
		cursorToFlattened(f);
	}
}

/** Flattened (all-sections) index of stored note `noteIdx` of section `sectionIdx`. */
function flattenedIndexOfStored(sectionIdx: number, noteIdx: number): number {
	let base = 0;
	for (let i = 0; i < sectionIdx; i++) base += tuneEntry.sections[i]?.notes.length ?? 0;
	return base + noteIdx;
}

/** Absolute bar (4/4 whole notes) of a stored note's offset. */
function storedBarOf(note: Note): number {
	return Math.floor(fractionToFloat(note.offset) + 1e-9);
}

/**
 * MuseScore's Ctrl+←/→ across pages: select the first stored element of the
 * next bar (or of the previous one — from inside a bar, ← goes to that
 * bar's first element first), loading its page. A bar with nothing stored
 * in it arms the bar cursor there instead, so the step never stalls on
 * silence; a step past the section's ends changes nothing.
 */
export function selectBarAcrossPages(direction: 1 | -1): void {
	if (!melodyEditingSupported()) return;
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	const pos = entryCursorPosition();
	if (!sec || !pos) return;
	let targetBar = pos.barInSection + direction;
	const sel = stepEntry.selectedNoteIndex;
	if (sel !== null && direction < 0) {
		const notes = stepEntry.enteredNotes;
		const localBar = Math.floor(fractionToFloat(notes[sel].offset) + 1e-9);
		const firstOfBar = notes.findIndex((n) => Math.floor(fractionToFloat(n.offset) + 1e-9) === localBar);
		if (firstOfBar !== sel) targetBar = pos.barInSection;
	}
	if (targetBar < 0 || targetBar >= sec.bars) return;
	commitBuffer();
	const sorted = [...sec.notes].sort((a, b) => compareFractions(a.offset, b.offset));
	const noteIdx = sorted.findIndex((n) => storedBarOf(n) === targetBar);
	if (noteIdx >= 0) {
		cursorToFlattened(flattenedIndexOfStored(tuneEntry.currentSection, noteIdx));
	} else {
		cursorToBar(tuneEntry.currentSection, targetBar, 0);
	}
}

/** Home: select the current section's first stored element (its page loads); an empty section arms the cursor at bar 1. */
export function selectFirstInSection(): void {
	if (!melodyEditingSupported()) return;
	commitBuffer();
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec) return;
	if (sec.notes.length === 0) {
		cursorToBar(tuneEntry.currentSection, 0, 0);
		return;
	}
	cursorToFlattened(flattenedIndexOfStored(tuneEntry.currentSection, 0));
}

/** End: select the current section's last stored element (its page loads). */
export function selectLastInSection(): void {
	if (!melodyEditingSupported()) return;
	commitBuffer();
	const sec = tuneEntry.sections[tuneEntry.currentSection];
	if (!sec || sec.notes.length === 0) return;
	cursorToFlattened(flattenedIndexOfStored(tuneEntry.currentSection, sec.notes.length - 1));
}

/**
 * Where the next entered note will land: section, bar and beat (quarters).
 * Falls back to the append cursor when no entry cursor is armed. Null when
 * melody editing is unsupported (non-4/4).
 */
export function entryCursorPosition(): {
	sectionIdx: number;
	barInSection: number;
	beatInBar: number;
} | null {
	if (!melodyEditingSupported()) return null;
	// A clicked or arrowed element IS the position (letters replace it there);
	// else the bar-click cursor; else the page's append edge.
	const selected = isEditSelection() ? stepEntry.enteredNotes[stepEntry.selectedNoteIndex as number] : null;
	const local = selected?.offset ?? tuneEntry.entryCursor ?? getCurrentCursorOffset();
	const abs = fractionToFloat(local) + tuneEntry.currentPage * PAGE_BARS;
	const barInSection = Math.floor(abs + 1e-9);
	const beatInBar = Math.max(0, (abs - barInSection) * 4);
	return { sectionIdx: tuneEntry.currentSection, barInSection, beatInBar };
}

// ─── Sections ───────────────────────────────────────────────────────────

const SECTION_LABELS = 'ABCDEFGH';

/** Append a new section (auto-labeled) and navigate to it. */
export function addSection(): void {
	commitBuffer();
	const label = SECTION_LABELS[tuneEntry.sections.length % SECTION_LABELS.length];
	tuneEntry.sections.push(makeSection(label));
	tuneEntry.currentSection = tuneEntry.sections.length - 1;
	tuneEntry.currentPage = 0;
	loadBuffer(tuneEntry.currentSection, 0);
}

/** Remove a section; the sheet always keeps at least one. */
export function removeSection(index: number): void {
	if (tuneEntry.sections.length <= 1) return;
	if (index < 0 || index >= tuneEntry.sections.length) return;
	if (index !== tuneEntry.currentSection) commitBuffer();
	tuneEntry.sections.splice(index, 1);
	if (tuneEntry.currentSection >= index) {
		tuneEntry.currentSection = Math.max(0, tuneEntry.currentSection - 1);
	}
	tuneEntry.currentPage = 0;
	loadBuffer(tuneEntry.currentSection, 0);
}

/**
 * The tune's opening pickup: section 0's printed first-bar length, whether
 * the pickup is its own unlabeled one-bar section (the shape the Pickup
 * control creates and the importers write) or embedded in a labelled
 * section (an import whose rehearsal mark sits on the anacrusis bar, or a
 * pickup section the user has since labelled). Explicit field or legacy
 * inference alike — the same resolver the chart reads — and null when the
 * first bar is full.
 */
export function tunePickupLength(): Fraction | null {
	return resolvePickupLength({ timeSignature: tuneEntry.timeSignature, sections: tuneEntry.sections }, 0);
}

/**
 * True when the opening pickup is its own unlabeled one-bar section: the
 * shape whose bar count is fixed at one and which clearing the pickup
 * removes. An embedded pickup's section is the form and stays editable.
 */
export function hasPickupSection(): boolean {
	return isPickupOnlySection({ timeSignature: tuneEntry.timeSignature, sections: tuneEntry.sections }, 0);
}

/**
 * Set or clear the tune's opening pickup. A NEW pickup gets its own
 * unlabeled one-bar section in front of the form (so the user's sections
 * keep their bar counts) with the silent lead-in stored as a rest, which is
 * what makes step entry land the first typed note on the pickup's beat.
 * An EXISTING pickup is resized where it lives — its own section or the
 * first bar of a labelled one — never by inserting a second pickup section
 * in front of a section that already carries one: only the lead-in is
 * replaced, and anything that would now start inside the silent prefix is
 * dropped (mirroring setSectionBars' truncation). Clearing removes a
 * pickup-only section; an embedded pickup just loses the field, its notes
 * staying where they are (they are the form's).
 */
export function setTunePickup(length: Fraction | null): void {
	commitBuffer();
	const ts = tuneEntry.timeSignature;
	const sheet = { timeSignature: ts, sections: tuneEntry.sections };
	const current = resolvePickupLength(sheet, 0);
	if (length === null) {
		if (current === null) return;
		if (isPickupOnlySection(sheet, 0)) {
			tuneEntry.sections.splice(0, 1);
			tuneEntry.currentSection = Math.max(0, tuneEntry.currentSection - 1);
			tuneEntry.currentPage = 0;
		} else {
			delete tuneEntry.sections[0].pickupLength;
		}
		loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
		return;
	}
	const prefix = pickupPrefix(length, ts);
	const prefixF = fractionToFloat(prefix);
	if (current !== null) {
		const sec = tuneEntry.sections[0];
		const oldPrefixF = fractionToFloat(pickupPrefix(current, ts));
		const kept = sec.notes.filter((n) => {
			const start = fractionToFloat(n.offset);
			const end = start + fractionToFloat(n.duration);
			// The old lead-in rest goes; so does anything starting in the new prefix.
			if (n.pitch === null && end <= oldPrefixF + 1e-9) return false;
			return start >= prefixF - 1e-9;
		});
		sec.pickupLength = length;
		const leadIn: Note = { pitch: null, duration: prefix, offset: [0, 1] };
		sec.notes = [leadIn, ...kept].sort((a, b) => compareFractions(a.offset, b.offset));
		sec.harmony = sec.harmony.filter((h) => fractionToFloat(h.startOffset) >= prefixF - 1e-9);
		recomputeHarmonyDurations(sec);
	} else {
		const leadIn: Note = { pitch: null, duration: prefix, offset: [0, 1] };
		tuneEntry.sections.unshift({ label: '', bars: 1, pickupLength: length, notes: [leadIn], harmony: [] });
		tuneEntry.currentSection += 1;
	}
	loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
}

/** Update label/repeat/ending markers on a section. */
export function updateSectionMeta(
	index: number,
	meta: Partial<Pick<TuneSection, 'label' | 'repeatStart' | 'repeatEnd' | 'ending'>>
): void {
	const sec = tuneEntry.sections[index];
	if (!sec) return;
	if (meta.label !== undefined) sec.label = meta.label;
	if ('repeatStart' in meta) sec.repeatStart = meta.repeatStart;
	if ('repeatEnd' in meta) sec.repeatEnd = meta.repeatEnd;
	if ('ending' in meta) sec.ending = meta.ending;
}

/**
 * Resize a section. Content past the new end is dropped (mirroring
 * step-entry's destructive setBarCount) and the current page is clamped.
 */
export function setSectionBars(index: number, bars: number): void {
	const sec = tuneEntry.sections[index];
	if (!sec) return;
	const clamped = Math.max(1, Math.min(MAX_SECTION_BARS, Math.round(bars)));
	if (index === tuneEntry.currentSection) commitBuffer();
	sec.bars = clamped;
	// Offsets are whole-note fractions scaled by the meter (see chordOffset /
	// recomputeHarmonyDurations) — the truncation bound must be too.
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const sectionEndF = (clamped * tsNum) / tsDen;
	sec.notes = sec.notes.filter((n) => fractionToFloat(n.offset) < sectionEndF - 1e-9);
	sec.harmony = sec.harmony.filter((h) => fractionToFloat(h.startOffset) < sectionEndF - 1e-9);
	recomputeHarmonyDurations(sec);
	if (index === tuneEntry.currentSection) {
		const maxPage = Math.max(0, Math.ceil(clamped / PAGE_BARS) - 1);
		tuneEntry.currentPage = Math.min(tuneEntry.currentPage, maxPage);
		loadBuffer(index, tuneEntry.currentPage);
	}
}

// ─── Chords ─────────────────────────────────────────────────────────────

/**
 * Chords are stored as change points; durations are always re-derived so
 * each segment runs to the next chord (or the section end).
 */
function recomputeHarmonyDurations(sec: TuneSection): void {
	const sorted = [...sec.harmony].sort((a, b) => compareFractions(a.startOffset, b.startOffset));
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	const sectionEnd: Fraction = [sec.bars * tsNum, tsDen];
	for (let i = 0; i < sorted.length; i++) {
		const next = i + 1 < sorted.length ? sorted[i + 1].startOffset : sectionEnd;
		sorted[i].duration = subtractFractions(next, sorted[i].startOffset);
	}
	sec.harmony = sorted;
}

function chordOffset(bar: number, beat: number): Fraction {
	const [tsNum, tsDen] = tuneEntry.timeSignature;
	return addFractions([bar * tsNum, tsDen], [beat, tsDen]);
}

/**
 * Set (or replace) the chord at a bar/beat position in a section. The text
 * is a WRITTEN-pitch symbol as the user reads it; storage is concert with a
 * concert-canonical raw symbol. Returns false for unparseable text.
 */
export function setChord(sectionIdx: number, bar: number, beat: number, symbolText: string): boolean {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return false;
	const parsed = parseChordSymbol(symbolText);
	if (!parsed) return false;

	const semitones = entryTranspositionSemitones();
	const concert: ChordSymbol = {
		...parsed,
		root: transposePitchClass(parsed.root, -semitones),
		bass: parsed.bass ? transposePitchClass(parsed.bass, -semitones) : undefined
	};
	const startOffset = chordOffset(bar, beat);
	// Duration is a placeholder — recomputed below so each chord runs to the
	// next change or the section end.
	const segment = harmonicSegmentFromChordSymbol(concert, startOffset, [1, 1]);

	sec.harmony = sec.harmony.filter((h) => compareFractions(h.startOffset, startOffset) !== 0);
	sec.harmony.push(segment);
	recomputeHarmonyDurations(sec);
	return true;
}

/** Remove the chord at a bar/beat position. */
export function removeChord(sectionIdx: number, bar: number, beat: number): void {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	const offset = chordOffset(bar, beat);
	sec.harmony = sec.harmony.filter((h) => compareFractions(h.startOffset, offset) !== 0);
	recomputeHarmonyDurations(sec);
}

/** The WRITTEN-pitch chord text at a position, or null when none is set. */
export function chordTextAt(sectionIdx: number, bar: number, beat: number): string | null {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return null;
	const offset = chordOffset(bar, beat);
	const seg = sec.harmony.find((h) => compareFractions(h.startOffset, offset) === 0);
	if (!seg) return null;

	const semitones = entryTranspositionSemitones();
	const parsed = seg.symbol ? parseChordSymbol(seg.symbol) : null;
	if (parsed) {
		return formatChordSymbol({
			...parsed,
			root: transposePitchClass(parsed.root, semitones),
			bass: parsed.bass ? transposePitchClass(parsed.bass, semitones) : undefined
		});
	}
	const writtenRoot = transposePitchClass(seg.chord.root, semitones);
	return `${writtenRoot}${CHORD_DEFINITIONS[seg.chord.quality].symbol}`;
}

// ─── Key changes ────────────────────────────────────────────────────────

/**
 * Change the sheet's written key. With `moveNotes`, all sections' melody and
 * harmony are re-transposed through the same routine playback uses; without
 * it, the key is relabeled only (fixing a mislabeled chart).
 */
export function setSheetWrittenKey(newKey: PitchClass, moveNotes: boolean): void {
	const oldKey = tuneEntry.writtenKey;
	if (newKey === oldKey) return;
	const instrument = getInstrument();
	const semitones = entryTranspositionSemitones();

	if (moveNotes) {
		commitBuffer();
		const oldConcert = transposePitchClass(oldKey, -semitones);
		const newConcert = transposePitchClass(newKey, -semitones);
		const carrier: Tune = {
			id: '',
			title: tuneEntry.title,
			key: oldConcert,
			timeSignature: [tuneEntry.timeSignature[0], tuneEntry.timeSignature[1]],
			tags: [],
			sections: tuneEntry.sections,
			source: 'user'
		};
		const transposed = transposeTune(
			carrier,
			newConcert,
			instrument.concertRangeLow,
			getEffectiveHighestNote()
		);
		tuneEntry.sections = transposed.sections.map(cloneSection);
	}

	tuneEntry.writtenKey = newKey;
	stepEntry.phraseKey = newKey;
	if (moveNotes) {
		loadBuffer(tuneEntry.currentSection, tuneEntry.currentPage);
	}
}

/**
 * Change what pitch the source chart is written in. The stored (concert)
 * content is untouched — only the entry surface's written representation
 * moves: key label, chord text, typed-pitch interpretation, preview.
 */
export function setSourceTransposition(source: SourceTransposition): void {
	if (source === tuneEntry.sourceTransposition) return;
	const concertKey = transposePitchClass(tuneEntry.writtenKey, -entryTranspositionSemitones());
	tuneEntry.sourceTransposition = source;
	const semitones = entryTranspositionSemitones();
	tuneEntry.writtenKey = transposePitchClass(concertKey, semitones);
	stepEntry.phraseKey = tuneEntry.writtenKey;
	stepEntry.transpositionOverride = semitones;
}
