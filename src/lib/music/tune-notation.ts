import type { Fraction, HarmonicSegment, Note, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { Tune } from '$lib/types/tune';
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
	signatureSpelling,
	type KeySigMap,
	type PitchedNoteAnchor
} from './notation';

/**
 * ABC generation for tunes — full song forms with chord symbols,
 * section labels, repeats/endings, and multi-system reflow.
 *
 * Reuses notation.ts's low-level primitives (bar-persistent accidental state,
 * duration mapping, rest merging, beam grouping) but owns its orchestration:
 * unlike a lick, a tune is bar-structured (every bar renders, melody or
 * not), sections decorate barlines, and the body spans multiple lines. The
 * melody-only `phraseToAbc` path is untouched.
 */

export interface TuneAbcOptions {
	/** ABC L: default note length. */
	defaultLength?: Fraction;
	/** Bars per system before a line break. */
	barsPerLine?: number;
}

/**
 * Maps one rendered melody bar (voice M) back to its section/bar. The char
 * span covers the bar's melody tokens through its closing barline token; it
 * excludes leading `|:` / `[n` decorations and any inter-system chord flush.
 */
export interface BarAnchor {
	/** Character index where the bar's first melody token begins. */
	startChar: number;
	/** Character index just past the bar's closing barline token. */
	endChar: number;
	sectionIdx: number;
	/** 0-based bar within the section. */
	bar: number;
}

/**
 * Maps one chord-voice (voice H) segment token — including its quoted
 * `"chord"` prefix — back to its position. Segments are cut at chord events,
 * sound-span boundaries and bar edges, so a bar can hold several slots.
 */
export interface ChordSlotAnchor {
	/** Character index where the segment token (incl. quoted chord) begins. */
	startChar: number;
	/** Character index just past the segment token. */
	endChar: number;
	sectionIdx: number;
	/** 0-based bar within the section. */
	bar: number;
	/** Segment start within the bar, in beats (float — off-beats like 1.5). */
	beat: number;
	/** Display text when this segment starts a chord event, else null. */
	chord: string | null;
}

interface DisplayElement {
	note: Note;
	/** Index into the flattened (notation-order) note array, or null for rests. */
	sourceIndex: number | null;
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
 * Generate ABC for a tune, with anchors mapping each pitched-note token
 * (including its quoted chord prefix) back to its index in the flattened
 * note array (`flattenTune(sheet).notes` order).
 */
export function tuneToAbcWithMap(
	sheet: Tune,
	instrument?: InstrumentConfig,
	options: TuneAbcOptions = {}
): {
	abc: string;
	noteAnchors: PitchedNoteAnchor[];
	barAnchors: BarAnchor[];
	chordSlotAnchors: ChordSlotAnchor[];
} {
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
		// Two voices merged onto ONE staff: M carries the melody untouched;
		// H is an invisible rhythm voice that positions every chord symbol at
		// its exact beat (visible rests where the melody is silent), so a
		// mid-bar chord never forces a melody note to split or stack.
		`%%score (M H)`,
		`K:${displayKey}`,
		`V:M`,
		`V:H`
	];

	const tokens: string[] = [];
	const pendingAnchors: Array<{ tokenIndex: number; sourceIndex: number; offset: number; gliss?: boolean }> = [];
	const pendingBarAnchors: Array<{
		startTokenIndex: number;
		barlineTokenIndex: number;
		sectionIdx: number;
		bar: number;
	}> = [];
	const pendingChordSlots: Array<{
		tokenIndex: number;
		sectionIdx: number;
		bar: number;
		beat: number;
		chord: string | null;
	}> = [];

	// Melody-bar span tracking: one span is open at a time; it starts at the
	// bar's first melody token and closes at its barline token (see hooks in
	// the section loop). Padding/decoration tokens are never inside a span.
	let openBar: { startTokenIndex: number; sectionIdx: number; bar: number } | null = null;
	function openBarSpan(sectionIdx: number, bar: number): void {
		openBar = { startTokenIndex: tokens.length, sectionIdx, bar };
	}
	function closeBarSpan(barlineTokenIndex: number): void {
		if (!openBar) return;
		pendingBarAnchors.push({
			startTokenIndex: openBar.startTokenIndex,
			barlineTokenIndex,
			sectionIdx: openBar.sectionIdx,
			bar: openBar.bar
		});
		openBar = null;
	}

