import type { Fraction, HarmonicSegment, Note, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { LeadSheet } from '$lib/types/lead-sheet';
import { fractionToFloat, gcd } from './intervals';
import { concertKeyToWritten, concertToWritten, transposePitchClass } from './transposition';
import { parseChordSymbol, formatChordSymbol, type ChordSymbol } from './chord-symbol';
import { CHORD_DEFINITIONS } from './chords';
import {
	FLAT_KEYS,
	KEY_SIG_ACCIDENTALS,
	approxToFraction,
	chordSpellingPreference,
	displayPitchClass,
	durationToAbc,
	getBeamGroupDuration,
	getTripletBase,
	governingSegment,
	initBarState,
	mergeConsecutiveRests,
	midiToAbcPitch,
	sameDuration,
	shorterFraction,
	type KeySigMap,
	type PitchedNoteAnchor
} from './notation';

/**
 * ABC generation for lead sheets — full song forms with chord symbols,
 * section labels, repeats/endings, and multi-system reflow.
 *
 * Reuses notation.ts's low-level primitives (bar-persistent accidental state,
 * duration mapping, rest merging, beam grouping) but owns its orchestration:
 * unlike a lick, a lead sheet is bar-structured (every bar renders, melody or
 * not), sections decorate barlines, and the body spans multiple lines. The
 * melody-only `phraseToAbc` path is untouched.
 */

export interface LeadSheetAbcOptions {
	/** ABC L: default note length. */
	defaultLength?: Fraction;
	/** Bars per system before a line break. */
	barsPerLine?: number;
}

interface DisplayElement {
	note: Note;
	/** Index into the flattened (notation-order) note array, or null for rests. */
	sourceIndex: number | null;
	/** Chord-symbol texts attached to (sounding at) this element. */
	chords: string[];
	/** The harmony segment governing this element's offset, for spelling. */
	governing: HarmonicSegment | null;
}

/** Build the display text for one harmony segment's chord symbol. */
function chordDisplayText(
	seg: HarmonicSegment,
	instrument: InstrumentConfig | undefined,
	keyContext: PitchClass
): string {
	const semitones = instrument?.transpositionSemitones ?? 0;

	if (seg.symbol) {
		// Parseable raw symbols are re-formatted canonically (compact jazz
		// spellings: Δ, -7) so display is uniform regardless of the source's
		// spelling, with the color tokens surviving the round trip. Only an
		// UNPARSEABLE symbol shows verbatim — and only untransposed, since
		// its root can't be shifted.
		const parsed = parseChordSymbol(seg.symbol);
		if (parsed) {
			const shifted: ChordSymbol = {
				...parsed,
				root: transposePitchClass(parsed.root, semitones),
				bass: parsed.bass ? transposePitchClass(parsed.bass, semitones) : undefined
			};
			return respellFormat(shifted, keyContext);
		}
		if (semitones === 0) return seg.symbol;
		// Unparseable + transposing — fall through to the structured chord.
	}

	const root = instrument ? concertKeyToWritten(seg.chord.root, instrument) : seg.chord.root;
	const bass = seg.chord.bass
		? instrument ? concertKeyToWritten(seg.chord.bass, instrument) : seg.chord.bass
		: undefined;
	const bassStr = bass ? `/${displayPitchClass(bass, keyContext)}` : '';
	return `${displayPitchClass(root, keyContext)}${CHORD_DEFINITIONS[seg.chord.quality].symbol}${bassStr}`;
}

/** Format a ChordSymbol with roots respelled for the key context (F#→Gb in flat keys). */
function respellFormat(cs: ChordSymbol, keyContext: PitchClass): string {
	const rootStr = displayPitchClass(cs.root, keyContext);
	// Format against a placeholder root, then strip it — keeps one formatter.
	const body = formatChordSymbol({ ...cs, root: 'C', bass: undefined }).slice(1);
	const bassStr = cs.bass ? `/${displayPitchClass(cs.bass, keyContext)}` : '';
	return `${rootStr}${body}${bassStr}`;
}

/**
 * Generate ABC for a lead sheet, with anchors mapping each pitched-note token
 * (including its quoted chord prefix) back to its index in the flattened
 * note array (`flattenLeadSheet(sheet).notes` order).
 */
export function leadSheetToAbcWithMap(
	sheet: LeadSheet,
	instrument?: InstrumentConfig,
	options: LeadSheetAbcOptions = {}
): { abc: string; noteAnchors: PitchedNoteAnchor[] } {
	const defaultLength = options.defaultLength ?? [1, 8];
	const barsPerLine = options.barsPerLine ?? 4;

	const displayKey = instrument ? concertKeyToWritten(sheet.key, instrument) : sheet.key;
	const useFlats = FLAT_KEYS.includes(displayKey);
	const keySigAccidentals: KeySigMap = KEY_SIG_ACCIDENTALS[displayKey] ?? {};

	const barDuration = sheet.timeSignature[0] / sheet.timeSignature[1];

	const headerLines: string[] = [
		`X:1`,
		`T:${sheet.title}`,
		...(sheet.composer ? [`C:${sheet.composer}`] : []),
		`M:${sheet.timeSignature[0]}/${sheet.timeSignature[1]}`,
		`L:${defaultLength[0]}/${defaultLength[1]}`,
		// Box the P: section labels so they read as form markers, not chords.
		`%%partsbox 1`,
		`K:${displayKey}`
	];

	const tokens: string[] = [];
	const pendingAnchors: Array<{ tokenIndex: number; sourceIndex: number }> = [];

	function renderElement(el: DisplayElement, duration: Fraction, barState: ReturnType<typeof initBarState>): string {
		const prefix = el.chords.map((c) => `"${c}"`).join('');
		const note = el.note;
		if (note.pitch === null) {
			return `${prefix}z${durationToAbc(duration, defaultLength)}`;
		}
		const midi = instrument ? concertToWritten(note.pitch, instrument) : note.pitch;
		// Spelling priority: the user's explicit choice, then diatonic-to-the-
		// governing-chord (judged at WRITTEN pitch), then the key signature.
		const chordPref = el.governing
			? chordSpellingPreference(
					midi,
					displayPitchClass(
						instrument
							? concertKeyToWritten(el.governing.chord.root, instrument)
							: el.governing.chord.root,
						displayKey
					),
					el.governing.chord.quality
				)
			: null;
		const noteUseFlats = note.spelling === 'flat' ? true
			: note.spelling === 'sharp' ? false
			: chordPref === 'flat' ? true
			: chordPref === 'sharp' ? false
			: useFlats;
		const pitch = midiToAbcPitch(midi, noteUseFlats, keySigAccidentals, barState);
		const tieSuffix = note.tied ? '-' : '';
		return `${prefix}${pitch}${durationToAbc(duration, defaultLength)}${tieSuffix}`;
	}

	function emitElement(el: DisplayElement, duration: Fraction, barState: ReturnType<typeof initBarState>): void {
		if (el.note.pitch !== null && el.sourceIndex !== null) {
			pendingAnchors.push({ tokenIndex: tokens.length, sourceIndex: el.sourceIndex });
		}
		tokens.push(renderElement(el, duration, barState));
	}

	let flattenedNoteBase = 0;
	let previousLabel: string | null = null;
	// Line-position tracking for chart-style ending layout: [1 flows inline
	// after the body, and [2 opens a fresh line padded with invisible bars so
	// its bracket sits directly below [1.
	let lineColumn = 0; // bars into the current line where this section starts
	let prevEndColumn = 0; // column after the previous section's last bar
	let endingOneColumn = 0; // column where the current [1 bracket started

	for (let secIdx = 0; secIdx < sheet.sections.length; secIdx++) {
		const sec = sheet.sections[secIdx];
		const sectionEnd = sec.bars * barDuration;

		// ── Line placement (the previous section closed with its barline) ──
		if (secIdx > 0) {
			const prev = sheet.sections[secIdx - 1];
			if (sec.ending === 2) {
				tokens.push('\n');
				if (endingOneColumn > 0) {
					const num = sheet.timeSignature[0] * endingOneColumn;
					const den = sheet.timeSignature[1];
					const g = gcd(num, den);
					tokens.push(`x${durationToAbc([num / g, den / g], defaultLength)} `);
				}
				lineColumn = endingOneColumn;
			} else if (sec.ending === 1 && prevEndColumn > 0 && prevEndColumn < barsPerLine) {
				tokens.push(' ');
				lineColumn = prevEndColumn;
			} else {
				tokens.push('\n');
				lineColumn = 0;
			}
			if (sec.ending === 1 && prev.ending !== 1) endingOneColumn = lineColumn;
		} else {
			lineColumn = 0;
		}

		// ── Gap-fill: every bar renders, melody or not ──────────────────
		// Gaps are additionally split at chord-change offsets so each chord
		// lands on its own rest at its own beat (two chords in a bar sit side
		// by side over half-bar rests, never stacked on one whole-bar rest).
		const chordBoundaries = [...new Set(sec.harmony.map((h) => fractionToFloat(h.startOffset)))]
			.sort((a, b) => a - b);

		const inputNotes: Note[] = [];
		const inputSources: (number | null)[] = [];

		const pushGapRests = (fromF: number, toF: number): void => {
			const cuts = chordBoundaries.filter((b) => b > fromF + 1e-9 && b < toF - 1e-9);
			let start = fromF;
			for (const cut of [...cuts, toF]) {
				inputNotes.push({
					pitch: null,
					duration: approxToFraction(cut - start),
					offset: approxToFraction(start)
				});
				inputSources.push(null);
				start = cut;
			}
		};

		let cursor = 0;
		for (let i = 0; i < sec.notes.length; i++) {
			const n = sec.notes[i];
			const off = fractionToFloat(n.offset);
			if (off > cursor + 1e-9) pushGapRests(cursor, off);
			inputNotes.push(n);
			inputSources.push(flattenedNoteBase + i);
			cursor = Math.max(cursor, off + fractionToFloat(n.duration));
		}
		if (sectionEnd > cursor + 1e-9) pushGapRests(cursor, sectionEnd);
		flattenedNoteBase += sec.notes.length;

		// Merge rests PER CHORD SPAN: mergeConsecutiveRests fuses any
		// contiguous rest run back into whole-bar groupings, so it must never
		// see across a chord boundary — process each inter-boundary run
		// independently and concatenate.
		const display: Note[] = [];
		const sourceMap: (number | null)[] = [];
		let runStart = 0;
		for (let k = 1; k <= inputNotes.length; k++) {
			const isBoundary =
				k === inputNotes.length ||
				chordBoundaries.some(
					(b) => Math.abs(fractionToFloat(inputNotes[k].offset) - b) < 1e-9
				);
			if (!isBoundary) continue;
			const run = mergeConsecutiveRests(inputNotes.slice(runStart, k), sheet.timeSignature);
			for (let m = 0; m < run.display.length; m++) {
				display.push(run.display[m]);
				const src = run.sourceMap[m];
				sourceMap.push(src === null ? null : src + runStart);
			}
			runStart = k;
		}

		const elements: DisplayElement[] = display.map((note, k) => ({
			note,
			sourceIndex: sourceMap[k] === null ? null : inputSources[sourceMap[k]!],
			chords: [],
			governing: governingSegment(sec.harmony, fractionToFloat(note.offset))
		}));

		// ── Chord assignment: each chord attaches to the element sounding at its offset ──
		const sortedHarmony = [...sec.harmony].sort(
			(a, b) => fractionToFloat(a.startOffset) - fractionToFloat(b.startOffset)
		);
		for (const h of sortedHarmony) {
			const off = fractionToFloat(h.startOffset);
			let idx = 0;
			for (let k = 0; k < elements.length; k++) {
				if (fractionToFloat(elements[k].note.offset) <= off + 1e-9) idx = k;
				else break;
			}
			if (elements.length > 0) {
				elements[idx].chords.push(chordDisplayText(h, instrument, displayKey));
			}
		}

		// ── Section prelude: part label + opening decorations ───────────
		// Blank labels (e.g. a pickup bar) get no part marker and don't
		// disturb the consecutive-duplicate suppression.
		if (sec.label.trim() !== '') {
			if (sec.label !== previousLabel) {
				tokens.push(`P:${sec.label}\n`);
			}
			previousLabel = sec.label;
		}
		if (sec.repeatStart) tokens.push('|:');
		if (sec.ending) tokens.push(`[${sec.ending}`);

		// ── Bar-structured emission (mirrors the phrase loop's beam/triplet rules) ──
		let barState = initBarState(keySigAccidentals);
		let prevBar = 0;
		let prevPosInBar = 0;
		let prevDuration: Fraction = [1, 8];

		for (let i = 0; i < elements.length; /* increment varies */) {
			const el = elements[i];
			const offset = fractionToFloat(el.note.offset);
			const bar = Math.floor(offset / barDuration + 1e-9);
			const posInBar = offset - bar * barDuration;

			if (i > 0) {
				if (bar > prevBar) {
					tokens.push(' |');
					tokens.push(bar % barsPerLine === 0 ? '\n' : ' ');
					barState = initBarState(keySigAccidentals);
				} else {
					const minDur = shorterFraction(el.note.duration, prevDuration);
					const groupDur = getBeamGroupDuration(sheet.timeSignature, minDur);
					const group = Math.floor(posInBar / groupDur + 1e-9);
					const prevGroup = Math.floor(prevPosInBar / groupDur + 1e-9);
					if (group !== prevGroup) tokens.push(' ');
				}
			}

			// Complete triplet group: 3 consecutive same-duration pitched triplet
			// notes with contiguous offsets.
			const tripBase = getTripletBase(el.note.duration);
			if (tripBase !== null && i + 2 < elements.length &&
				sameDuration(elements[i + 1].note.duration, el.note.duration) &&
				sameDuration(elements[i + 2].note.duration, el.note.duration) &&
				elements[i].note.pitch !== null &&
				elements[i + 1].note.pitch !== null &&
				elements[i + 2].note.pitch !== null) {

				const tripDur = fractionToFloat(el.note.duration);
				const off0 = fractionToFloat(elements[i].note.offset);
				const off1 = fractionToFloat(elements[i + 1].note.offset);
				const off2 = fractionToFloat(elements[i + 2].note.offset);

				if (Math.abs(off1 - off0 - tripDur) < 1e-9 && Math.abs(off2 - off1 - tripDur) < 1e-9) {
					tokens.push('(3');
					for (let j = 0; j < 3; j++) emitElement(elements[i + j], tripBase, barState);
					prevBar = Math.floor(off2 / barDuration + 1e-9);
					prevPosInBar = off2 - prevBar * barDuration;
					prevDuration = elements[i + 2].note.duration;
					i += 3;
					continue;
				}
			}

			emitElement(el, el.note.duration, barState);
			prevBar = bar;
			prevPosInBar = posInBar;
			prevDuration = el.note.duration;
			i += 1;
		}

		// ── Section close: barline decoration + line break ──────────────
		const isLast = secIdx === sheet.sections.length - 1;
		const next = isLast ? null : sheet.sections[secIdx + 1];
		if (sec.repeatEnd) tokens.push(' :|');
		else if (isLast) tokens.push(' |]');
		else if (next?.ending) tokens.push(' |');
		else tokens.push(' ||');

		prevEndColumn =
			lineColumn === 0
				? sec.bars % barsPerLine === 0
					? barsPerLine
					: sec.bars % barsPerLine
				: lineColumn + sec.bars;
	}

	// ── Anchor char-offset resolution across all tokens (incl. newlines) ──
	const headerStr = headerLines.join('\n');
	const bodyStart = headerStr.length + 1;
	const tokenStarts: number[] = new Array(tokens.length);
	let charCursor = 0;
	for (let t = 0; t < tokens.length; t++) {
		tokenStarts[t] = charCursor;
		charCursor += tokens[t].length;
	}
	const noteAnchors: PitchedNoteAnchor[] = pendingAnchors.map(({ tokenIndex, sourceIndex }) => ({
		startChar: bodyStart + tokenStarts[tokenIndex],
		endChar: bodyStart + tokenStarts[tokenIndex] + tokens[tokenIndex].length,
		sourceIndex
	}));

	return { abc: headerStr + '\n' + tokens.join(''), noteAnchors };
}

/** Generate an ABC string from a lead sheet, discarding the click-anchor map. */
export function leadSheetToAbc(
	sheet: LeadSheet,
	instrument?: InstrumentConfig,
	options: LeadSheetAbcOptions = {}
): string {
	return leadSheetToAbcWithMap(sheet, instrument, options).abc;
}
