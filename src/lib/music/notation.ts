import type { Note, Phrase, PitchClass } from '$lib/types/music.ts';
import type { InstrumentConfig } from '$lib/types/instruments.ts';
import { midiToPitchClass, midiToOctave, fractionToFloat } from './intervals.ts';
import { concertToWritten, concertKeyToWritten } from './transposition.ts';

/** Note letter names A–G */
type NoteLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

/** ABC accidental prefix applied by a key signature */
type KeySigAccidental = '^' | '_';

/** Map of note letters to their key-signature accidentals */
type KeySigMap = Partial<Record<NoteLetter, KeySigAccidental>>;

/**
 * ABC notation generation from Phrase data.
 *
 * ABC is a text-based music notation format that abcjs renders to SVG.
 * Reference: https://abcnotation.com/wiki/abc:standard:v2.1
 */

const ABC_NOTE_NAMES_SHARP = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
const ABC_NOTE_NAMES_FLAT = ['C', '_D', 'D', '_E', 'E', 'F', '_G', 'G', '_A', 'A', '_B', 'B'];

/** Keys that conventionally use flats */
const FLAT_KEYS: PitchClass[] = ['F', 'Bb', 'Eb', 'Ab', 'Db'];

/**
 * Key signature accidentals: maps each key to the set of note letters ('A'–'G')
 * that are sharped or flatted in that key signature.
 *
 * The value for each letter name is the ABC accidental prefix applied by the key
 * signature: '^' for sharp, '_' for flat, '=' for natural. Notes matching the
 * key signature should be written without an explicit accidental; notes that
 * differ require an explicit accidental (including '=' for naturals that cancel
 * a key-sig sharp or flat).
 */
const KEY_SIG_ACCIDENTALS: Partial<Record<PitchClass, KeySigMap>> = {
	// Sharp keys — keyed by letter name that the key signature alters
	'C':  {},
	'G':  { F: '^' },
	'D':  { F: '^', C: '^' },
	'A':  { F: '^', C: '^', G: '^' },
	'E':  { F: '^', C: '^', G: '^', D: '^' },
	'B':  { F: '^', C: '^', G: '^', D: '^', A: '^' },
	'F#': { F: '^', C: '^', G: '^', D: '^', A: '^', E: '^' },

	// Flat keys
	'F':  { B: '_' },
	'Bb': { B: '_', E: '_' },
	'Eb': { B: '_', E: '_', A: '_' },
	'Ab': { B: '_', E: '_', A: '_', D: '_' },
	'Db': { B: '_', E: '_', A: '_', D: '_', G: '_' },
};

/**
 * When a natural note from the chromatic table conflicts with the key signature,
 * this maps the letter to its enharmonic flat-above spelling.
 * E.g., in K:Gb (6 flats), B (pc 11) should be Cb since the key sig flats C.
 */
const ENHARMONIC_FLAT_RESPELL: Partial<Record<NoteLetter, NoteLetter>> = {
	B: 'C',  // B natural → Cb
	E: 'F',  // E natural → Fb
};

/**
 * Per-bar accidental state. Tracks the "currently displayed" accidental for
 * each letter name in the current bar. Initialized from the key signature at
 * the start of each bar; updated as explicit accidentals are emitted.
 *
 * Classical notation rule: once an accidental is shown on a letter name in a
 * bar, it persists to the end of that bar for subsequent notes on the same
 * letter. We use this state to decide whether an explicit accidental is
 * needed on each note.
 */
type BarAccidentalState = Record<NoteLetter, '^' | '_' | '=' | ''>;

function initBarState(keySigAccidentals: KeySigMap): BarAccidentalState {
	const letters: NoteLetter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
	const state = {} as BarAccidentalState;
	for (const l of letters) state[l] = keySigAccidentals[l] ?? '';
	return state;
}