	function renderElement(el: DisplayElement, duration: Fraction, barState: ReturnType<typeof initBarState>): string {
		const note = el.note;
		if (note.pitch === null) {
			// Invisible in the melody voice — the READER's rest renders from
			// the chord voice at normal staff position (a second voice shifts
			// first-voice rests off-center).
			return `x${durationToAbc(duration, defaultLength)}`;
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
		// Spelling priority: explicit choice > the enharmonic that is IN the
		// key signature (no accidental needed — a C# in D major must not
		// print as Db) > chord-diatonic preference > key-side default.
		const sigPref = signatureSpelling(((midi % 12) + 12) % 12, keySigAccidentals);
		const noteUseFlats = note.spelling === 'flat' ? true
			: note.spelling === 'sharp' ? false
			: sigPref === 'flat' ? true
			: sigPref === 'sharp' ? false
			: chordPref === 'flat' ? true
			: chordPref === 'sharp' ? false
			: useFlats;
		const pitch = midiToAbcPitch(midi, noteUseFlats, keySigAccidentals, barState);
		const tieSuffix = note.tied ? '-' : '';
		return `${pitch}${durationToAbc(duration, defaultLength)}${tieSuffix}`;
	}

	function emitElement(el: DisplayElement, duration: Fraction, barState: ReturnType<typeof initBarState>): void {
		if (el.note.pitch !== null && el.sourceIndex !== null) {
			pendingAnchors.push({
				tokenIndex: tokens.length,
				sourceIndex: el.sourceIndex,
				// Absolute whole-note offset = the section's base offset plus the
				// element's section-local offset (sectionBaseBars is this
				// section's base while the body loop runs).
				offset: sectionBaseBars * barDuration + fractionToFloat(el.note.offset),
				// The MuseScore-style wavy connector is drawn over the SVG by
				// NotationDisplay (abcjs has no native glissando).
				...(el.note.gliss ? { gliss: true } : {})
			});
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

	// ── Global chord/silence timeline (absolute whole-note offsets) ──────
	// The chord voice is built per system line from these.
	const chordEvents: { at: number; text: string }[] = [];
	const soundSpans: { start: number; end: number }[] = [];
	{
		let base = 0;
		for (const sec of sheet.sections) {
			for (const h of sec.harmony) {
				const at = base + fractionToFloat(h.startOffset);
				const text = chordDisplayText(h, instrument, displayKey);
				const existing = chordEvents.findIndex((c) => Math.abs(c.at - at) < 1e-9);
				if (existing >= 0) chordEvents[existing] = { at, text };
				else chordEvents.push({ at, text });
			}
			for (const n of sec.notes) {
				if (n.pitch === null) continue;
				const start = base + fractionToFloat(n.offset);
				soundSpans.push({ start, end: start + fractionToFloat(n.duration) });
			}
			base += sec.bars * barDuration;
		}
		chordEvents.sort((a, b) => a.at - b.at);
	}

	const padToken = (bars: number): string => {
		const num = sheet.timeSignature[0] * bars;
		const den = sheet.timeSignature[1];
		const g = gcd(num, den);
		return `x${durationToAbc([num / g, den / g], defaultLength)} `;
	};

	const isSounding = (t: number): boolean =>
		soundSpans.some((sp) => t > sp.start - 1e-9 && t < sp.end + 1e-9);

	/**
	 * One chord-voice bar: x under melody, z where silent, cut at anchors.
	 * Returns one token per segment (joined with ' ' by the caller for
	 * byte-identity) plus the parallel per-segment slot metadata.
	 */
	function chordBar(barStartAbs: number): {
		tokens: string[];
		slots: { beat: number; chord: string | null }[];
	} {
		const be = barStartAbs + barDuration;
		const cuts = new Set<number>([barStartAbs, be]);
		for (const c of chordEvents) if (c.at > barStartAbs + 1e-9 && c.at < be - 1e-9) cuts.add(c.at);
		for (const sp of soundSpans) {
			if (sp.start > barStartAbs + 1e-9 && sp.start < be - 1e-9) cuts.add(sp.start);
			if (sp.end > barStartAbs + 1e-9 && sp.end < be - 1e-9) cuts.add(sp.end);
		}
		const points = [...cuts].sort((a, b) => a - b);
		const segs: { chord: string | null; silent: boolean; from: number; to: number }[] = [];
		for (let i = 0; i + 1 < points.length; i++) {
			const [s0, s1] = [points[i], points[i + 1]];
			const chord = chordEvents.find((c) => Math.abs(c.at - s0) < 1e-9)?.text ?? null;
			const silent = !isSounding((s0 + s1) / 2);
			const prev = segs[segs.length - 1];
			if (prev && chord === null && prev.silent === silent) {
				prev.to = s1; // merge cosmetic cuts (ties, chordless boundaries)
			} else {
				segs.push({ chord, silent, from: s0, to: s1 });
			}
		}
		// A "beat" is a denominator-note; beat = whole-notes-into-bar × den.
		const beatsPerWhole = sheet.timeSignature[1];
		return {
			tokens: segs.map(
				(sg) => `${sg.chord ? `"${sg.chord}"` : ''}${sg.silent ? 'z' : 'x'}${durationToAbc(approxToFraction(sg.to - sg.from), defaultLength)}`
			),
			slots: segs.map((sg) => ({
				beat: Math.round((sg.from - barStartAbs) * beatsPerWhole * 1e6) / 1e6,
				chord: sg.chord
			}))
		};
	}

	// ── Line management: each system emits a melody line + a chord line ──
	let lineStartBar = 0; // absolute bar where the open line begins
	let linePadBars = 0;
	let lineOpen = false;
	let sectionBaseBars = 0;

	// Base-bar table: sectionBases[i] = absolute bar where section i begins.
	// Lets the chord-voice flush map any absolute bar back to its section.
	const sectionBases: number[] = [];
	{
		let acc = 0;
		for (const s of sheet.sections) {
			sectionBases.push(acc);
			acc += s.bars;
		}
	}
	function absBarToSection(absBar: number): { sectionIdx: number; bar: number } {
		let idx = 0;
		for (let s = 0; s < sectionBases.length; s++) {
			if (sectionBases[s] <= absBar) idx = s;
			else break;
		}
		return { sectionIdx: idx, bar: absBar - sectionBases[idx] };
	}

	function openLine(padBars: number, startBar: number): void {
		tokens.push('[V:M]');
		if (padBars > 0) tokens.push(padToken(padBars));
		lineStartBar = startBar;
		linePadBars = padBars;
		lineOpen = true;
	}

	function flushLine(endBar: number): void {
		if (!lineOpen) return;
		// A zero-bar line (possible on unvalidated drafts/curated data with a
		// bars: 0 section) must not emit a stray empty chord-voice bar — but
		// the dangling [V:M] open must still be newline-terminated or the next
		// section's boxed P: label concatenates onto it.
		if (endBar <= lineStartBar) {
			tokens.push('\n');
			lineOpen = false;
			return;
		}
		tokens.push('\n[V:H]');
		if (linePadBars > 0) tokens.push(padToken(linePadBars));
		// Push each segment token individually while interleaving the exact
		// same ' ' (between segments), ' | ' (between bars) and trailing ' |'
		// separators the join produced, so the emitted string is byte-identical
		// — and record a chord slot per segment token.
		for (let b = lineStartBar; b < endBar; b++) {
			if (b > lineStartBar) tokens.push(' | ');
			const { tokens: segTokens, slots } = chordBar(b * barDuration);
			const { sectionIdx, bar } = absBarToSection(b);
			for (let s = 0; s < segTokens.length; s++) {
				if (s > 0) tokens.push(' ');
				pendingChordSlots.push({
					tokenIndex: tokens.length,
					sectionIdx,
					bar,
					beat: slots[s].beat,
					chord: slots[s].chord
				});
				tokens.push(segTokens[s]);
			}
		}
		tokens.push(' |');
		tokens.push('\n');
		lineOpen = false;
	}

	for (let secIdx = 0; secIdx < sheet.sections.length; secIdx++) {
		const sec = sheet.sections[secIdx];
		const sectionEnd = sec.bars * barDuration;

		// ── Line placement (the previous section closed with its barline) ──
		let startsNewLine = true;
		let padBars = 0;
		if (secIdx > 0) {
			const prev = sheet.sections[secIdx - 1];
			if (sec.ending === 2) {
				padBars = endingOneColumn;
				lineColumn = endingOneColumn;
			} else if (sec.ending === 1 && prevEndColumn > 0 && prevEndColumn < barsPerLine) {
				startsNewLine = false;
				lineColumn = prevEndColumn;
			} else {
				lineColumn = 0;
			}
			if (sec.ending === 1 && prev.ending !== 1) endingOneColumn = lineColumn;
		} else {
			lineColumn = 0;
		}

		if (startsNewLine) {
			flushLine(sectionBaseBars);
			// Section prelude: part label between systems. Blank labels (pickup
			// bars, front matter) get no marker and don't disturb the
			// consecutive-duplicate suppression.
			if (sec.label.trim() !== '') {
				if (sec.label !== previousLabel) {
					tokens.push(`P:${sec.label}\n`);
				}
				previousLabel = sec.label;
			}
			openLine(padBars, sectionBaseBars);
		} else {
			tokens.push(' ');
			if (sec.label.trim() !== '') previousLabel = sec.label;
		}
		if (sec.repeatStart) tokens.push('|:');
		if (sec.ending) tokens.push(`[${sec.ending}`);
		// The section body always opens at bar 0 (section-local offsets start
		// at 0); the span begins after the |: / [n decorations above.
		openBarSpan(secIdx, 0);

		// ── Gap-fill: every bar renders, melody or not (invisible in this
		// voice — visible rests come from the chord voice) ──────────────
		const inputNotes: Note[] = [];
		const inputSources: (number | null)[] = [];
		let cursor = 0;
		for (let i = 0; i < sec.notes.length; i++) {
			const n = sec.notes[i];
			const off = fractionToFloat(n.offset);
			if (off > cursor + 1e-9) {
				inputNotes.push({ pitch: null, duration: approxToFraction(off - cursor), offset: approxToFraction(cursor) });
				inputSources.push(null);
			}
			inputNotes.push(n);
			inputSources.push(flattenedNoteBase + i);
			cursor = Math.max(cursor, off + fractionToFloat(n.duration));
		}
		if (sectionEnd > cursor + 1e-9) {
			inputNotes.push({ pitch: null, duration: approxToFraction(sectionEnd - cursor), offset: approxToFraction(cursor) });
			inputSources.push(null);
		}
		flattenedNoteBase += sec.notes.length;

		const { display, sourceMap } = mergeConsecutiveRests(inputNotes, sheet.timeSignature);
		const elements: DisplayElement[] = display.map((note, k) => ({
			note,
			sourceIndex: sourceMap[k] === null ? null : inputSources[sourceMap[k]!],
			governing: governingSegment(sec.harmony, fractionToFloat(note.offset))
		}));

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
					closeBarSpan(tokens.length - 1);
					// lineColumn + bar: an inline-flowed section (a first ending
					// continuing the body's line) enters mid-line, so breaks track
					// the ABSOLUTE column, not the section-local bar.
					if ((lineColumn + bar) % barsPerLine === 0) {
						flushLine(sectionBaseBars + bar);
						openLine(0, sectionBaseBars + bar);
					} else {
						tokens.push(' ');
					}
					barState = initBarState(keySigAccidentals);
					openBarSpan(secIdx, bar);
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

		// ── Section close: barline decoration ────────────────────────────
		const isLast = secIdx === sheet.sections.length - 1;
		const next = isLast ? null : sheet.sections[secIdx + 1];
		if (sec.repeatEnd) tokens.push(' :|');
		else if (isLast) tokens.push(' |]');
		else if (next?.ending) tokens.push(' |');
		else tokens.push(' ||');
		closeBarSpan(tokens.length - 1); // the section's last bar closes here

		prevEndColumn =
			lineColumn === 0
				? sec.bars % barsPerLine === 0
					? barsPerLine
					: sec.bars % barsPerLine
				: // Wrapped-inline sections normalize too: a long first ending that
					// broke onto later lines ends at its column WITHIN the last line
					// (0 blocks inline flow just like barsPerLine does).
					(lineColumn + sec.bars) % barsPerLine;
		sectionBaseBars += sec.bars;
	}
	flushLine(sectionBaseBars);

	// ── Anchor char-offset resolution across all tokens (incl. newlines) ──
	const headerStr = headerLines.join('\n');
	const bodyStart = headerStr.length + 1;
	const tokenStarts: number[] = new Array(tokens.length);
	let charCursor = 0;
	for (let t = 0; t < tokens.length; t++) {
		tokenStarts[t] = charCursor;
		charCursor += tokens[t].length;
	}
	const noteAnchors: PitchedNoteAnchor[] = pendingAnchors.map(
		({ tokenIndex, sourceIndex, offset, gliss }) => ({
			startChar: bodyStart + tokenStarts[tokenIndex],
			endChar: bodyStart + tokenStarts[tokenIndex] + tokens[tokenIndex].length,
			sourceIndex,
			offset,
			...(gliss ? { gliss: true } : {})
		})
	);
	const barAnchors: BarAnchor[] = pendingBarAnchors.map(
		({ startTokenIndex, barlineTokenIndex, sectionIdx, bar }) => ({
			startChar: bodyStart + tokenStarts[startTokenIndex],
			endChar: bodyStart + tokenStarts[barlineTokenIndex] + tokens[barlineTokenIndex].length,
			sectionIdx,
			bar
		})
	);
	const chordSlotAnchors: ChordSlotAnchor[] = pendingChordSlots.map(
		({ tokenIndex, sectionIdx, bar, beat, chord }) => ({
			startChar: bodyStart + tokenStarts[tokenIndex],
			endChar: bodyStart + tokenStarts[tokenIndex] + tokens[tokenIndex].length,
			sectionIdx,
			bar,
			beat,
			chord
		})
	);

	return { abc: headerStr + '\n' + tokens.join(''), noteAnchors, barAnchors, chordSlotAnchors };
}

/** Generate an ABC string from a tune, discarding the click-anchor map. */
export function tuneToAbc(
	sheet: Tune,
	instrument?: InstrumentConfig,
	options: TuneAbcOptions = {}
): string {
	return tuneToAbcWithMap(sheet, instrument, options).abc;
}
