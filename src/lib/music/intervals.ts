/**
 * Interval utilities for pitch math.
 * All MIDI note numbers are concert pitch.
 */

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Convert MIDI note number to pitch class index (0-11) */
export function midiToPitchClass(midi: number): number {
	return ((midi % 12) + 12) % 12;
}

/** Convert MIDI note number to octave */
export function midiToOctave(midi: number): number {
	return Math.floor(midi / 12) - 1;
}

/** Convert pitch class index + octave to MIDI */
export function pitchClassToMidi(pc: number, octave: number): number {
	return (octave + 1) * 12 + pc;
}

/** Get note name from MIDI number (e.g. 60 -> 'C4') */
export function midiToNoteName(midi: number): string {
	return `${NOTE_NAMES[midiToPitchClass(midi)]}${midiToOctave(midi)}`;
}

/** Parse note name to MIDI (e.g. 'C4' -> 60, 'Bb3' -> 58) */
export function noteNameToMidi(name: string): number {
	const match = name.match(/^([A-G][b#]?)(-?\d+)$/);
	if (!match) throw new Error(`Invalid note name: ${name}`);

	const [, notePart, octaveStr] = match;
	let pc = NOTE_NAMES.indexOf(notePart as (typeof NOTE_NAMES)[number]);
	if (pc === -1) {
		// Handle enharmonic aliases not in NOTE_NAMES
		const aliasMap: Record<string, string> = {
			'C#': 'Db', 'D#': 'Eb', 'G#': 'Ab', 'A#': 'Bb', 'E#': 'F', 'B#': 'C',
			'Gb': 'F#', 'Cb': 'B', 'Fb': 'E'
		};
		const canonical = aliasMap[notePart];
		if (!canonical) throw new Error(`Invalid note: ${notePart}`);
		pc = NOTE_NAMES.indexOf(canonical as (typeof NOTE_NAMES)[number]);
	}

	return pitchClassToMidi(pc, parseInt(octaveStr));
}

/** Interval in semitones between two MIDI notes */
export function semitoneDistance(from: number, to: number): number {
	return to - from;
}

/** Absolute interval in semitones (always positive) */
export function intervalSize(a: number, b: number): number {
	return Math.abs(a - b);
}

/** Convert frequency (Hz) to MIDI note number (fractional) */
export function frequencyToMidi(freq: number): number {
	return 12 * Math.log2(freq / 440) + 69;
}

/** Convert MIDI note number to frequency (Hz) */
export function midiToFrequency(midi: number): number {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Round fractional MIDI to nearest integer, return [midi, cents] */
export function quantizePitch(fractionalMidi: number): { midi: number; cents: number } {
	const midi = Math.round(fractionalMidi);
	const cents = Math.round((fractionalMidi - midi) * 100);
	return { midi, cents };
}

/** Fraction arithmetic helpers */
export function fractionToFloat(f: [number, number]): number {
	return f[0] / f[1];
}

export function addFractions(a: [number, number], b: [number, number]): [number, number] {
	const num = a[0] * b[1] + b[0] * a[1];
	const den = a[1] * b[1];
	const g = gcd(Math.abs(num), den);
	return [num / g, den / g];
}

export function multiplyFraction(f: [number, number], scalar: number): [number, number] {
	const num = f[0] * scalar;
	const g = gcd(Math.abs(num), f[1]);
	return [num / g, f[1] / g];
}

export function compareFractions(a: [number, number], b: [number, number]): number {
	const diff = a[0] * b[1] - b[0] * a[1];
	return diff === 0 ? 0 : diff > 0 ? 1 : -1;
}

export function subtractFractions(a: [number, number], b: [number, number]): [number, number] {
	const num = a[0] * b[1] - b[0] * a[1];
	const den = a[1] * b[1];
	const g = gcd(Math.abs(num), den);
	return [num / g, den / g];
}

export function gcd(a: number, b: number): number {
	while (b) { [a, b] = [b, a % b]; }
	return a;
}