/**
 * Convert a MIDI note to ABC notation pitch string, respecting key signature
 * and bar-level accidental persistence.
 *
 * ABC notation rule: when a key signature is active, notes that belong to the
 * key are written without accidentals. Accidentals are only written for
 * chromatic alterations (notes outside the key), including naturals that cancel
 * a key-signature sharp/flat. Additionally, once an accidental is displayed
 * on a letter within a bar, it persists to subsequent notes on that letter
 * until the bar line — so if a later note on the same letter reverts to the
 * key-sig value, we must emit an explicit accidental to cancel the persisting
 * one.
 *
 * Mutates `barState` to reflect the accidental that will be "in effect" on the
 * returned letter after this note is rendered.
 *
 * ABC octave convention: C = middle C (C4), c = C5, c' = C6, C, = C3
 */
function midiToAbcPitch(
	midi: number,
	useFlats: boolean,
	keySigAccidentals: KeySigMap,
	barState: BarAccidentalState
): string {
	const pc = midiToPitchClass(midi);
	let octave = midiToOctave(midi);
	const noteNames = useFlats ? ABC_NOTE_NAMES_FLAT : ABC_NOTE_NAMES_SHARP;
	const name = noteNames[pc];

	// Extract the raw accidental and letter from the chromatic note name
	let rawAccidental = name.startsWith('^') || name.startsWith('_') ? name[0] : '';
	let letter = name.replace(/[\^_=]/, '');
	let keySigAcc = keySigAccidentals[letter as NoteLetter] ?? '';

	// Enharmonic respelling: when a natural note's letter is flatted by the key
	// sig, check if the note should be spelled as the next-letter-flat instead.
	// E.g., in K:Gb (6 flats), B (pc 11) → Cb since the key sig flats C.
	if (rawAccidental === '' && keySigAcc === '_') {
		const above = ENHARMONIC_FLAT_RESPELL[letter as NoteLetter];
		if (above && (keySigAccidentals[above] ?? '') === '_') {
			letter = above;
			rawAccidental = '_';
			keySigAcc = '_';
			if (above === 'C') octave += 1; // B→C crosses octave boundary
		}
	}

	// The "target accidental" is what this note actually sounds as:
	// - If rawAccidental is non-empty, that's explicit.
	// - Otherwise the note is natural ('').
	// A natural that cancels a key-sig sharp/flat is represented as '=' here.
	const target: '^' | '_' | '=' | '' =
		rawAccidental !== ''
			? (rawAccidental as '^' | '_')
			: keySigAcc !== ''
				? '='
				: '';

	// Compare against the currently-displayed accidental for this letter.
	const current = barState[letter as NoteLetter];
	let accidental: string;
	if (target === current) {
		// No change — no explicit accidental needed.
		accidental = '';
	} else {
		// Emit the explicit mark. '=' is ABC's natural sign.
		accidental = target === '' ? '=' : target;
		barState[letter as NoteLetter] = target;
	}

	if (octave >= 5) {
		// Lowercase + apostrophes for octave 5+
		const ticks = "'".repeat(octave - 5);
		return `${accidental}${letter.toLowerCase()}${ticks}`;
	} else if (octave === 4) {
		// Uppercase, no modifier
		return `${accidental}${letter}`;
	} else {
		// Uppercase + commas for octave 3 and below
		const commas = ','.repeat(4 - octave);
		return `${accidental}${letter}${commas}`;
	}
}

/**
 * Convert a note duration (fraction of whole note) to ABC duration string.
 * ABC default unit is 1/8. Duration multipliers:
 *   /2 = sixteenth, (none) = eighth, 2 = quarter, 4 = half, 8 = whole
 */
function durationToAbc(duration: [number, number], defaultLength: [number, number]): string {
	const noteBeats = fractionToFloat(duration);
	const unitBeats = fractionToFloat(defaultLength);
	const ratio = noteBeats / unitBeats;

	if (ratio === 1) return '';
	if (ratio === 2) return '2';
	if (ratio === 4) return '4';
	if (ratio === 8) return '8';
	if (ratio === 0.5) return '/2';
	if (ratio === 0.25) return '/4';
	if (ratio === 3) return '3';
	if (ratio === 1.5) return '3/2';

	// General case
	const num = duration[0] * defaultLength[1];
	const den = duration[1] * defaultLength[0];
	if (den === 1) return `${num}`;
	if (num === 1) return `/${den}`;
	return `${num}/${den}`;
}

