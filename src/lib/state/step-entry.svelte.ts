import type { Note, Fraction, PitchClass, Phrase, PhraseCategory } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { BaseDurationId } from '$lib/step-entry/durations';
import { getDurationFraction } from '$lib/step-entry/durations';
import { addFractions, compareFractions, subtractFractions, fractionToFloat, pitchClassToMidi } from '$lib/music/intervals';
import { applyAccidental } from '$lib/step-entry/pitch-input';
import { concertKeyToWritten, transposePitchClass } from '$lib/music/transposition';
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
	'F#': { F: 1, C: 1, G: 1, D: 1, A: 1, E: 1 },
	'F': { B: -1 },
	'Bb': { B: -1, E: -1 },
	'Eb': { B: -1, E: -1, A: -1 },
	'Ab': { B: -1, E: -1, A: -1, D: -1 },
	'Db': { B: -1, E: -1, A: -1, D: -1, G: -1 },
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
	currentDuration: 'eighth' as BaseDurationId,
	tripletMode: false,
	dottedMode: false,
	selectedOctave: 4,
	accidental: 'natural' as 'sharp' | 'flat' | 'natural',
	enteredNotes: [] as Note[],
	barCount: 2,
	phraseKey: 'C' as PitchClass,
	phraseName: '',
	category: 'user' as PhraseCategory,
	practiceTag: false,
	// Index into `enteredNotes` of the user-selected pitched note. The selected
	// note is the target of ↑/↓ pitch shift, Backspace delete, and `\` spell
	// flip. `null` means "no explicit selection" — those operations fall back
	// to the last pitched note (the historical last-note behavior).
	selectedNoteIndex: null as number | null,
	// When non-null, the page is editing an existing lick rather than creating
	// a new one. The save path replaces the lick at this id and preserves the
	// snapshot of source/tags/category captured when the lick was loaded.
	editingId: null as string | null,
	editingSource: null as string | null,
	editingTags: null as string[] | null,
	editingCategory: null as PhraseCategory | null,
	// When non-null, typed pitches are interpreted as written for a SOURCE
	// chart with this transposition instead of the user's instrument — set by
	// the lead-sheet editor's "chart written for" selector (0 = concert
	// book). null = follow the instrument, the lick-entry behavior.
	transpositionOverride: null as number | null
});

/** Written-above-concert semitones the entry surface currently assumes. */
function entryTransposition(): number {
	return stepEntry.transpositionOverride ?? getInstrument().transpositionSemitones;
}

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
	// key for the entry surface. The rest of the app (notation, playback,
	// scoring) expects phrase.key in CONCERT pitch, so convert here.
	const concertKey = transposePitchClass(stepEntry.phraseKey, -entryTransposition());
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
	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode);
	if (!canAddDuration(duration)) return false;

	// When no explicit accidental is set, apply the key signature.
	// The user types note letters as they appear on their sheet music,
	// so these adjustments happen in written-pitch space.
	const adjustedPc = accidental === 'natural'
		? applyKeySig(pitchClass, stepEntry.phraseKey)
		: applyAccidental(pitchClass, accidental);

	const trans = entryTransposition();

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
	stepEntry.selectedNoteIndex = stepEntry.enteredNotes.length - 1;
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
	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode);
	if (!canAddDuration(duration)) return false;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: null,
		duration,
		offset
	});
	return true;
}

/**
 * Resolve which note any "selected-note" operation should act on.
 * Returns the explicit selection when it points at a valid pitched note,
 * otherwise falls back to the last pitched note (the legacy behavior
 * preserved by aliases like `deleteLastNote`). Returns `null` if there
 * is nothing pitched in the phrase.
 */
function resolveTargetNoteIndex(): number | null {
	const notes = stepEntry.enteredNotes;
	const sel = stepEntry.selectedNoteIndex;
	if (sel !== null && sel >= 0 && sel < notes.length && notes[sel].pitch !== null) {
		return sel;
	}
	for (let i = notes.length - 1; i >= 0; i--) {
		if (notes[i].pitch !== null) return i;
	}
	return null;
}

