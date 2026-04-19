import type { ChordQuality } from '$lib/types/music';

export interface ChordDefinition {
	quality: ChordQuality;
	name: string;
	/** Semitone intervals from root */
	intervals: number[];
	symbol: string;
}

export const CHORD_DEFINITIONS: Record<ChordQuality, ChordDefinition> = {
	maj7: { quality: 'maj7', name: 'Major 7th', intervals: [0, 4, 7, 11], symbol: 'maj7' },
	min7: { quality: 'min7', name: 'Minor 7th', intervals: [0, 3, 7, 10], symbol: 'm7' },
	'7': { quality: '7', name: 'Dominant 7th', intervals: [0, 4, 7, 10], symbol: '7' },
	min7b5: { quality: 'min7b5', name: 'Half-Diminished', intervals: [0, 3, 6, 10], symbol: 'm7b5' },
	dim7: { quality: 'dim7', name: 'Diminished 7th', intervals: [0, 3, 6, 9], symbol: 'dim7' },
	maj6: { quality: 'maj6', name: 'Major 6th', intervals: [0, 4, 7, 9], symbol: '6' },
	min6: { quality: 'min6', name: 'Minor 6th', intervals: [0, 3, 7, 9], symbol: 'm6' },
	aug7: { quality: 'aug7', name: 'Augmented 7th', intervals: [0, 4, 8, 10], symbol: '7#5' },
	sus4: { quality: 'sus4', name: 'Suspended 4th', intervals: [0, 5, 7, 10], symbol: '7sus4' },
	sus2: { quality: 'sus2', name: 'Suspended 2nd', intervals: [0, 2, 7, 10], symbol: '7sus2' },
	'7alt': { quality: '7alt', name: 'Altered Dominant', intervals: [0, 4, 6, 10], symbol: '7alt' },
	'7#11': { quality: '7#11', name: 'Lydian Dominant', intervals: [0, 4, 6, 7, 10], symbol: '7#11' },
	'7b9': { quality: '7b9', name: 'Dominant b9', intervals: [0, 1, 4, 7, 10], symbol: '7b9' },
	'7#9': { quality: '7#9', name: 'Dominant #9', intervals: [0, 3, 4, 7, 10], symbol: '7#9' },
	'7b13': { quality: '7b13', name: 'Dominant b13', intervals: [0, 4, 7, 8, 10], symbol: '7b13' },
	minMaj7: { quality: 'minMaj7', name: 'Minor-Major 7th', intervals: [0, 3, 7, 11], symbol: 'mMaj7' },
	aug: { quality: 'aug', name: 'Augmented', intervals: [0, 4, 8], symbol: 'aug' },
	dim: { quality: 'dim', name: 'Diminished', intervals: [0, 3, 6], symbol: 'dim' }
};

/** Get chord tones as MIDI notes from a root MIDI note */
export function chordTones(rootMidi: number, quality: ChordQuality): number[] {
	return CHORD_DEFINITIONS[quality].intervals.map((i) => rootMidi + i);
}

/** Get display symbol for a chord (e.g. "Dm7") */
export function chordSymbol(root: string, quality: ChordQuality): string {
	return `${root}${CHORD_DEFINITIONS[quality].symbol}`;
}