/** Map triplet durations to their base (non-triplet) equivalents */
const TRIPLET_BASE: Array<{ triplet: [number, number]; base: [number, number] }> = [
	{ triplet: [2, 3], base: [1, 1] },   // whole-triplet → whole
	{ triplet: [1, 3], base: [1, 2] },   // half-triplet → half
	{ triplet: [1, 6], base: [1, 4] },   // quarter-triplet → quarter
	{ triplet: [1, 12], base: [1, 8] },  // eighth-triplet → eighth
];

function getTripletBase(d: [number, number]): [number, number] | null {
	for (const entry of TRIPLET_BASE) {
		if (d[0] * entry.triplet[1] === entry.triplet[0] * d[1]) return entry.base;
	}
	return null;
}

function sameDuration(a: [number, number], b: [number, number]): boolean {
	return a[0] * b[1] === b[0] * a[1];
}

/** Standard rest durations in descending order (whole notes) */
const REST_DURATIONS: [number, number][] = [[1, 2], [1, 4], [1, 8], [1, 16]];

/** Convert a float to the nearest standard musical fraction */
function approxToFraction(f: number): [number, number] {
	for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 24]) {
		const num = Math.round(f * den);
		if (Math.abs(num / den - f) < 1e-9) return [num, den];
	}
	return [Math.round(f * 24), 24];
}

/** Detect compound meters (6/8, 9/8, 12/8, 6/4, etc.) */
function isCompoundMeter(ts: [number, number]): boolean {
	return ts[0] % 3 === 0 && ts[0] / 3 >= 2;
}

/**
 * Merge consecutive non-triplet rests into standard notation groupings.
 *
 * Rules:
 *  - Rests never cross barlines
 *  - A rest spanning an entire bar becomes a single whole-bar rest
 *  - Duple meters: rests don't cross the bar midpoint (beat 3 in 4/4)
 *  - Compound meters: rests don't cross compound-beat boundaries (every
 *    3 sub-beats, e.g. every dotted quarter in 6/8)
 *  - Within each segment, use the largest standard duration that fits
 *  - Triplet rests are left untouched (they belong to a triplet group)
 */
function mergeConsecutiveRests(
	notes: readonly Note[],
	timeSignature: [number, number]
): Note[] {
	const barDur = timeSignature[0] / timeSignature[1];
	const compound = isCompoundMeter(timeSignature);

	let splitDur: number;
	let useSplit: boolean;
	let restPalette: [number, number][];

	if (compound) {
		// Compound meters split at each compound-beat boundary (e.g. every 3/8 in 6/8)
		splitDur = 3 / timeSignature[1];
		useSplit = true;
		const compoundBeat: [number, number] = [3, timeSignature[1]];
		restPalette = [compoundBeat, ...REST_DURATIONS.filter(d => d[0] / d[1] < splitDur - 1e-9)];
	} else {
		// Duple meters split at the bar midpoint
		splitDur = barDur / 2;
		useSplit = timeSignature[0] % 2 === 0;
		restPalette = REST_DURATIONS;
	}

	const result: Note[] = [];
	let i = 0;

	while (i < notes.length) {
		if (notes[i].pitch !== null || getTripletBase(notes[i].duration) !== null) {
			result.push(notes[i]);
			i++;
			continue;
		}

		// Collect contiguous non-triplet rests
		let spanEnd = fractionToFloat(notes[i].offset) + fractionToFloat(notes[i].duration);
		let j = i + 1;
		while (j < notes.length && notes[j].pitch === null && getTripletBase(notes[j].duration) === null) {
			const nextStart = fractionToFloat(notes[j].offset);
			if (Math.abs(spanEnd - nextStart) > 1e-9) break;
			spanEnd = nextStart + fractionToFloat(notes[j].duration);
			j++;
		}

		fillRests(result, fractionToFloat(notes[i].offset), spanEnd, barDur, splitDur, useSplit, restPalette, timeSignature);
		i = j;
	}

	return result;
}

