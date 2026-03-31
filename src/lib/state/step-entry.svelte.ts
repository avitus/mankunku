import type { Note, Fraction, PitchClass, Phrase } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { BaseDurationId } from '$lib/step-entry/durations';
import { getDurationFraction } from '$lib/step-entry/durations';
import { addFractions, compareFractions, subtractFractions, fractionToFloat } from '$lib/music/intervals';
import { buildMidiFromInput, applyAccidental, isInInstrumentRange } from '$lib/step-entry/pitch-input';

export const stepEntry = $state({
	currentDuration: 'quarter' as BaseDurationId,
	tripletMode: false,
	selectedOctave: 4,
	accidental: 'natural' as 'sharp' | 'flat' | 'natural',
	enteredNotes: [] as Note[],
	barCount: 2,
	keyMode: 'concert' as 'concert' | 'written',
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

export function addNote(
	pitchClass: number, octave: number,
	accidental: 'sharp' | 'flat' | 'natural',
	keyMode: 'concert' | 'written',
	instrument: InstrumentConfig
): boolean {
	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode);
	if (!canAddDuration(duration)) return false;

	const adjustedPc = applyAccidental(pitchClass, accidental);
	const concertMidi = buildMidiFromInput(adjustedPc, octave, keyMode, instrument);

	if (!isInInstrumentRange(concertMidi, instrument)) return false;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: concertMidi,
		duration,
		offset
	});
	stepEntry.accidental = 'natural';
	return true;
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

export function setBarCount(n: number): void {
	stepEntry.barCount = Math.max(1, Math.min(4, n));
}

export function setKeyMode(mode: 'concert' | 'written'): void {
	stepEntry.keyMode = mode;
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