/** Set the selected note. Pass `null` to clear; non-pitched indices are ignored. */
export function selectNote(index: number | null): void {
	if (index === null) {
		stepEntry.selectedNoteIndex = null;
		return;
	}
	const notes = stepEntry.enteredNotes;
	if (index < 0 || index >= notes.length || notes[index].pitch === null) return;
	stepEntry.selectedNoteIndex = index;
}

/** Step selection to the previous pitched note (skipping rests). No-op at the start. */
export function selectPrev(): void {
	const notes = stepEntry.enteredNotes;
	const start = stepEntry.selectedNoteIndex !== null
		? stepEntry.selectedNoteIndex - 1
		: notes.length - 1;
	for (let i = start; i >= 0; i--) {
		if (notes[i].pitch !== null) {
			stepEntry.selectedNoteIndex = i;
			return;
		}
	}
}

/** Step selection to the next pitched note (skipping rests). No-op at the end. */
export function selectNext(): void {
	const notes = stepEntry.enteredNotes;
	const start = stepEntry.selectedNoteIndex !== null
		? stepEntry.selectedNoteIndex + 1
		: 0;
	for (let i = start; i < notes.length; i++) {
		if (notes[i].pitch !== null) {
			stepEntry.selectedNoteIndex = i;
			return;
		}
	}
}

/**
 * Remove the selected note (or the last pitched note if no explicit selection).
 * Shifts subsequent offsets left by the deleted duration, repairs any tie that
 * straddled the deletion, and advances selection to a neighboring pitched note
 * unless the deletion was from the end (in which case selection clears so the
 * append-cursor flow resumes).
 */
export function deleteSelectedNote(): void {
	const notes = stepEntry.enteredNotes;
	const target = resolveTargetNoteIndex();
	if (target === null) return;

	const wasAtEnd = target === notes.length - 1;
	const deletedDuration = notes[target].duration;

	for (let i = target + 1; i < notes.length; i++) {
		notes[i].offset = subtractFractions(notes[i].offset, deletedDuration);
	}
	notes.splice(target, 1);

	// Repair any tie that pointed into the deleted note.
	if (target > 0) {
		const prev = notes[target - 1];
		if (prev.tied) {
			const newNext = notes[target];
			if (!newNext || newNext.pitch !== prev.pitch) {
				prev.tied = false;
			}
		}
	}

	if (wasAtEnd) {
		stepEntry.selectedNoteIndex = null;
		return;
	}

	let newSelection: number | null = null;
	for (let i = target - 1; i >= 0; i--) {
		if (notes[i].pitch !== null) { newSelection = i; break; }
	}
	if (newSelection === null) {
		for (let i = target; i < notes.length; i++) {
			if (notes[i].pitch !== null) { newSelection = i; break; }
		}
	}
	stepEntry.selectedNoteIndex = newSelection;
}

/** Backward-compat alias — delegates to `deleteSelectedNote`. */
export const deleteLastNote = deleteSelectedNote;

/**
 * MuseScore-style tie: mark the previous note as tied and append a duplicate
 * at the same pitch with the currently-selected duration. No-op if the last
 * note is missing or is a rest.
 */
export function enterTiedNote(): boolean {
	const lastNote = stepEntry.enteredNotes.at(-1);
	if (!lastNote || lastNote.pitch === null) return false;

	const duration = getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode);
	if (!canAddDuration(duration)) return false;

	lastNote.tied = true;
	stepEntry.enteredNotes.push({
		pitch: lastNote.pitch,
		duration,
		offset: getCurrentCursorOffset(),
		spelling: lastNote.spelling
	});
	stepEntry.selectedNoteIndex = stepEntry.enteredNotes.length - 1;
	return true;
}

export function reset(): void {
	stepEntry.enteredNotes = [];
	stepEntry.phraseName = '';
	stepEntry.accidental = 'natural';
	stepEntry.category = 'user';
	stepEntry.practiceTag = false;
	stepEntry.selectedNoteIndex = null;
	stepEntry.editingId = null;
	stepEntry.editingSource = null;
	stepEntry.editingTags = null;
	stepEntry.editingCategory = null;
	stepEntry.transpositionOverride = null;
}

