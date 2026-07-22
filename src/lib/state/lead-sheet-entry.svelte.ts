/**
 * Lead-sheet entry state — long-form manual entry built on top of the
 * step-entry melody buffer.
 *
 * The model: a lead sheet is a list of sections; melody editing happens
 * through the EXISTING `stepEntry` rune one PAGE at a time (a ≤4-bar window,
 * matching step-entry's capacity model), so `PitchEntryPanel`,
 * `DurationSelector`, and all keyboard entry work unmodified. The section
 * list is authoritative; the buffer holds the current page in page-local
 * offsets and is committed back on page/section navigation and save.
 *
 * Pitch conventions match step-entry exactly: sections store CONCERT pitch;
 * the user sees/types WRITTEN. `writtenKey` converts to concert once at
 * `buildDraftLeadSheet`; chords are typed as written symbols and stored with
 * concert roots + a concert-canonical raw symbol. Manual entry is 4/4 (the
 * step-entry buffer's assumption); imported sheets in other meters are
 * edited through the import review flow's own tooling.
 */

import type { Fraction, HarmonicSegment, Note, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { LeadSheet, LeadSheetSection } from '$lib/types/lead-sheet';
import {
	addFractions,
	compareFractions,
	fractionToFloat,
	subtractFractions
} from '$lib/music/intervals';
import { concertKeyToWritten, transposePitchClass, writtenKeyToConcert } from '$lib/music/transposition';
import { parseChordSymbol, formatChordSymbol, type ChordSymbol } from '$lib/music/chord-symbol';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { harmonicSegmentFromChordSymbol } from '$lib/leadsheets/segment-from-symbol';
import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
import { stepEntry, reset as resetStepEntry } from '$lib/state/step-entry.svelte';
import { transposeLeadSheet } from '$lib/leadsheets/library-loader';

/** Bars per editing page — matches step-entry's maximum bar capacity. */
export const PAGE_BARS = 4;

const MAX_SECTION_BARS = 64;

export const leadSheetEntry = $state({
	title: '',
	composer: '',
	style: '',
	/** WRITTEN key shown in the key selector. */
	writtenKey: 'C' as PitchClass,
	/**
	 * Sheet meter. Manual entry is 4/4 (the step-entry buffer's assumption);
	 * imported charts in other meters keep theirs, with melody editing gated
	 * off (`melodyEditingSupported`) so the 4/4 buffer can't corrupt them.
	 */
	timeSignature: [4, 4] as [number, number],
	tags: [] as string[],
	/** Authoritative section list (CONCERT pitch), except the current page. */
	sections: [] as LeadSheetSection[],
	currentSection: 0,
	currentPage: 0,
	editingId: null as string | null,
	editingSource: null as string | null,
	editingPdfUrl: null as string | null
});

function makeSection(label: string, bars = 8): LeadSheetSection {
	return { label, bars, notes: [], harmony: [] };
}

function cloneSection(sec: LeadSheetSection): LeadSheetSection {
	return {
		...sec,
		notes: sec.notes.map((n) => ({ ...n })),
		harmony: sec.harmony.map((h) => ({ ...h, chord: { ...h.chord } }))
	};
}

/** Bars covered by a given page of a section (the last page may be short). */
function pageWindowBars(sec: LeadSheetSection, page: number): number {
	return Math.max(1, Math.min(PAGE_BARS, sec.bars - page * PAGE_BARS));
}

export function currentSectionPageCount(): number {
	const sec = leadSheetEntry.sections[leadSheetEntry.currentSection];
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
	return [...outside, ...shifted].sort((a, b) => compareFractions(a.offset, b.offset));
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
	return leadSheetEntry.timeSignature[0] === 4 && leadSheetEntry.timeSignature[1] === 4;
}

/** Write the step-entry buffer back into the current section. */
export function commitBuffer(): void {
	if (!melodyEditingSupported()) return;
	const sec = leadSheetEntry.sections[leadSheetEntry.currentSection];
	if (!sec) return;
	sec.notes = mergeWindow(
		sec.notes,
		stepEntry.enteredNotes,
		pageStartFraction(leadSheetEntry.currentPage),
		pageWindowBars(sec, leadSheetEntry.currentPage)
	);
}

/** Load a section page into the step-entry buffer (no commit). */
function loadBuffer(sectionIdx: number, pageIdx: number): void {
	const sec = leadSheetEntry.sections[sectionIdx];
	if (!sec) return;
	if (!melodyEditingSupported()) {
		stepEntry.enteredNotes = [];
		stepEntry.selectedNoteIndex = null;
		stepEntry.phraseKey = leadSheetEntry.writtenKey;
		return;
	}
	const windowBars = pageWindowBars(sec, pageIdx);
	stepEntry.enteredNotes = extractWindow(sec.notes, pageStartFraction(pageIdx), windowBars);
	stepEntry.barCount = windowBars;
	stepEntry.selectedNoteIndex = null;
	stepEntry.phraseKey = leadSheetEntry.writtenKey;
}

/** Navigate to a section page, committing the current buffer first. */
export function loadPage(sectionIdx: number, pageIdx: number): void {
	commitBuffer();
	const sec = leadSheetEntry.sections[sectionIdx];
	if (!sec) return;
	const maxPage = Math.max(0, Math.ceil(sec.bars / PAGE_BARS) - 1);
	leadSheetEntry.currentSection = sectionIdx;
	leadSheetEntry.currentPage = Math.max(0, Math.min(pageIdx, maxPage));
	loadBuffer(leadSheetEntry.currentSection, leadSheetEntry.currentPage);
}

/** Reset to a fresh single-section sheet. */
export function initNewLeadSheet(): void {
	resetStepEntry();
	leadSheetEntry.title = '';
	leadSheetEntry.composer = '';
	leadSheetEntry.style = '';
	leadSheetEntry.writtenKey = 'C';
	leadSheetEntry.timeSignature = [4, 4];
	leadSheetEntry.tags = [];
	leadSheetEntry.sections = [makeSection('A')];
	leadSheetEntry.currentSection = 0;
	leadSheetEntry.currentPage = 0;
	leadSheetEntry.editingId = null;
	leadSheetEntry.editingSource = null;
	leadSheetEntry.editingPdfUrl = null;
	loadBuffer(0, 0);
}

export const resetLeadSheetEntry = initNewLeadSheet;

/** Hydrate the editor from an existing sheet (edit mode). */
export function loadFromLeadSheet(sheet: LeadSheet, instrument: InstrumentConfig): void {
	resetStepEntry();
	leadSheetEntry.title = sheet.title;
	leadSheetEntry.composer = sheet.composer ?? '';
	leadSheetEntry.style = sheet.style ?? '';
	leadSheetEntry.writtenKey = concertKeyToWritten(sheet.key, instrument);
	leadSheetEntry.timeSignature = [sheet.timeSignature[0], sheet.timeSignature[1]];
	leadSheetEntry.tags = [...sheet.tags];
	leadSheetEntry.sections = sheet.sections.map(cloneSection);
	leadSheetEntry.currentSection = 0;
	leadSheetEntry.currentPage = 0;
	leadSheetEntry.editingId = sheet.id;
	leadSheetEntry.editingSource = sheet.source;
	leadSheetEntry.editingPdfUrl = sheet.pdfUrl ?? null;
	loadBuffer(0, 0);
}

/**
 * Load an UNSAVED import draft for review: hydrates the editor but keeps it
 * in create mode (no editingId), so Save assigns a fresh id. Drafts that
 * already carry a pre-assigned id (the PDF flow, which stores the original
 * file under that id) should use `loadFromLeadSheet` instead.
 */
export function loadDraftForReview(sheet: LeadSheet, instrument: InstrumentConfig): void {
	loadFromLeadSheet(sheet, instrument);
	leadSheetEntry.editingId = null;
	leadSheetEntry.editingSource = sheet.source;
}

/**
 * Build the current draft as a LeadSheet, virtually merging the live buffer
 * (no state mutation) and converting the written key to concert once.
 */
export function buildDraftLeadSheet(): LeadSheet {
	const instrument = getInstrument();
	const concertKey = writtenKeyToConcert(leadSheetEntry.writtenKey, instrument);
	const sections = leadSheetEntry.sections.map((sec, i) => {
		const clone = cloneSection(sec);
		if (i === leadSheetEntry.currentSection) {
			clone.notes = mergeWindow(
				sec.notes,
				stepEntry.enteredNotes,
				pageStartFraction(leadSheetEntry.currentPage),
				pageWindowBars(sec, leadSheetEntry.currentPage)
			);
		}
		return clone;
	});
	const draft: LeadSheet = {
		id: leadSheetEntry.editingId ?? '',
		title: leadSheetEntry.title.trim() || 'Untitled',
		key: concertKey,
		timeSignature: [leadSheetEntry.timeSignature[0], leadSheetEntry.timeSignature[1]],
		tags: [...leadSheetEntry.tags],
		sections,
		source: leadSheetEntry.editingSource ?? 'user'
	};
	if (leadSheetEntry.composer.trim()) draft.composer = leadSheetEntry.composer.trim();
	if (leadSheetEntry.style.trim()) draft.style = leadSheetEntry.style.trim();
	if (leadSheetEntry.editingPdfUrl) draft.pdfUrl = leadSheetEntry.editingPdfUrl;
	return draft;
}

/**
 * Flattened-note index of the buffer's first note — maps step-entry's
 * selection onto the full-sheet notation preview's anchor indices.
 */
export function flattenedBufferBase(): number {
	let base = 0;
	for (let i = 0; i < leadSheetEntry.currentSection; i++) {
		base += leadSheetEntry.sections[i]?.notes.length ?? 0;
	}
	const sec = leadSheetEntry.sections[leadSheetEntry.currentSection];
	if (sec) {
		const startF = leadSheetEntry.currentPage * PAGE_BARS;
		base += sec.notes.filter((n) => fractionToFloat(n.offset) < startF - 1e-9).length;
	}
	return base;
}

/**
 * Park the editor when navigating away: commit the page into the section
 * list and empty the SHARED step-entry buffer so the lick entry page never
 * sees lead-sheet content. `resumeEntryBuffer` reloads the same page on
 * return without re-committing (the buffer is empty at that point).
 */
export function suspendEntryBuffer(): void {
	commitBuffer();
	stepEntry.enteredNotes = [];
	stepEntry.selectedNoteIndex = null;
}

/** Reload the current page into the buffer after a suspend. */
export function resumeEntryBuffer(): void {
	loadBuffer(leadSheetEntry.currentSection, leadSheetEntry.currentPage);
}

// ─── Sections ───────────────────────────────────────────────────────────

const SECTION_LABELS = 'ABCDEFGH';

/** Append a new section (auto-labeled) and navigate to it. */
export function addSection(): void {
	commitBuffer();
	const label = SECTION_LABELS[leadSheetEntry.sections.length % SECTION_LABELS.length];
	leadSheetEntry.sections.push(makeSection(label));
	leadSheetEntry.currentSection = leadSheetEntry.sections.length - 1;
	leadSheetEntry.currentPage = 0;
	loadBuffer(leadSheetEntry.currentSection, 0);
}

/** Remove a section; the sheet always keeps at least one. */
export function removeSection(index: number): void {
	if (leadSheetEntry.sections.length <= 1) return;
	if (index < 0 || index >= leadSheetEntry.sections.length) return;
	if (index !== leadSheetEntry.currentSection) commitBuffer();
	leadSheetEntry.sections.splice(index, 1);
	if (leadSheetEntry.currentSection >= index) {
		leadSheetEntry.currentSection = Math.max(0, leadSheetEntry.currentSection - 1);
	}
	leadSheetEntry.currentPage = 0;
	loadBuffer(leadSheetEntry.currentSection, 0);
}

/** Update label/repeat/ending markers on a section. */
export function updateSectionMeta(
	index: number,
	meta: Partial<Pick<LeadSheetSection, 'label' | 'repeatStart' | 'repeatEnd' | 'ending'>>
): void {
	const sec = leadSheetEntry.sections[index];
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
	const sec = leadSheetEntry.sections[index];
	if (!sec) return;
	const clamped = Math.max(1, Math.min(MAX_SECTION_BARS, Math.round(bars)));
	if (index === leadSheetEntry.currentSection) commitBuffer();
	sec.bars = clamped;
	sec.notes = sec.notes.filter((n) => fractionToFloat(n.offset) < clamped - 1e-9);
	sec.harmony = sec.harmony.filter((h) => fractionToFloat(h.startOffset) < clamped - 1e-9);
	recomputeHarmonyDurations(sec);
	if (index === leadSheetEntry.currentSection) {
		const maxPage = Math.max(0, Math.ceil(clamped / PAGE_BARS) - 1);
		leadSheetEntry.currentPage = Math.min(leadSheetEntry.currentPage, maxPage);
		loadBuffer(index, leadSheetEntry.currentPage);
	}
}

// ─── Chords ─────────────────────────────────────────────────────────────

/**
 * Chords are stored as change points; durations are always re-derived so
 * each segment runs to the next chord (or the section end).
 */
function recomputeHarmonyDurations(sec: LeadSheetSection): void {
	const sorted = [...sec.harmony].sort((a, b) => compareFractions(a.startOffset, b.startOffset));
	const [tsNum, tsDen] = leadSheetEntry.timeSignature;
	const sectionEnd: Fraction = [sec.bars * tsNum, tsDen];
	for (let i = 0; i < sorted.length; i++) {
		const next = i + 1 < sorted.length ? sorted[i + 1].startOffset : sectionEnd;
		sorted[i].duration = subtractFractions(next, sorted[i].startOffset);
	}
	sec.harmony = sorted;
}

function chordOffset(bar: number, beat: number): Fraction {
	const [tsNum, tsDen] = leadSheetEntry.timeSignature;
	return addFractions([bar * tsNum, tsDen], [beat, tsDen]);
}

/**
 * Set (or replace) the chord at a bar/beat position in a section. The text
 * is a WRITTEN-pitch symbol as the user reads it; storage is concert with a
 * concert-canonical raw symbol. Returns false for unparseable text.
 */
export function setChord(sectionIdx: number, bar: number, beat: number, symbolText: string): boolean {
	const sec = leadSheetEntry.sections[sectionIdx];
	if (!sec) return false;
	const parsed = parseChordSymbol(symbolText);
	if (!parsed) return false;

	const semitones = getInstrument().transpositionSemitones;
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
	const sec = leadSheetEntry.sections[sectionIdx];
	if (!sec) return;
	const offset = chordOffset(bar, beat);
	sec.harmony = sec.harmony.filter((h) => compareFractions(h.startOffset, offset) !== 0);
	recomputeHarmonyDurations(sec);
}

/** The WRITTEN-pitch chord text at a position, or null when none is set. */
export function chordTextAt(sectionIdx: number, bar: number, beat: number): string | null {
	const sec = leadSheetEntry.sections[sectionIdx];
	if (!sec) return null;
	const offset = chordOffset(bar, beat);
	const seg = sec.harmony.find((h) => compareFractions(h.startOffset, offset) === 0);
	if (!seg) return null;

	const semitones = getInstrument().transpositionSemitones;
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
	const oldKey = leadSheetEntry.writtenKey;
	if (newKey === oldKey) return;
	const instrument = getInstrument();

	if (moveNotes) {
		commitBuffer();
		const oldConcert = writtenKeyToConcert(oldKey, instrument);
		const newConcert = writtenKeyToConcert(newKey, instrument);
		const carrier: LeadSheet = {
			id: '',
			title: leadSheetEntry.title,
			key: oldConcert,
			timeSignature: [leadSheetEntry.timeSignature[0], leadSheetEntry.timeSignature[1]],
			tags: [],
			sections: leadSheetEntry.sections,
			source: 'user'
		};
		const transposed = transposeLeadSheet(
			carrier,
			newConcert,
			instrument.concertRangeLow,
			getEffectiveHighestNote()
		);
		leadSheetEntry.sections = transposed.sections.map(cloneSection);
	}

	leadSheetEntry.writtenKey = newKey;
	stepEntry.phraseKey = newKey;
	if (moveNotes) {
		loadBuffer(leadSheetEntry.currentSection, leadSheetEntry.currentPage);
	}
}
