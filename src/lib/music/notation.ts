import type { Note, Phrase, PitchClass } from '$lib/types/music.ts';
import type { InstrumentConfig } from '$lib/types/instruments.ts';
import { midiToPitchClass, midiToOctave, fractionToFloat } from './intervals.ts';
import { concertToWritten, concertKeyToWritten } from './transposition.ts';

/**
 * ABC notation generation from Phrase data.
 *
 * ABC is a text-based music notation format that abcjs renders to SVG.
 * Reference: https://abcnotation.com/wiki/abc:standard:v2.1
 */

const ABC_NOTE_NAMES_SHARP = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
const ABC_NOTE_NAMES_FLAT = ['C', '_D', 'D', '_E', 'E', 'F', '_G', 'G', '_A', 'A', '_B', 'B'];

/** Keys that conventionally use flats */
const FLAT_KEYS: PitchClass[] = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];

/**
 * Key signature accidentals: maps each key to the set of pitch classes (0-11)
 * that are sharped or flatted in that key signature.
 *
 * The value for each pitch class is the ABC accidental prefix applied by the key
 * signature: '^' for sharp, '_' for flat. Notes matching the key signature should
 * be written without an explicit accidental; notes that differ need an explicit
 * accidental (including '=' for naturals that cancel a key-sig accidental).
 */
const KEY_SIG_ACCIDENTALS: Record<string, Record<string, string>> = {
	// Sharp keys — keyed by letter name that the key signature alters
	'C':  {},
	'G':  { F: '^' },
	'D':  { F: '^', C: '^' },
	'A':  { F: '^', C: '^', G: '^' },
	'E':  { F: '^', C: '^', G: '^', D: '^' },
	'B':  { F: '^', C: '^', G: '^', D: '^', A: '^' },

	// Flat keys
	'F':  { B: '_' },
	'Bb': { B: '_', E: '_' },
	'Eb': { B: '_', E: '_', A: '_' },
	'Ab': { B: '_', E: '_', A: '_', D: '_' },
	'Db': { B: '_', E: '_', A: '_', D: '_', G: '_' },
	'Gb': { B: '_', E: '_', A: '_', D: '_', G: '_', C: '_' },
};

/**
 * Convert a MIDI note to ABC notation pitch string, respecting key signature.
 *
 * ABC notation rule: when a key signature is active, notes that belong to the
 * key are written without accidentals. Accidentals are only written for
 * chromatic alterations (notes outside the key), including naturals that cancel
 * a key-signature sharp/flat.
 *
 * ABC octave convention: C = middle C (C4), c = C5, c' = C6, C, = C3
 */
function midiToAbcPitch(midi: number, useFlats: boolean, keySigAccidentals: Record<string, string>): string {
	const pc = midiToPitchClass(midi);
	const octave = midiToOctave(midi);
	const noteNames = useFlats ? ABC_NOTE_NAMES_FLAT : ABC_NOTE_NAMES_SHARP;
	const name = noteNames[pc];

	// Extract the raw accidental and letter from the chromatic note name
	const rawAccidental = name.startsWith('^') || name.startsWith('_') ? name[0] : '';
	const letter = name.replace(/[\^_=]/, '');

	// Determine what accidental (if any) the key signature applies to this letter
	const keySigAcc = keySigAccidentals[letter] || '';

	let accidental: string;
	if (rawAccidental === keySigAcc) {
		// Note matches key signature exactly — no explicit accidental needed.
		// This covers both: note has sharp/flat matching key sig, AND natural
		// note with no key sig accidental (both are '').
		accidental = '';
	} else if (rawAccidental === '' && keySigAcc !== '') {
		// Note is natural but key sig has a sharp/flat on this letter —
		// we need an explicit natural sign to cancel the key signature.
		accidental = '=';
	} else {
		// Chromatic alteration: note has an accidental different from key sig
		accidental = rawAccidental;
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

/**
 * Generate an ABC notation string from a Phrase.
 *
 * Inserts barlines at bar boundaries and groups notes within beats
 * for proper beam grouping (eighth notes paired, etc.).
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
	const keySigAccidentals = KEY_SIG_ACCIDENTALS[displayKey] || {};

	const beatsPerBar = phrase.timeSignature[0];
	const beatUnit = phrase.timeSignature[1];
	// Duration of one bar in whole notes (e.g. 4/4 = 1.0)
	const barDuration = beatsPerBar / beatUnit;
	// Duration of one beat in whole notes (e.g. quarter = 0.25)
	const beatDuration = 1 / beatUnit;

	// ABC header
	const lines: string[] = [
		`X:1`,
		`T:${phrase.name}`,
		`M:${phrase.timeSignature[0]}/${phrase.timeSignature[1]}`,
		`L:${defaultLength[0]}/${defaultLength[1]}`,
		`K:${displayKey}`,
	];

	// Generate notes with barlines and beam grouping
	const tokens: string[] = [];
	let prevBar = 0;
	let prevBeat = 0;

	for (let i = 0; i < phrase.notes.length; i++) {
		const note = phrase.notes[i];
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
			} else if (beat !== prevBeat) {
				// Different beat within the same bar: space for beam break
				tokens.push(' ');
			}
			// Same beat: no space — notes are beamed together
		}

		// Generate ABC for this note
		if (note.pitch === null) {
			tokens.push(`z${durationToAbc(note.duration, defaultLength)}`);
		} else {
			const midi = instrument ? concertToWritten(note.pitch, instrument) : note.pitch;
			const pitch = midiToAbcPitch(midi, useFlats, keySigAccidentals);
			const dur = durationToAbc(note.duration, defaultLength);
			tokens.push(`${pitch}${dur}`);
		}

		prevBar = bar;
		prevBeat = beat;
	}

	tokens.push(' |]');
	lines.push(tokens.join(''));
	return lines.join('\n');
}

/**
 * Convert a single MIDI note to a display-friendly note name.
 * Returns e.g. "C4", "Bb3", "F#5"
 */
export function midiToDisplayName(midi: number, useFlats = true): string {
	const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
	const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
	const names = useFlats ? NAMES_FLAT : NAMES_SHARP;
	return `${names[midiToPitchClass(midi)]}${midiToOctave(midi)}`;
}
