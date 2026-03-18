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
 * Convert a MIDI note to ABC notation pitch string.
 * ABC octave convention: C, = middle C (C4), c = C5, c' = C6, C, = C3
 */
function midiToAbcPitch(midi: number, useFlats: boolean): string {
	const pc = midiToPitchClass(midi);
	const octave = midiToOctave(midi);
	const noteNames = useFlats ? ABC_NOTE_NAMES_FLAT : ABC_NOTE_NAMES_SHARP;
	const name = noteNames[pc];

	// Extract the base letter (without accidental prefix)
	const accidental = name.startsWith('^') || name.startsWith('_') ? name[0] : '';
	const letter = name.replace(/[\^_=]/, '');

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

	// ABC header
	const lines: string[] = [
		`X:1`,
		`T:${phrase.name}`,
		`M:${phrase.timeSignature[0]}/${phrase.timeSignature[1]}`,
		`L:${defaultLength[0]}/${defaultLength[1]}`,
		`K:${displayKey}`,
	];

	// Add chord symbols if harmony is present
	let noteStr = '';
	for (const note of phrase.notes) {
		if (note.pitch === null) {
			// Rest
			noteStr += `z${durationToAbc(note.duration, defaultLength)} `;
		} else {
			const midi = instrument ? concertToWritten(note.pitch, instrument) : note.pitch;
			const pitch = midiToAbcPitch(midi, useFlats);
			const dur = durationToAbc(note.duration, defaultLength);
			noteStr += `${pitch}${dur} `;
		}
	}

	lines.push(noteStr.trim() + ' |]');
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
