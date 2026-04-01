import type { InstrumentConfig } from '$lib/types/instruments';
import { pitchClassToMidi } from '$lib/music/intervals';
import { writtenToConcert, isInRange } from '$lib/music/transposition';

const PITCH_KEY_MAP: Record<string, number> = {
	C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11
};

export function keyToPitchClass(key: string): number | null {
	return PITCH_KEY_MAP[key.toUpperCase()] ?? null;
}

export function isValidPitchKey(key: string): boolean {
	return key.toUpperCase() in PITCH_KEY_MAP;
}

export function applyAccidental(
	pitchClass: number, accidental: 'sharp' | 'flat' | 'natural'
): number {
	const mod = accidental === 'sharp' ? 1 : accidental === 'flat' ? -1 : 0;
	return ((pitchClass + mod) % 12 + 12) % 12;
}

export function buildMidiFromInput(
	pitchClass: number, octave: number,
	keyMode: 'concert' | 'written', instrument: InstrumentConfig
): number {
	const rawMidi = pitchClassToMidi(pitchClass, octave);
	return keyMode === 'written' ? writtenToConcert(rawMidi, instrument) : rawMidi;
}

export function isInInstrumentRange(
	concertMidi: number, instrument: InstrumentConfig
): boolean {
	return isInRange(concertMidi, instrument);
}
