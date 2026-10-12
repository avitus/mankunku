export type TransposingKey = 'Bb' | 'Eb' | 'C' | 'F';
export type Clef = 'treble' | 'bass';
export type BackingInstrument = 'piano' | 'organ';
export type BackingStyle = 'swing' | 'bossa-nova' | 'ballad' | 'straight';

export interface InstrumentConfig {
	name: string;
	/** Transposing key of the instrument */
	key: TransposingKey;
	/** Concert pitch + this = written pitch (in semitones) */
	transpositionSemitones: number;
	/** Lowest note in concert pitch (MIDI) */
	concertRangeLow: number;
	/** Highest note in concert pitch (MIDI) */
	concertRangeHigh: number;
	clef: Clef;
	/** General MIDI program number for SoundFont playback */
	gmProgram: number;
	/** Concert MIDI values for the "highest note" dropdown, highest first */
	highNotePresets: number[];
}

/**
 * Every instrument the user can pick. The transposing horns are chosen
 * directly; the C instruments sit behind ONE "Concert Pitch" choice and a
 * follow-up question (`CONCERT_INSTRUMENT_IDS`), because they share a
 * transposition and differ only in range, sound and tuning advice.
 *
 * The C instruments' ranges stay inside the pitch detector's 80–1200 Hz
 * window (`pitch-frame.ts`: concert E2–D6, MIDI 40–86) — a lick transposed
 * below or above it could never be heard back. That clips the bass to its
 * upper register, and every C instrument reads concert pitch on the treble
 * staff (no bass clef, no guitar/bass octave transposition yet).
 * `concert` predates the follow-up and keeps its wide range for the users
 * who already chose it.
 */
export const INSTRUMENTS: Record<string, InstrumentConfig> = {
	concert: {
		name: 'Other C Instrument',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 36,
		concertRangeHigh: 96,
		clef: 'treble',
		gmProgram: 0,
		highNotePresets: [96, 90, 84, 79, 72, 65]
	},
	'soprano-sax': {
		name: 'Soprano Saxophone',
		key: 'Bb',
		// Soprano sounds a major 2nd below written — same as the Bb trumpet, NOT 14 like the tenor.
		transpositionSemitones: 2,
		concertRangeLow: 56, // written Bb3 (58) − 2 = concert Ab3
		concertRangeHigh: 88, // written F#6 (90) − 2 = concert E6; matches the other saxes' written top
		clef: 'treble',
		gmProgram: 64, // GM 64 = Soprano Sax (alto=65, tenor=66)
		highNotePresets: [90, 89, 88, 87, 86, 84]
	},
	'tenor-sax': {
		name: 'Tenor Saxophone',
		key: 'Bb',
		transpositionSemitones: 14,
		concertRangeLow: 44,
		concertRangeHigh: 76,
		clef: 'treble',
		gmProgram: 66,
		highNotePresets: [78, 77, 76, 75, 74, 72]
	},
	'alto-sax': {
		name: 'Alto Saxophone',
		key: 'Eb',
		transpositionSemitones: 9,
		concertRangeLow: 49,
		concertRangeHigh: 80,
		clef: 'treble',
		gmProgram: 65,
		highNotePresets: [82, 81, 80, 79, 78, 76]
	},
	trumpet: {
		name: 'Trumpet',
		key: 'Bb',
		transpositionSemitones: 2,
		concertRangeLow: 52,
		concertRangeHigh: 82,
		clef: 'treble',
		gmProgram: 56,
		highNotePresets: [84, 83, 82, 81, 80, 77]
	},
	piano: {
		name: 'Piano',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 48, // C3
		concertRangeHigh: 85, // default highest C6
		clef: 'treble',
		gmProgram: 0,
		highNotePresets: [86, 84, 81, 79, 77, 74]
	},
	guitar: {
		name: 'Guitar',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 40, // low E string
		concertRangeHigh: 77, // default highest E5, the 12th fret of the top string
		clef: 'treble',
		gmProgram: 26, // GM 26 = Jazz Guitar
		highNotePresets: [84, 81, 79, 76, 74, 72]
	},
	bass: {
		name: 'Bass',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 40, // E2 — the detector's floor, an octave above the open E string
		concertRangeHigh: 68, // default highest G4, thumb position
		clef: 'bass',
		gmProgram: 32,
		highNotePresets: [72, 69, 67, 64, 62, 60]
	},
	trombone: {
		name: 'Trombone',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 40, // E2, 7th position
		concertRangeHigh: 75, // default highest D5
		clef: 'bass',
		gmProgram: 57,
		highNotePresets: [77, 75, 74, 72, 70, 67]
	},
	flute: {
		name: 'Flute',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 60, // C4
		concertRangeHigh: 87, // default highest D6, the detector's ceiling
		clef: 'treble',
		gmProgram: 73,
		highNotePresets: [86, 84, 81, 79, 77, 74]
	},
	vibraphone: {
		name: 'Vibraphone',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 53, // F3, the bottom bar
		concertRangeHigh: 87, // default highest D6, the detector's ceiling (bars run to F6)
		clef: 'treble',
		gmProgram: 11,
		highNotePresets: [86, 84, 81, 79, 77, 74]
	},
	violin: {
		name: 'Violin',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 55, // open G
		concertRangeHigh: 87, // default highest D6, the detector's ceiling
		clef: 'treble',
		gmProgram: 40,
		highNotePresets: [86, 84, 81, 79, 77, 76]
	},
	voice: {
		name: 'Voice',
		key: 'C',
		transpositionSemitones: 0,
		concertRangeLow: 48, // C3
		concertRangeHigh: 77, // default highest E5; the knob lowers it for lower voices
		clef: 'treble',
		gmProgram: 53, // GM 53 = Voice Oohs
		highNotePresets: [81, 79, 76, 74, 72, 69, 67]
	}
};

/** The transposing instruments, picked directly. */
export const TRANSPOSING_INSTRUMENT_IDS = ['soprano-sax', 'alto-sax', 'tenor-sax', 'trumpet'] as const;

/** The answers to "which C instrument?", in the order the question lists them. */
export const CONCERT_INSTRUMENT_IDS = [
	'piano',
	'guitar',
	'bass',
	'trombone',
	'flute',
	'vibraphone',
	'violin',
	'voice',
	'concert'
] as const;

/** True for every instrument behind the "Concert Pitch" choice. */
export function isConcertInstrument(id: string): boolean {
	return (CONCERT_INSTRUMENT_IDS as readonly string[]).includes(id);
}

/** The follow-up question's button label — `concert` is its "Other" answer. */
export function concertInstrumentLabel(id: string): string {
	return id === 'concert' ? 'Other' : (INSTRUMENTS[id]?.name ?? id);
}
