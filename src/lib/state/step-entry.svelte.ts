import type { Note, Fraction, PitchClass, Phrase, PhraseCategory } from '$lib/types/music';
import type { BaseDurationId } from '$lib/step-entry/durations';
import { getDurationFraction } from '$lib/step-entry/durations';
import { addFractions, compareFractions, subtractFractions, fractionToFloat, pitchClassToMidi } from '$lib/music/intervals';
import { applyAccidental } from '$lib/step-entry/pitch-input';
import { writtenKeyToConcert } from '$lib/music/transposition';
import { getInstrument } from '$lib/state/settings.svelte';

/**
 * Written-pitch range for lick entry: Bb3 to F6.
 *
 * The user types note letters thinking in their instrument's WRITTEN pitch
 * (what they'd finger on their horn and see on their sheet music). These
 * bounds apply in written space. After validation, the value is converted
 * to concert pitch (`written - instrument.transpositionSemitones`) for
 * storage, so every lick is stored canonically in concert pitch.
 */
const ENTRY_RANGE_LOW = 58;  // Bb3 written
const ENTRY_RANGE_HIGH = 89; // F6 written

/** Reverse map from natural pitch class to letter name */
const PC_TO_LETTER: Record<number, string> = {
	0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B'
};

/** Key signature adjustments: key → letter → semitone delta */
const KEY_SIG_ADJUSTMENTS: Record<string, Record<string, number>> = {
	'C': {},
	'G': { F: 1 },
	'D': { F: 1, C: 1 },
	'A': { F: 1, C: 1, G: 1 },
	'E': { F: 1, C: 1, G: 1, D: 1 },
	'B': { F: 1, C: 1, G: 1, D: 1, A: 1 },
	'F': { B: -1 },
	'Bb': { B: -1, E: -1 },
	'Eb': { B: -1, E: -1, A: -1 },
	'Ab': { B: -1, E: -1, A: -1, D: -1 },
	'Db': { B: -1, E: -1, A: -1, D: -1, G: -1 },
	'Gb': { B: -1, E: -1, A: -1, D: -1, G: -1, C: -1 },
};

/** Apply key signature to a natural pitch class (e.g. F→F# in G major) */
function applyKeySig(pitchClass: number, key: PitchClass): number {
	const letter = PC_TO_LETTER[pitchClass];
	if (!letter) return pitchClass;
	const delta = KEY_SIG_ADJUSTMENTS[key]?.[letter] ?? 0;
	return ((pitchClass + delta) % 12 + 12) % 12;
}

function isInEntryRange(midi: number): boolean {
	return midi >= ENTRY_RANGE_LOW && midi <= ENTRY_RANGE_HIGH;
}

export const stepEntry = $state({
	currentDuration: 'quarter' as BaseDurationId,
	tripletMode: false,
	selectedOctave: 4,
	accidental: 'natural' as 'sharp' | 'flat' | 'natural',
	enteredNotes: [] as Note[],
	barCount: 2,
	phraseKey: 'C' as PitchClass,
	phraseName: '',
	category: 'user' as PhraseCategory,
	practiceTag: false
});

export function getCurrentCursorOffset(): Fraction {
	let offset: Fraction = [0, 1];
	for (const note of stepEntry.enteredNotes) {
		offset = addFractions(offset, note.duration);
	}
	return offset;
}

export function getMaxCapacity(): Fraction {
	return [stepEntry.barCount, 1];
}

export function getRemainingCapacity(): Fraction {
	return subtractFractions(getMaxCapacity(), getCurrentCursorOffset());
}

export function canAddDuration(duration: Fraction): boolean {
	return compareFractions(addFractions(getCurrentCursorOffset(), duration), getMaxCapacity()) <= 0;
}

export function getCurrentBarAndBeat(): { bar: number; beat: number } {
	const offset = fractionToFloat(getCurrentCursorOffset());
	const bar = Math.floor(offset) + 1;
	const beat = Math.floor((offset - Math.floor(offset)) * 4) + 1;
	return { bar, beat };
}

export function getPaddedNotes(): Note[] {
	const notes: Note[] = [...stepEntry.enteredNotes];
	const remaining = getRemainingCapacity();
	if (compareFractions(remaining, [0, 1]) > 0) {
		notes.push({ pitch: null, duration: remaining, offset: getCurrentCursorOffset() });
	}
	return notes;
}

