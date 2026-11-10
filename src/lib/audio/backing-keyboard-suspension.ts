import { PITCH_CLASSES, type PitchClass, type ChordQuality } from '$lib/types/music';
import type { CoordinatedVoicingFamily } from './coordinated-voicing';

/** A complete color-and-resolution cell, never a promise to resolve in a later bar. */
export interface KeyboardSuspension {
	readonly suspendedNotes: readonly number[];
	readonly resolutionNotes: readonly number[];
	readonly fromMidi: number;
	readonly toMidi: number;
}

/** Decorate an already selected repeated dominant shape without moving its top voice. */
export function proposeKeyboardSuspension(input: {
	chord: { root: PitchClass; quality: ChordQuality };
	family: CoordinatedVoicingFamily;
	notes: readonly number[];
	resolutionNotes: readonly number[];
}): KeyboardSuspension | undefined {
	const { chord, notes, resolutionNotes, family } = input;
	if (chord.quality !== '7' || !['rootless-a', 'rootless-b'].includes(family) ||
		notes.length < 3 || notes.length > 4 || notes.length !== resolutionNotes.length ||
		notes.some((note, i) => !Number.isInteger(note) || note < 48 || note > 84 ||
			note !== resolutionNotes[i] || i > 0 && note <= notes[i - 1])) return;
	const root = PITCH_CLASSES.indexOf(chord.root);
	if (root < 0) return;
	const thirds = notes.map((note, i) => (note - root + 120) % 12 === 4 ? i : -1).filter(i => i >= 0);
	if (thirds.length !== 1 || !notes.some(note => (note - root + 120) % 12 === 10)) return;
	const index = thirds[0], toMidi = notes[index], fromMidi = toMidi + 1;
	// No new semitone cluster, crossed voice or displaced upper melody. Existing
	// close intervals elsewhere in the selected rootless shape stay untouched.
	if (index === notes.length - 1 || notes[index + 1] - fromMidi < 2) return;
	const suspendedNotes = notes.map((note, i) => i === index ? fromMidi : note);
	return Object.freeze({ suspendedNotes: Object.freeze(suspendedNotes),
		resolutionNotes: Object.freeze([...resolutionNotes]), fromMidi, toMidi });
}
