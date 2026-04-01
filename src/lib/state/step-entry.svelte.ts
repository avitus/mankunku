import type { Note, Fraction, PitchClass, Phrase } from '$lib/types/music';
import type { BaseDurationId } from '$lib/step-entry/durations';
import { getDurationFraction } from '$lib/step-entry/durations';
import { addFractions, compareFractions, subtractFractions, fractionToFloat, pitchClassToMidi } from '$lib/music/intervals';
import { applyAccidental } from '$lib/step-entry/pitch-input';

/** Concert pitch range for lick entry: Bb3 to F6 */
const ENTRY_RANGE_LOW = 58;  // Bb below middle C
const ENTRY_RANGE_HIGH = 89; // F6, one octave above the top staff line

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
	phraseName: ''
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

export function getCurrentPhrase(): Phrase {
	return {
		id: '',
		name: stepEntry.phraseName || 'Untitled',
		timeSignature: [4, 4],
		key: stepEntry.phraseKey,
		notes: [...stepEntry.enteredNotes],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: stepEntry.barCount },
		category: 'user',
		tags: ['user-entered'],
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

	// When no explicit accidental is set, apply the key signature
	const adjustedPc = accidental === 'natural'
		? applyKeySig(pitchClass, stepEntry.phraseKey)
		: applyAccidental(pitchClass, accidental);

	// Find the last pitched note to use as reference for nearest-octave placement
	let concertMidi: number;
	const lastPitched = findLastPitchedNote();
	if (lastPitched !== null) {
		concertMidi = nearestOctave(adjustedPc, lastPitched);
	} else {
		concertMidi = pitchClassToMidi(adjustedPc, octave);
	}

	if (!isInEntryRange(concertMidi)) return false;

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
}

export function adjustLastNotePitch(semitones: number): void {
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return;
	const lastNote = notes[notes.length - 1];
	if (lastNote.pitch === null) return;
	const newPitch = lastNote.pitch + semitones;
	if (!isInEntryRange(newPitch)) return;
	lastNote.pitch = newPitch;
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
