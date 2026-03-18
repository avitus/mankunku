export type TransposingKey = 'Bb' | 'Eb' | 'C' | 'F';
export type Clef = 'treble' | 'bass';

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
}

export const INSTRUMENTS: Record<string, InstrumentConfig> = {
	'tenor-sax': {
		name: 'Tenor Saxophone',
		key: 'Bb',
		transpositionSemitones: 14,
		concertRangeLow: 44,
		concertRangeHigh: 76,
		clef: 'treble',
		gmProgram: 66
	},
	'alto-sax': {
		name: 'Alto Saxophone',
		key: 'Eb',
		transpositionSemitones: 9,
		concertRangeLow: 49,
		concertRangeHigh: 80,
		clef: 'treble',
		gmProgram: 65
	},
	trumpet: {
		name: 'Trumpet',
		key: 'Bb',
		transpositionSemitones: 2,
		concertRangeLow: 52,
		concertRangeHigh: 82,
		clef: 'treble',
		gmProgram: 56
	}
};
