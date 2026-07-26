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
	subtractFractions
} from '$lib/music/intervals';
import { transposePitchClass } from '$lib/music/transposition';
import { parseChordSymbol, formatChordSymbol, type ChordSymbol } from '$lib/music/chord-symbol';
import { CHORD_DEFINITIONS } from '$lib/music/chords';
import { harmonicSegmentFromChordSymbol } from '$lib/tunes/segment-from-symbol';
import { getInstrument, getEffectiveHighestNote } from '$lib/state/settings.svelte';
import { stepEntry, reset as resetStepEntry } from '$lib/state/step-entry.svelte';
import { transposeTune } from '$lib/tunes/book-loader';
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
	importReview: null as { warnings: string[]; suspectBars: number[] } | null
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
}

/** Load a section page into the step-entry buffer (no commit). */
function loadBuffer(sectionIdx: number, pageIdx: number): void {
	const sec = tuneEntry.sections[sectionIdx];
	if (!sec) return;
	// The shared buffer interprets typed pitches at the SOURCE's transposition
	// while a lead sheet is being edited (cleared by suspendEntryBuffer).
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
	review: { warnings: string[]; suspectBars: number[] } | null
): void {
	tuneEntry.importReview = review && review.warnings.length > 0 ? review : null;
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
		if (i === tuneEntry.currentSection) {
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
 * sees lead-sheet content. `resumeEntryBuffer` reloads the same page on
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
	sec.notes = sec.notes.filter((n) => fractionToFloat(n.offset) < clamped - 1e-9);
	sec.harmony = sec.harmony.filter((h) => fractionToFloat(h.startOffset) < clamped - 1e-9);
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