export function getCurrentPhrase(): Phrase {
	// stepEntry.phraseKey is what the user selected in the dropdown — the WRITTEN
	// key for their instrument. The rest of the app (notation, playback, scoring)
	// expects phrase.key in CONCERT pitch, so convert here.
	const concertKey = writtenKeyToConcert(stepEntry.phraseKey, getInstrument());
	return {
		id: '',
		name: stepEntry.phraseName || 'Untitled',
		timeSignature: [4, 4],
		key: concertKey,
		notes: [...stepEntry.enteredNotes],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: stepEntry.barCount },
		category: stepEntry.category,
		tags: stepEntry.practiceTag ? ['user-entered', 'practice'] : ['user-entered'],
		source: 'user-entered'
	};
}

/**
 * Pick the octave that places `pitchClass` closest to `referenceMidi`,
 * preferring candidates within the lick entry range.
 */
function nearestOctave(pitchClass: number, referenceMidi: number): number {
	const refOctave = Math.floor(referenceMidi / 12) - 1;
	const candidates: { midi: number; dist: number }[] = [];
	for (const delta of [-1, 0, 1]) {
		const midi = pitchClassToMidi(pitchClass, refOctave + delta);
		candidates.push({ midi, dist: Math.abs(midi - referenceMidi) });
	}
	candidates.sort((a, b) => a.dist - b.dist);

	const inRange = candidates.find(c => isInEntryRange(c.midi));
	return inRange ? inRange.midi : candidates[0].midi;
}

export function addNote(
	pitchClass: number, octave: number,
	accidental: 'sharp' | 'flat' | 'natural'
): boolean {
	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode);
	if (!canAddDuration(duration)) return false;

	// When no explicit accidental is set, apply the key signature.
	// The user types note letters as they appear on their sheet music,
	// so these adjustments happen in written-pitch space.
	const adjustedPc = accidental === 'natural'
		? applyKeySig(pitchClass, stepEntry.phraseKey)
		: applyAccidental(pitchClass, accidental);

	const trans = getInstrument().transpositionSemitones;

	// Find the last pitched note as a reference. Stored notes are in concert
	// pitch, so convert to written space for nearest-octave comparison.
	let writtenMidi: number;
	const lastPitched = findLastPitchedNote();
	if (lastPitched !== null) {
		const lastWritten = lastPitched + trans;
		writtenMidi = nearestOctave(adjustedPc, lastWritten);
	} else {
		writtenMidi = pitchClassToMidi(adjustedPc, octave);
	}

	if (!isInEntryRange(writtenMidi)) return false;

	// Convert written → concert for canonical storage.
	const concertMidi = writtenMidi - trans;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: concertMidi,
		duration,
		offset
	});
	stepEntry.accidental = 'natural';
	return true;
}

function findLastPitchedNote(): number | null {
	for (let i = stepEntry.enteredNotes.length - 1; i >= 0; i--) {
		if (stepEntry.enteredNotes[i].pitch !== null) {
			return stepEntry.enteredNotes[i].pitch;
		}
	}
	return null;
}

export function addRest(): boolean {
	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode);
	if (!canAddDuration(duration)) return false;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: null,
		duration,
		offset
	});
	return true;
}

export function deleteLastNote(): void {
	stepEntry.enteredNotes.pop();
}

export function reset(): void {
	stepEntry.enteredNotes = [];
	stepEntry.phraseName = '';
	stepEntry.accidental = 'natural';
	stepEntry.category = 'user';
	stepEntry.practiceTag = false;
}

export function adjustLastNotePitch(semitones: number): void {
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return;
	const lastNote = notes[notes.length - 1];
	if (lastNote.pitch === null) return;
	const newConcert = lastNote.pitch + semitones;
	// Validate in written space — that's the user's mental range
	const trans = getInstrument().transpositionSemitones;
	if (!isInEntryRange(newConcert + trans)) return;
	lastNote.pitch = newConcert;
}

export function setBarCount(n: number): void {
	stepEntry.barCount = Math.max(1, Math.min(4, n));
	const maxCapacity = getMaxCapacity();
	while (stepEntry.enteredNotes.length > 0) {
		const last = stepEntry.enteredNotes[stepEntry.enteredNotes.length - 1];
		if (compareFractions(addFractions(last.offset, last.duration), maxCapacity) > 0) {
			stepEntry.enteredNotes.pop();
		} else {
			break;
		}
	}
}

export function setDuration(id: BaseDurationId): void {
	stepEntry.currentDuration = id;
}

export function toggleTriplet(): void {
	stepEntry.tripletMode = !stepEntry.tripletMode;
}

export function setAccidental(acc: 'sharp' | 'flat' | 'natural'): void {
	stepEntry.accidental = stepEntry.accidental === acc ? 'natural' : acc;
}

export function adjustOctave(delta: number): void {
	stepEntry.selectedOctave = Math.max(1, Math.min(8, stepEntry.selectedOctave + delta));
}