/**
 * Hydrate the step-entry state from an existing lick so the user can edit it.
 *
 * Notes are stored in concert pitch — the entry state holds them in concert too,
 * so they're copied straight across. The `phraseKey` dropdown is in WRITTEN
 * pitch, so the lick's concert key is converted back via `concertKeyToWritten`.
 *
 * Caller is responsible for setting `stepEntry.practiceTag` separately (it lives
 * in `lick-practice-store`, not on the lick itself).
 */
export function loadFromPhrase(lick: Phrase, instrument: InstrumentConfig): void {
	reset();
	stepEntry.enteredNotes = lick.notes.map((n) => ({ ...n }));
	stepEntry.phraseKey = concertKeyToWritten(lick.key, instrument);
	stepEntry.phraseName = lick.name;
	stepEntry.category = lick.category;
	stepEntry.barCount = Math.max(1, Math.min(4, lick.difficulty.lengthBars));
	stepEntry.editingId = lick.id;
	stepEntry.editingSource = lick.source;
	stepEntry.editingTags = [...lick.tags];
	stepEntry.editingCategory = lick.category;
}

/**
 * Shift the selected note (or the last pitched note if no explicit selection)
 * by `semitones` in concert pitch. Validated against the written-pitch entry
 * range. Clears any tie that would no longer connect notes of the same pitch.
 */
export function adjustSelectedNotePitch(semitones: number): void {
	const notes = stepEntry.enteredNotes;
	const target = resolveTargetNoteIndex();
	if (target === null) return;
	const note = notes[target];
	if (note.pitch === null) return;
	const newConcert = note.pitch + semitones;
	// Validate in written space — that's the user's mental range
	const trans = entryTransposition();
	if (!isInEntryRange(newConcert + trans)) return;
	// Break ties whose endpoints would no longer share a pitch.
	if (target > 0) {
		const previous = notes[target - 1];
		if (previous.tied && previous.pitch !== newConcert) {
			previous.tied = false;
		}
	}
	if (note.tied && target + 1 < notes.length) {
		const next = notes[target + 1];
		if (next.pitch !== newConcert) note.tied = false;
	}
	note.pitch = newConcert;
}

/** Backward-compat alias — delegates to `adjustSelectedNotePitch`. */
export const adjustLastNotePitch = adjustSelectedNotePitch;

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
	if (
		stepEntry.selectedNoteIndex !== null &&
		stepEntry.selectedNoteIndex >= stepEntry.enteredNotes.length
	) {
		stepEntry.selectedNoteIndex = null;
	}
}

export function setDuration(id: BaseDurationId): void {
	stepEntry.currentDuration = id;
}

export function toggleTriplet(): void {
	stepEntry.tripletMode = !stepEntry.tripletMode;
	if (stepEntry.tripletMode) stepEntry.dottedMode = false;
}

export function toggleDotted(): void {
	stepEntry.dottedMode = !stepEntry.dottedMode;
	if (stepEntry.dottedMode) stepEntry.tripletMode = false;
}

export function setAccidental(acc: 'sharp' | 'flat' | 'natural'): void {
	stepEntry.accidental = stepEntry.accidental === acc ? 'natural' : acc;
}

export function adjustOctave(delta: number): void {
	stepEntry.selectedOctave = Math.max(1, Math.min(8, stepEntry.selectedOctave + delta));
}

/** Chromatic pitch classes that have enharmonic equivalents (black keys) */
const CHROMATIC_PCS = new Set([1, 3, 6, 8, 10]);

/** Keys that conventionally use flats */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db']);

/** Toggle the enharmonic spelling of the selected note (or last pitched note). */
export function flipSelectedNoteSpelling(): void {
	const notes = stepEntry.enteredNotes;
	const target = resolveTargetNoteIndex();
	if (target === null) return;
	const note = notes[target];
	if (note.pitch === null) return;

	const trans = entryTransposition();
	const writtenPc = (((note.pitch + trans) % 12) + 12) % 12;
	if (!CHROMATIC_PCS.has(writtenPc)) return;

	if (note.spelling) {
		note.spelling = note.spelling === 'sharp' ? 'flat' : 'sharp';
	} else {
		note.spelling = FLAT_KEYS.has(stepEntry.phraseKey) ? 'sharp' : 'flat';
	}
}

/** Backward-compat alias — delegates to `flipSelectedNoteSpelling`. */
export const flipLastNoteSpelling = flipSelectedNoteSpelling;
