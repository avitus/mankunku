import type { PitchClass } from '$lib/types/music.ts';
import type { InstrumentConfig } from '$lib/types/instruments.ts';
import { PITCH_CLASSES } from '$lib/types/music.ts';

/**
 * Transpose a concert-pitch MIDI note to written pitch for a transposing instrument.
 * Written = Concert + transpositionSemitones
 */
export function concertToWritten(concertMidi: number, instrument: InstrumentConfig): number {
	return concertMidi + instrument.transpositionSemitones;
}

/**
 * Transpose a written-pitch MIDI note to concert pitch.
 * Concert = Written - transpositionSemitones
 */
export function writtenToConcert(writtenMidi: number, instrument: InstrumentConfig): number {
	return writtenMidi - instrument.transpositionSemitones;
}

/**
 * Transpose a concert key to the written key for a transposing instrument.
 */
export function concertKeyToWritten(concertKey: PitchClass, instrument: InstrumentConfig): PitchClass {
	const idx = PITCH_CLASSES.indexOf(concertKey);
	const transposed = ((idx + instrument.transpositionSemitones) % 12 + 12) % 12;
	return PITCH_CLASSES[transposed];
}

/**
 * Transpose a written key to concert pitch.
 */
export function writtenKeyToConcert(writtenKey: PitchClass, instrument: InstrumentConfig): PitchClass {
	const idx = PITCH_CLASSES.indexOf(writtenKey);
	const transposed = ((idx - instrument.transpositionSemitones) % 12 + 12) % 12;
	return PITCH_CLASSES[transposed];
}

/**
 * Transpose a MIDI note by an interval in semitones.
 */
export function transpose(midi: number, semitones: number): number {
	return midi + semitones;
}

/**
 * Transpose a pitch class by semitones.
 */
export function transposePitchClass(pc: PitchClass, semitones: number): PitchClass {
	const idx = PITCH_CLASSES.indexOf(pc);
	const transposed = ((idx + semitones) % 12 + 12) % 12;
	return PITCH_CLASSES[transposed];
}

/**
 * Get the interval in semitones from one pitch class to another (ascending).
 */
export function pitchClassInterval(from: PitchClass, to: PitchClass): number {
	const fromIdx = PITCH_CLASSES.indexOf(from);
	const toIdx = PITCH_CLASSES.indexOf(to);
	return ((toIdx - fromIdx) % 12 + 12) % 12;
}

/**
 * Check if a MIDI note is within an instrument's concert range.
 */
export function isInRange(midi: number, instrument: InstrumentConfig): boolean {
	return midi >= instrument.concertRangeLow && midi <= instrument.concertRangeHigh;
}
