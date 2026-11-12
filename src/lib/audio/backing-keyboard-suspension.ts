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

export type KeyboardResolutionColor = KeyboardSuspension & { readonly kind: '9-1' | '13-5' };

/** Resolve an existing color on the second native attack; the caller commits its actual final voicing. */
export function proposeKeyboardResolutionColors(input: Parameters<typeof proposeKeyboardSuspension>[0]): readonly KeyboardResolutionColor[] {
 const { chord, notes, resolutionNotes, family } = input;
 if (chord.quality !== '7' || !['rootless-a','rootless-b','shell','drop2'].includes(family) ||
  notes.length < 3 || notes.length > 4 || notes.length !== resolutionNotes.length ||
  notes.some((note,i) => !Number.isInteger(note) || note < 48 || note > 84 || note !== resolutionNotes[i] || i > 0 && note <= notes[i-1])) return [];
 const root = PITCH_CLASSES.indexOf(chord.root);
 if (root < 0) return [];
 const interval = (note: number) => (note - root + 120) % 12;
 // These colors retain both defining tones; they do not turn an unsupported
 // chord into a dominant. Root/fifth targets must not duplicate another voice.
 if (!notes.some(note => interval(note) === 4) || !notes.some(note => interval(note) === 10)) return [];
 const cells: KeyboardResolutionColor[] = [];
 for (const [source, kind] of [[2, '9-1'], [9, '13-5']] as const) {
  const indexes = notes.map((note,i) => interval(note) === source ? i : -1).filter(i => i >= 0);
  if (indexes.length !== 1) continue;
  const index = indexes[0], fromMidi = notes[index], toMidi = fromMidi - 2;
  if (index === notes.length - 1 || toMidi < 48 || index > 0 && toMidi - notes[index-1] < 2 || notes.some(note => interval(note) === source - 2)) continue;
  cells.push(Object.freeze({ kind, fromMidi, toMidi,
   suspendedNotes: Object.freeze([...notes]),
   resolutionNotes: Object.freeze(notes.map((note,i) => i === index ? toMidi : note)) }));
 }
 return Object.freeze(cells);
}