/** Recursively decompose a rest span into properly grouped rests */
function fillRests(
	result: Note[], start: number, end: number,
	barDur: number, splitDur: number, useSplit: boolean,
	restDurations: readonly [number, number][], timeSignature: [number, number]
): void {
	if (end - start < 1e-9) return;

	const barIndex = Math.floor(start / barDur + 1e-9);
	const barStart = barIndex * barDur;
	const barEnd = barStart + barDur;

	// Split at barline
	if (end > barEnd + 1e-9) {
		fillRests(result, start, barEnd, barDur, splitDur, useSplit, restDurations, timeSignature);
		fillRests(result, barEnd, end, barDur, splitDur, useSplit, restDurations, timeSignature);
		return;
	}

	// Whole-bar rest
	if (Math.abs(start - barStart) < 1e-9 && Math.abs(end - barEnd) < 1e-9) {
		result.push({ pitch: null, duration: [timeSignature[0], timeSignature[1]], offset: approxToFraction(start) });
		return;
	}

	// Split at beat-group boundary (bar midpoint for duple, compound beat for compound)
	if (useSplit) {
		const posInBar = start - barStart;
		const splitIndex = Math.floor(posInBar / splitDur + 1e-9);
		const nextSplit = barStart + (splitIndex + 1) * splitDur;
		if (nextSplit < barEnd - 1e-9 && end > nextSplit + 1e-9) {
			fillRests(result, start, nextSplit, barDur, splitDur, useSplit, restDurations, timeSignature);
			fillRests(result, nextSplit, end, barDur, splitDur, useSplit, restDurations, timeSignature);
			return;
		}
	}

	// Greedy: largest fitting rest duration first
	let cursor = start;
	while (cursor < end - 1e-9) {
		const remaining = end - cursor;
		let dur: [number, number] = approxToFraction(remaining);
		for (const std of restDurations) {
			if (std[0] / std[1] <= remaining + 1e-9) { dur = std; break; }
		}
		result.push({ pitch: null, duration: dur, offset: approxToFraction(cursor) });
		cursor += dur[0] / dur[1];
	}
}

/**
 * Generate an ABC notation string from a Phrase.
 *
 * Inserts barlines at bar boundaries, groups notes within beats
 * for proper beam grouping, merges consecutive rests, and emits
 * ABC (3 triplet groups for consecutive triplet notes.
 *
 * @param phrase - The phrase to render
 * @param instrument - If provided, transposes to written pitch
 * @param defaultLength - ABC L: field value, default [1, 8] (eighth note)
 */
export function phraseToAbc(
	phrase: Phrase,
	instrument?: InstrumentConfig,
	defaultLength: [number, number] = [1, 8]
): string {
	const displayKey = instrument
		? concertKeyToWritten(phrase.key, instrument)
		: phrase.key;

	const useFlats = FLAT_KEYS.includes(displayKey);
	const keySigAccidentals: KeySigMap = KEY_SIG_ACCIDENTALS[displayKey] ?? {};

	const beatsPerBar = phrase.timeSignature[0];
	const beatUnit = phrase.timeSignature[1];
	// Duration of one bar in whole notes (e.g. 4/4 = 1.0)
	const barDuration = beatsPerBar / beatUnit;
	// Duration of one beat in whole notes (e.g. quarter = 0.25)
	const beatDuration = 1 / beatUnit;

	// Preprocess: merge consecutive rests into standard groupings
	const displayNotes = mergeConsecutiveRests(phrase.notes, phrase.timeSignature);

	// Per-bar accidental state — reset when crossing a barline below
	let barState: BarAccidentalState = initBarState(keySigAccidentals);

	function renderNote(note: Note, duration: [number, number]): string {
		if (note.pitch === null) {
			return `z${durationToAbc(duration, defaultLength)}`;
		}
		const midi = instrument ? concertToWritten(note.pitch, instrument) : note.pitch;
		const pitch = midiToAbcPitch(midi, useFlats, keySigAccidentals, barState);
		return `${pitch}${durationToAbc(duration, defaultLength)}`;
	}

	// ABC header
	const lines: string[] = [
		`X:1`,
		`T:${phrase.name}`,
		`M:${phrase.timeSignature[0]}/${phrase.timeSignature[1]}`,
		`L:${defaultLength[0]}/${defaultLength[1]}`,
		`K:${displayKey}`,
	];

	// Generate notes with barlines, beam grouping, and triplet groups
	const tokens: string[] = [];
	let prevBar = 0;
	let prevBeat = 0;

	for (let i = 0; i < displayNotes.length; /* increment varies */) {
		const note = displayNotes[i];
		const offset = fractionToFloat(note.offset);

		// Determine bar and beat position (small epsilon for floating-point)
		const bar = Math.floor(offset / barDuration + 1e-9);
		const posInBar = offset - bar * barDuration;
		const beat = Math.floor(posInBar / beatDuration + 1e-9);

		if (i > 0) {
			// Insert barlines for any bars that ended between the previous note and this one
			if (bar > prevBar) {
				for (let b = prevBar; b < bar; b++) {
					tokens.push(' |');
				}
				tokens.push(' ');
				// Reset accidental state at each new bar — classical rule:
				// accidentals persist only until the bar line.
				barState = initBarState(keySigAccidentals);
			} else if (beat !== prevBeat) {
				// Different beat within the same bar: space for beam break
				tokens.push(' ');
			}
			// Same beat: no space — notes are beamed together
		}

		// Check for a complete triplet group (3 consecutive same-duration pitched triplet notes
		// with rhythmically contiguous offsets)
		const tripBase = getTripletBase(note.duration);
		if (tripBase !== null && i + 2 < displayNotes.length &&
			sameDuration(displayNotes[i + 1].duration, note.duration) &&
			sameDuration(displayNotes[i + 2].duration, note.duration) &&
			displayNotes[i].pitch !== null &&
			displayNotes[i + 1].pitch !== null &&
			displayNotes[i + 2].pitch !== null) {

			const tripDur = fractionToFloat(note.duration);
			const off0 = fractionToFloat(displayNotes[i].offset);
			const off1 = fractionToFloat(displayNotes[i + 1].offset);
			const off2 = fractionToFloat(displayNotes[i + 2].offset);

			if (Math.abs(off1 - off0 - tripDur) < 1e-9 &&
				Math.abs(off2 - off1 - tripDur) < 1e-9) {

				tokens.push('(3');
				for (let j = 0; j < 3; j++) {
					tokens.push(renderNote(displayNotes[i + j], tripBase));
				}

				prevBar = Math.floor(off2 / barDuration + 1e-9);
				prevBeat = Math.floor((off2 - prevBar * barDuration) / beatDuration + 1e-9);
				i += 3;
				continue;
			}
		}

		// Single note
		tokens.push(renderNote(note, note.duration));
		prevBar = bar;
		prevBeat = beat;
		i += 1;
	}

	tokens.push(' |]');
	lines.push(tokens.join(''));
	return lines.join('\n');
}

/**
 * Respell a pitch class for chord display in a given key context.
 * In flat keys, F# displays as Gb so chord roots stay consistent
 * (e.g. Dbmaj7 → Gbmaj7 → Ab7 rather than Dbmaj7 → F#maj7 → Ab7).
 */
export function displayPitchClass(pc: PitchClass, keyContext: PitchClass): string {
	if (pc === 'F#' && FLAT_KEYS.includes(keyContext)) return 'Gb';
	return pc;
}

/**
 * Convert a single MIDI note to a display-friendly note name.
 * Returns e.g. "C4", "Bb3", "F#5"
 */
export function midiToDisplayName(midi: number, useFlats = true): string {
	const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
	const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
	const names = useFlats ? NAMES_FLAT : NAMES_SHARP;
	return `${names[midiToPitchClass(midi)]}${midiToOctave(midi)}`;
}
