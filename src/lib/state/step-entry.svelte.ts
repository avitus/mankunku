import type { Note, Fraction, PitchClass, Phrase, PhraseCategory, Mode } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';
import type { BaseDurationId, DurationId } from '$lib/step-entry/durations';
import { DOTTED_BASES, DURATIONS, TRIPLET_BASES, getDurationFraction } from '$lib/step-entry/durations';
import { addFractions, compareFractions, subtractFractions, fractionToFloat, pitchClassToMidi } from '$lib/music/intervals';
import { applyAccidental } from '$lib/step-entry/pitch-input';
import { coalesceRests, insertElement, removeTime, replaceWithRest, spliceElement, stripTrailingRests } from '$lib/step-entry/buffer-ops';
import { concertKeyToWritten, transposePitchClass } from '$lib/music/transposition';
import { relativeMajor, relativeMinor } from '$lib/music/keys';
import { signatureAccidentalsFor, signatureFlatsFor } from '$lib/music/notation';
import { lickMode, MINOR_CATEGORIES } from '$lib/music/mode';
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

/**
 * Apply the drawn key signature to a natural pitch class (F→F# in G major,
 * B→Bb in D MINOR). The signature comes from the same table the notation
 * draws (`signatureAccidentalsFor`), so what the user types is what the
 * staff shows — in minor, the relative major's accidentals (six flats for
 * Eb minor), never the tonic's major signature.
 */
function applyKeySig(pitchClass: number, key: PitchClass, mode: Mode): number {
	const letter = PC_TO_LETTER[pitchClass];
	if (!letter) return pitchClass;
	const acc = signatureAccidentalsFor(key, mode)[letter as keyof ReturnType<typeof signatureAccidentalsFor>];
	const delta = acc === '^' ? 1 : acc === '_' ? -1 : 0;
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
	/** Major or minor reading of `phraseKey`. Follows the category until the user touches the mode control. */
	phraseMode: 'major' as Mode,
	modeTouched: false,
	phraseName: '',
	category: 'user' as PhraseCategory,
	practiceTag: false,
	// Index into `enteredNotes` of the user-selected element — note OR rest.
	// The selection is the target of Backspace delete (any element) and of
	// ↑/↓ pitch shift and `\` spell flip (pitched notes only; those are hard
	// no-ops on a selected rest). `null` means "no explicit selection" —
	// delete then falls back to the last element, pitch ops to the last
	// pitched note (the historical last-note behavior).
	selectedNoteIndex: null as number | null,
	// What the selection MEANS (2026-10-15): `entry` — the just-entered
	// element, where letters, `0`, `+` and the duration keys keep their entry
	// meaning; `edit` — a click or arrow landed here, and those keys act ON
	// the element (re-pitch, rest, resize, tie). Esc and any entry return to
	// `entry`. Selecting in `edit` syncs the current duration to the element.
	selectionMode: 'entry' as 'entry' | 'edit',
	// MuseScore's Insert note input (phase 4, 2026-10-16): while on, a letter
	// or `0` at an edit selection goes IN FRONT of the selected element and
	// pushes everything from there on later, instead of replacing it. `I`
	// toggles it; `reset` turns it off.
	insertMode: false,
	// Range selection (phase 5, 2026-10-16): when non-null, the selection runs
	// from the anchor `selectedNoteIndex` to this index inclusive, either way
	// round (Shift+←/→, Shift+click). Any single select clears it.
	selectionEnd: null as number | null,
	/** Something has been copied (Ctrl/⌘+C or R), so paste is live. */
	hasClipboard: false,
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

/**
 * Build the Phrase the editor would save from the current entry state. The id is
 * blank (assigned on save), the mode is always stated, and the source and tags
 * follow whether a user-recorded lick is being edited.
 */
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
		// Always stated for user licks — explicit beats inference; legacy rows stay unstated.
		mode: stepEntry.phraseMode,
		notes: [...stepEntry.enteredNotes],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: stepEntry.barCount },
		category: stepEntry.category,
		tags: [...(stepEntry.editingSource === 'user-recorded' ? ['user-recorded'] : ['user-entered']), ...(stepEntry.practiceTag ? ['practice'] : [])],
		source: stepEntry.editingSource === 'user-recorded' ? 'user-recorded' : 'user-entered'
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

/**
 * Resolve a typed pitch letter to a CONCERT midi value using the current
 * entry surface state (phraseKey key signature, transpositionOverride /
 * instrument transposition), with nearest-octave placement relative to
 * referenceConcertPitch (null = use the typed octave literally) and
 * written-range validation. Returns null when out of range.
 * Pure with respect to enteredNotes — reads stepEntry config, never mutates.
 */
export function resolveEntryPitch(
	pitchClass: number,
	octave: number,
	accidental: 'sharp' | 'flat' | 'natural',
	referenceConcertPitch: number | null
): number | null {
	// When no explicit accidental is set, apply the key signature.
	// The user types note letters as they appear on their sheet music,
	// so these adjustments happen in written-pitch space.
	const adjustedPc = accidental === 'natural'
		? applyKeySig(pitchClass, stepEntry.phraseKey, stepEntry.phraseMode)
		: applyAccidental(pitchClass, accidental);

	const trans = entryTransposition();

	// The reference is in concert pitch (as stored notes are), so convert to
	// written space for nearest-octave comparison.
	let writtenMidi: number;
	if (referenceConcertPitch !== null) {
		const referenceWritten = referenceConcertPitch + trans;
		writtenMidi = nearestOctave(adjustedPc, referenceWritten);
	} else {
		writtenMidi = pitchClassToMidi(adjustedPc, octave);
	}

	if (!isInEntryRange(writtenMidi)) return null;

	// Convert written → concert for canonical storage.
	return writtenMidi - trans;
}

/**
 * Enter a note of the current duration: appended at the entry edge — or, on an
 * edit selection, replacing the selected element (in insert mode, written in
 * front of it). False when it would not fit or the pitch is out of range.
 */
export function addNote(
	pitchClass: number, octave: number,
	accidental: 'sharp' | 'flat' | 'natural'
): boolean {
	if (isEditSelection()) {
		return stepEntry.insertMode
			? insertBeforeSelected(pitchClass, octave, accidental)
			: replaceSelectedWithNote(pitchClass, octave, accidental);
	}
	const duration = currentDurationFraction();
	if (!canAddDuration(duration)) return false;

	// Find the last pitched note as the octave-placement reference.
	const concertMidi = resolveEntryPitch(pitchClass, octave, accidental, findLastPitchedNote());
	if (concertMidi === null) return false;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: concertMidi,
		duration,
		offset
	});
	markEntered(stepEntry.enteredNotes.length - 1);
	stepEntry.accidental = 'natural';
	return true;
}

/** The duration armed on the entry surface, modifiers resolved. */
function currentDurationFraction(): Fraction {
	return getDurationFraction(stepEntry.currentDuration, stepEntry.tripletMode, stepEntry.dottedMode);
}

/** MuseScore's Insert toggle (`I`): letters and `0` at an edit selection insert and push instead of replacing. */
export function toggleInsertMode(): void {
	stepEntry.insertMode = !stepEntry.insertMode;
}

/**
 * Insert mode: a note of the current duration goes in front of the selected
 * element and everything from there on moves later (`insertElement`); the
 * pushed element stays selected, so a run of letters inserts a passage in
 * order. Octave placement follows the nearest pitched note before the
 * insertion point. Refused, with nothing changed, when the push would run
 * past the end of the bars.
 */
function insertBeforeSelected(
	pitchClass: number,
	octave: number,
	accidental: 'sharp' | 'flat' | 'natural'
): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const duration = currentDurationFraction();
	if (!canAddDuration(duration)) return false;
	const concert = resolveEntryPitch(pitchClass, octave, accidental, previousPitched(index) ?? notes[index].pitch);
	if (concert === null) return false;
	const { notes: out, index: at } = insertElement(notes, { pitch: concert, duration, offset: notes[index].offset });
	stepEntry.enteredNotes = out;
	stepEntry.accidental = 'natural';
	selectNote(at + 1, 'edit');
	return true;
}

/** Insert mode's `0`: a rest of the current duration in front of the selected element, the rest pushed later. */
function insertRestBeforeSelected(): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const duration = currentDurationFraction();
	if (!canAddDuration(duration)) return false;
	const { notes: out, index: at } = insertElement(notes, { pitch: null, duration, offset: notes[index].offset });
	stepEntry.enteredNotes = out;
	selectNote(at + 1, 'edit');
	return true;
}

/** True when a click or arrow selected the element (edit intent) and it still exists. */
export function isEditSelection(): boolean {
	const sel = stepEntry.selectedNoteIndex;
	return stepEntry.selectionMode === 'edit' && sel !== null && sel >= 0 && sel < stepEntry.enteredNotes.length;
}

/** Select a just-entered element: the entry edge, where keys keep their entry meaning. */
export function markEntered(index: number): void {
	stepEntry.selectedNoteIndex = index;
	stepEntry.selectionMode = 'entry';
	stepEntry.selectionEnd = null;
}

/** Select the element after `index` for the next in-place edit, or clear the selection past the end. */
function selectFollowing(index: number): void {
	if (index + 1 < stepEntry.enteredNotes.length) selectNote(index + 1, 'edit');
	else selectNote(null);
}

/** The nearest pitched element before `index`, as an octave reference. */
function previousPitched(index: number): number | null {
	for (let i = index - 1; i >= 0; i--) {
		const pitch = stepEntry.enteredNotes[i].pitch;
		if (pitch !== null) return pitch;
	}
	return null;
}

/**
 * Letters on an edit selection re-pitch in place: the selected element is
 * replaced by a note of the current duration at its own offset, the new
 * pitch placed in the octave nearest the note it replaces (else the nearest
 * pitched note before it), and the selection moves to the following element
 * so a chain of letters re-pitches a line and keeps its rhythm. Refused,
 * with nothing changed, when the note would run past the end of the bars.
 */
function replaceSelectedWithNote(
	pitchClass: number,
	octave: number,
	accidental: 'sharp' | 'flat' | 'natural'
): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const target = notes[index];
	const duration = currentDurationFraction();
	if (compareFractions(addFractions(target.offset, duration), getMaxCapacity()) > 0) return false;
	const reference = target.pitch ?? previousPitched(index);
	const concert = resolveEntryPitch(pitchClass, octave, accidental, reference);
	if (concert === null) return false;
	const { notes: out, index: at } = spliceElement(notes, { pitch: concert, duration, offset: target.offset });
	stepEntry.enteredNotes = out;
	stepEntry.accidental = 'natural';
	selectFollowing(at);
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

/** Enter a rest of the current duration: appended, or on an edit selection replacing (insert mode: written in front of) the selected element. */
export function addRest(): boolean {
	if (isEditSelection()) return stepEntry.insertMode ? insertRestBeforeSelected() : replaceSelectedWithRest();
	const duration = currentDurationFraction();
	if (!canAddDuration(duration)) return false;

	const offset = getCurrentCursorOffset();
	stepEntry.enteredNotes.push({
		pitch: null,
		duration,
		offset
	});
	markEntered(stepEntry.enteredNotes.length - 1);
	return true;
}

/**
 * `0` on an edit selection rests the element: a rest of the current duration
 * replaces it at its own offset, preserving its boundary with adjacent rests, and
 * the selection moves on. Refused past the end of the bars.
 */
function replaceSelectedWithRest(): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const target = notes[index];
	const duration = currentDurationFraction();
	if (compareFractions(addFractions(target.offset, duration), getMaxCapacity()) > 0) return false;
	const spliced = spliceElement(notes, { pitch: null, duration, offset: target.offset });
	stepEntry.enteredNotes = spliced.notes;
	selectFollowing(spliced.index);
	return true;
}

/**
 * Resolve which element a DELETE should act on. Any element — note or rest —
 * is a valid explicit selection; with no selection, fall back to the last
 * element of any kind (so Backspace in the append flow always removes what
 * was entered last, rests included). Returns `null` on an empty phrase.
 */
function resolveDeleteTargetIndex(): number | null {
	const notes = stepEntry.enteredNotes;
	const sel = stepEntry.selectedNoteIndex;
	if (sel !== null && sel >= 0 && sel < notes.length) {
		return sel;
	}
	return notes.length > 0 ? notes.length - 1 : null;
}

/**
 * Resolve which note a PITCH operation (↑/↓ shift, spelling flip) should act
 * on. A selected rest is a hard no-op — never silently retarget a different
 * note than the one highlighted. With no selection, fall back to the last
 * pitched note (the legacy behavior preserved by aliases like
 * `adjustLastNotePitch`). Returns `null` if there is nothing to act on.
 */
function resolvePitchedTargetIndex(): number | null {
	const notes = stepEntry.enteredNotes;
	const sel = stepEntry.selectedNoteIndex;
	if (sel !== null && sel >= 0 && sel < notes.length) {
		return notes[sel].pitch !== null ? sel : null;
	}
	for (let i = notes.length - 1; i >= 0; i--) {
		if (notes[i].pitch !== null) return i;
	}
	return null;
}

/**
 * Set the selected element — note or rest. Pass `null` to clear (back to
 * entry); out-of-range indices are ignored. The default intent is `edit` (a
 * click or arrow landed here), which also syncs the current duration to the
 * element — MuseScore's toolbar follows the selection — so the next typed
 * letter keeps its length. `markEntered` is the entry-edge counterpart.
 */
export function selectNote(index: number | null, mode: 'edit' | 'entry' = 'edit'): void {
	stepEntry.selectionEnd = null;
	if (index === null) {
		stepEntry.selectedNoteIndex = null;
		stepEntry.selectionMode = 'entry';
		return;
	}
	const notes = stepEntry.enteredNotes;
	if (index < 0 || index >= notes.length) return;
	stepEntry.selectedNoteIndex = index;
	stepEntry.selectionMode = mode;
	// Insert mode is note input: the armed duration is the user's choice for
	// the NEXT note, so landing on the pushed element must not overwrite it
	// (CodeRabbit on PR #278 — a run of inserts took the pushed note's length).
	if (mode === 'edit' && !stepEntry.insertMode) syncDurationTo(notes[index]);
}

/** The inclusive range the selection covers, sorted; null for a single (or no) selection. */
export function rangeBounds(): { start: number; end: number } | null {
	const anchor = stepEntry.selectedNoteIndex;
	const end = stepEntry.selectionEnd;
	if (anchor === null || end === null || end === anchor) return null;
	return { start: Math.min(anchor, end), end: Math.max(anchor, end) };
}

/**
 * Shift+←/→: grow (or shrink, past the anchor) the range one element at a
 * time, clamped to the buffer. With no selection, start one at the first or
 * last element. Always edit intent.
 */
export function extendSelection(direction: 1 | -1): void {
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return;
	if (stepEntry.selectedNoteIndex === null) {
		selectNote(direction > 0 ? 0 : notes.length - 1, 'edit');
	}
	const anchor = stepEntry.selectedNoteIndex as number;
	const current = stepEntry.selectionEnd ?? anchor;
	stepEntry.selectionEnd = Math.max(0, Math.min(notes.length - 1, current + direction));
	stepEntry.selectionMode = 'edit';
}

/** Shift+click: run the range from the anchor to `index`; with no anchor, a plain select. */
export function selectRangeTo(index: number): void {
	const notes = stepEntry.enteredNotes;
	if (index < 0 || index >= notes.length) return;
	if (stepEntry.selectedNoteIndex === null) {
		selectNote(index, 'edit');
		return;
	}
	stepEntry.selectionEnd = index;
	stepEntry.selectionMode = 'edit';
}

/**
 * Point the duration controls at an element's length when the vocabulary
 * names it (whole … sixteenth, their triplet and dotted variants); an
 * unnameable length — an imported 5/16, a merged rest — leaves them alone.
 */
function syncDurationTo(element: Note): void {
	const [num, den] = element.duration;
	for (const [id, [n, d]] of Object.entries(DURATIONS) as [DurationId, Fraction][]) {
		if (num * d !== n * den) continue;
		const [base, modifier] = id.split('-') as [BaseDurationId, string | undefined];
		stepEntry.currentDuration = base;
		stepEntry.tripletMode = modifier === 'triplet';
		stepEntry.dottedMode = modifier === 'dotted';
		return;
	}
}

/** Step selection to the previous element (MuseScore-style: stops on rests). No-op at the start. */
export function selectPrev(): void {
	const notes = stepEntry.enteredNotes;
	const target = stepEntry.selectedNoteIndex !== null
		? stepEntry.selectedNoteIndex - 1
		: notes.length - 1;
	if (target >= 0 && target < notes.length) selectNote(target, 'edit');
}

/** Step selection to the next element (MuseScore-style: stops on rests). No-op at the end. */
export function selectNext(): void {
	const notes = stepEntry.enteredNotes;
	const target = stepEntry.selectedNoteIndex !== null
		? stepEntry.selectedNoteIndex + 1
		: 0;
	if (target >= 0 && target < notes.length) selectNote(target, 'edit');
}

/**
 * Delete the selected element (or the last element with no selection). Two
 * meanings, MuseScore's, since 2026-10-15 (Andy's call): a NOTE before the
 * end becomes a rest of the same span, so a complete score stays on its
 * beats, and the selection stays on that rest — merged with any rest
 * neighbours in its bar, so one engraved rest is one element; a REST removes
 * its time (`removeTime`), and so does the LAST element of either kind,
 * because nothing follows it: that is the append flow, where Backspace
 * removes what was typed last. `removeSelectedTime` is the explicit
 * remove-time gesture (Ctrl/⌘ + Backspace) for any element.
 */
export function deleteSelectedNote(): void {
	const range = rangeBounds();
	if (range) {
		// MuseScore: Del on a range replaces the passage with rests, which the
		// engraving regroups by the meter.
		let out = stepEntry.enteredNotes;
		for (let i = range.start; i <= range.end; i++) {
			if (out[i].pitch !== null) out = replaceWithRest(out, i);
		}
		const { notes: merged, indexMap } = coalesceRests(out);
		stepEntry.enteredNotes = merged;
		selectNote(indexMap[range.start], 'edit');
		return;
	}
	const notes = stepEntry.enteredNotes;
	const target = resolveDeleteTargetIndex();
	if (target === null) return;
	if (target === notes.length - 1 || notes[target].pitch === null) {
		removeElementTime(target);
		return;
	}
	const { notes: merged, indexMap } = coalesceRests(replaceWithRest(notes, target));
	stepEntry.enteredNotes = merged;
	stepEntry.selectedNoteIndex = indexMap[target];
}

/**
 * Remove element `target` and its time (later offsets move earlier, a tie
 * into it is repaired). Selection: cleared when the end was removed so the
 * append-cursor flow resumes; else the element that slid into the slot, in
 * edit intent — the keys act on the selection now, and acting on the note
 * BEFORE the removed one would be the wrong note.
 */
function removeElementTime(target: number): void {
	const notes = stepEntry.enteredNotes;
	const wasAtEnd = target === notes.length - 1;
	stepEntry.enteredNotes = removeTime(notes, target);
	if (wasAtEnd) {
		selectNote(null);
		return;
	}
	selectNote(target, 'edit');
}

/**
 * Remove the selected element — note or rest — AND its time, whatever its
 * kind or position (MuseScore's Ctrl+Del). Falls back to the last element
 * with no selection, like `deleteSelectedNote`.
 */
export function removeSelectedTime(): void {
	const range = rangeBounds();
	if (range) {
		let out = stepEntry.enteredNotes;
		for (let i = range.end; i >= range.start; i--) out = removeTime(out, i);
		stepEntry.enteredNotes = out;
		selectNote(range.start < out.length ? range.start : null, 'edit');
		return;
	}
	const target = resolveDeleteTargetIndex();
	if (target === null) return;
	removeElementTime(target);
}

/** Backward-compat alias — delegates to `deleteSelectedNote`. */
export const deleteLastNote = deleteSelectedNote;

/**
 * MuseScore-style tie: mark the previous note as tied and append a duplicate
 * at the same pitch with the currently-selected duration. No-op if the last
 * note is missing or is a rest.
 */
export function enterTiedNote(): boolean {
	if (isEditSelection()) return tieSelected();
	const lastNote = stepEntry.enteredNotes.at(-1);
	if (!lastNote || lastNote.pitch === null) return false;

	const duration = currentDurationFraction();
	if (!canAddDuration(duration)) return false;

	lastNote.tied = true;
	stepEntry.enteredNotes.push({
		pitch: lastNote.pitch,
		duration,
		offset: getCurrentCursorOffset(),
		spelling: lastNote.spelling
	});
	markEntered(stepEntry.enteredNotes.length - 1);
	return true;
}

/**
 * `+` on an edit selection: when a same-pitch note starts where the selected
 * note ends, toggle the tie between them (MuseScore's T); otherwise write a
 * tied continuation of the current duration over whatever follows and move
 * the selection on. A selected rest is a hard no-op. Refused past the end of
 * the bars.
 */
function tieSelected(): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const target = notes[index];
	if (target.pitch === null) return false;
	const targetEnd = addFractions(target.offset, target.duration);
	const next = notes[index + 1];
	if (next && next.pitch === target.pitch && compareFractions(next.offset, targetEnd) === 0) {
		target.tied = !target.tied;
		return true;
	}
	const duration = currentDurationFraction();
	if (compareFractions(addFractions(targetEnd, duration), getMaxCapacity()) > 0) return false;
	const continuation: Note = { pitch: target.pitch, duration, offset: targetEnd };
	if (target.spelling) continuation.spelling = target.spelling;
	const { notes: out, index: at } = spliceElement(notes, continuation);
	out[at - 1].tied = true;
	stepEntry.enteredNotes = out;
	selectFollowing(at);
	return true;
}

/** Set the major/minor reading of the key. Never moves notes; stops category-follow. */
export function setPhraseMode(mode: Mode): void {
	stepEntry.phraseMode = mode;
	stepEntry.modeTouched = true;
}

/**
 * Set the save category. Until the user has touched the mode control, the
 * mode follows the category — picking "ii-V-I minor" reads the key as minor.
 */
export function setCategory(category: PhraseCategory): void {
	stepEntry.category = category;
	if (!stepEntry.modeTouched) {
		stepEntry.phraseMode = MINOR_CATEGORIES.has(category) ? 'minor' : 'major';
	}
}

/**
 * Relabel the lick as its relative key — F major ↔ D minor — without moving a
 * note. The one-click path for licks that were entered in the relative major
 * because the editor's key signature used to be major-only; the manual route
 * (toggle minor, then change key with "Move notes" OFF) transposes the notes
 * a minor third if the checkbox is forgotten.
 */
export function switchToRelativeKey(): void {
	if (stepEntry.phraseMode === 'minor') {
		stepEntry.phraseKey = relativeMajor(stepEntry.phraseKey);
		stepEntry.phraseMode = 'major';
	} else {
		stepEntry.phraseKey = relativeMinor(stepEntry.phraseKey);
		stepEntry.phraseMode = 'minor';
	}
	stepEntry.modeTouched = true;
}

/** Clear the buffer and every editing field back to a fresh lick — selection, range and insert mode included. */
export function reset(): void {
	stepEntry.enteredNotes = [];
	stepEntry.phraseName = '';
	stepEntry.accidental = 'natural';
	stepEntry.category = 'user';
	stepEntry.phraseMode = 'major';
	stepEntry.modeTouched = false;
	stepEntry.practiceTag = false;
	stepEntry.selectedNoteIndex = null;
	stepEntry.selectionEnd = null;
	stepEntry.selectionMode = 'entry';
	stepEntry.insertMode = false;
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
	// Save writes a trailing pad rest to the end of the bars; drop it (and
	// any trailing rest — trailing silence is implied, save re-pads) so the
	// re-opened buffer has a fresh buffer's shape: the last real note is the
	// entry edge, and typing continues without a Backspace first.
	stepEntry.enteredNotes = stripTrailingRests(lick.notes);
	stepEntry.phraseKey = concertKeyToWritten(lick.key, instrument);
	// An explicitly stored mode survives later category changes; an inferred
	// one keeps following the category until the user touches the control.
	stepEntry.phraseMode = lickMode(lick);
	stepEntry.modeTouched = lick.mode !== undefined;
	stepEntry.phraseName = lick.name;
	stepEntry.category = lick.category;
	stepEntry.barCount = Math.max(1, Math.min(4, lick.difficulty.lengthBars));
	stepEntry.editingId = lick.id;
	stepEntry.editingSource = lick.source;
	stepEntry.editingTags = [...lick.tags];
	stepEntry.editingCategory = lick.category;
}

/** Open an unsaved recording in create mode; no library write until Save. */
export function loadRecordingDraft(phrase: Phrase, instrument: InstrumentConfig): void {
	loadFromPhrase(phrase, instrument);
	stepEntry.editingId = null;
}

/**
 * Shift the selected note (or the last pitched note if no explicit selection)
 * by `semitones` in concert pitch. Validated against the written-pitch entry
 * range. Clears any tie that would no longer connect notes of the same pitch.
 */
export function adjustSelectedNotePitch(semitones: number): void {
	const notes = stepEntry.enteredNotes;
	const range = rangeBounds();
	if (range) {
		// Transpose the passage as one: refused whole if any note would leave
		// the written range; ties between moved notes survive.
		const trans = entryTransposition();
		const pitched = notes.slice(range.start, range.end + 1).filter((n) => n.pitch !== null);
		if (pitched.some((n) => !isInEntryRange((n.pitch as number) + semitones + trans))) return;
		for (const n of pitched) n.pitch = (n.pitch as number) + semitones;
		for (let i = 0; i < notes.length - 1; i++) {
			if (notes[i].tied && notes[i].pitch !== notes[i + 1].pitch) notes[i].tied = false;
		}
		return;
	}
	const target = resolvePitchedTargetIndex();
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

/** Written pitch classes of the drawn key signature's seven letters. */
function diatonicWrittenPitchClasses(): Set<number> {
	const set = new Set<number>();
	for (const pc of Object.keys(PC_TO_LETTER)) {
		set.add(applyKeySig(Number(pc), stepEntry.phraseKey, stepEntry.phraseMode));
	}
	return set;
}

/**
 * Move the selected note (or the last pitched note) one step of the DRAWN
 * key — MuseScore's Alt+Shift+↑/↓: the next higher or lower pitch whose
 * written letter carries the signature's accidental (F major and D minor
 * both step A to Bb), so a chromatic note lands on the key's next letter.
 * Range-checked in written space; a tie the move breaks is cleared; an
 * explicit spelling is dropped, the signature spells the new note.
 */
export function adjustSelectedNoteDiatonic(direction: 1 | -1): void {
	const notes = stepEntry.enteredNotes;
	const trans = entryTransposition();
	const scale = diatonicWrittenPitchClasses();
	/** The next written pitch in `direction` whose letter is in the key. */
	const stepped = (concert: number): number => {
		let written = concert + trans;
		for (let step = 0; step < 12; step++) {
			written += direction;
			if (scale.has(((written % 12) + 12) % 12)) break;
		}
		return written;
	};
	const range = rangeBounds();
	if (range) {
		// Each note takes its OWN step of the key (E→F is a semitone, D→E a
		// tone); refused whole if any would leave the written range. Ties
		// between moved notes survive, others are repaired.
		const pitched = notes.slice(range.start, range.end + 1).filter((n) => n.pitch !== null);
		const moves = pitched.map((n) => ({ note: n, written: stepped(n.pitch as number) }));
		if (moves.some((m) => !isInEntryRange(m.written))) return;
		for (const m of moves) {
			m.note.pitch = m.written - trans;
			delete m.note.spelling;
		}
		for (let i = 0; i < notes.length - 1; i++) {
			if (notes[i].tied && notes[i].pitch !== notes[i + 1].pitch) notes[i].tied = false;
		}
		return;
	}
	const target = resolvePitchedTargetIndex();
	if (target === null) return;
	const note = notes[target];
	if (note.pitch === null) return;
	const written = stepped(note.pitch);
	if (!isInEntryRange(written)) return;
	adjustSelectedNotePitch(written - trans - note.pitch);
	delete note.spelling;
}

/** Bar (whole-note) index of an element's offset. */
function barOf(note: Note): number {
	return Math.floor(fractionToFloat(note.offset) + 1e-9);
}

/**
 * MuseScore's Ctrl+←/→: select the first element of the next bar, or of the
 * previous one — from inside a bar, ← goes to that bar's first element
 * first. With no selection, → starts at the first element and ← at the last
 * bar's first. A step past either end changes nothing.
 */
export function selectBar(direction: 1 | -1): void {
	const notes = stepEntry.enteredNotes;
	if (notes.length === 0) return;
	const sel = stepEntry.selectedNoteIndex;
	let targetBar: number;
	if (sel === null) {
		targetBar = barOf(direction > 0 ? notes[0] : notes[notes.length - 1]);
	} else {
		const currentBar = barOf(notes[sel]);
		const firstOfBar = notes.findIndex((n) => barOf(n) === currentBar);
		targetBar = direction < 0 && firstOfBar !== sel ? currentBar : currentBar + direction;
	}
	const index = notes.findIndex((n) => barOf(n) === targetBar);
	if (index >= 0) selectNote(index, 'edit');
}

/** Home: select the first element (edit intent). */
export function selectFirst(): void {
	if (stepEntry.enteredNotes.length > 0) selectNote(0, 'edit');
}

/** End: select the last element (edit intent). */
export function selectLast(): void {
	const n = stepEntry.enteredNotes.length;
	if (n > 0) selectNote(n - 1, 'edit');
}

// ─── Clipboard (phase 5, 2026-10-16) ─────────────────────────────────────

/** The copied passage, offsets relative to its first element. Module state: both editors share it. */
let clipboard: Note[] | null = null;

/** The selection as an inclusive index range — the range, or the single selected element. */
function selectionSpan(): { start: number; end: number } | null {
	const range = rangeBounds();
	if (range) return range;
	const sel = stepEntry.selectedNoteIndex;
	return sel !== null && sel < stepEntry.enteredNotes.length ? { start: sel, end: sel } : null;
}

/** Elements `start..end` with offsets made relative to the first. */
function clipOf(start: number, end: number): Note[] {
	const notes = stepEntry.enteredNotes;
	const base = notes[start].offset;
	return notes.slice(start, end + 1).map((n) => ({ ...n, offset: subtractFractions(n.offset, base) }));
}

/**
 * Write a clip at `target`, each element overwriting what its span covers
 * (`spliceElement`). Elements that would run past the end of the bars are
 * left out — or, `allOrNothing`, the whole write is refused. Ties into what
 * follows are repaired. The written range is selected. Returns the count
 * written.
 */
function writeClip(clip: Note[], target: Fraction, allOrNothing: boolean): number {
	const capacity = getMaxCapacity();
	const fits = clip.filter((el) => compareFractions(addFractions(addFractions(target, el.offset), el.duration), capacity) <= 0);
	if (fits.length === 0 || (allOrNothing && fits.length < clip.length)) return 0;
	let out = stepEntry.enteredNotes;
	let first = -1;
	let last = -1;
	for (const el of fits) {
		const written = spliceElement(out, { ...el, offset: addFractions(target, el.offset) });
		out = written.notes;
		if (first < 0) first = written.index;
		last = written.index;
	}
	for (let i = 0; i < out.length - 1; i++) {
		if (out[i].tied && (out[i + 1].pitch !== out[i].pitch || compareFractions(out[i + 1].offset, addFractions(out[i].offset, out[i].duration)) !== 0)) out[i].tied = false;
	}
	if (out.length > 0 && out[out.length - 1].tied) out[out.length - 1].tied = false;
	stepEntry.enteredNotes = out;
	stepEntry.selectedNoteIndex = first;
	stepEntry.selectionEnd = last > first ? last : null;
	stepEntry.selectionMode = 'edit';
	return fits.length;
}

/** Forget the copied passage (tests; the clipboard otherwise outlives `reset`, so a lick can be pasted into another, or into a tune). */
export function clearClipboard(): void {
	clipboard = null;
	stepEntry.hasClipboard = false;
}

/** Ctrl/⌘+C: copy the selected passage (the range, or the one selected element). */
export function copySelection(): boolean {
	const span = selectionSpan();
	if (!span) return false;
	clipboard = clipOf(span.start, span.end);
	stepEntry.hasClipboard = true;
	return true;
}

/**
 * Ctrl/⌘+V: paste the copied passage from the selection's start (overwriting,
 * MuseScore-style), or at the end with no edit selection; what would run
 * past the bars is left out. The pasted passage is selected.
 */
export function pasteClipboard(): boolean {
	if (!clipboard || clipboard.length === 0) return false;
	const span = isEditSelection() ? selectionSpan() : null;
	const target = span ? stepEntry.enteredNotes[span.start].offset : getCurrentCursorOffset();
	return writeClip(clipboard, target, false) > 0;
}

/** R: repeat the selected passage right after itself (all of it, or nothing); the copy is selected. */
export function repeatSelection(): boolean {
	const span = selectionSpan();
	if (!span) return false;
	const last = stepEntry.enteredNotes[span.end];
	const target = addFractions(last.offset, last.duration);
	return writeClip(clipOf(span.start, span.end), target, true) > 0;
}

/** Resize the canvas to 1–4 bars, dropping any element that no longer fits and a selection that pointed past the end. */
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
		selectNote(null);
	}
}

/**
 * Choose the duration for the next entered note — or, on an edit selection,
 * RESIZE the selected element to it (MuseScore: a duration key acts on the
 * selected note). Returns false, with nothing changed, when the resize would
 * run past the end of the bars.
 */
export function setDuration(id: BaseDurationId): boolean {
	// Insert mode is note input: the keys choose the NEXT note's length.
	if (isEditSelection() && !stepEntry.insertMode) return resizeSelected(id, stepEntry.tripletMode, stepEntry.dottedMode);
	stepEntry.currentDuration = id;
	return true;
}

/**
 * Resize the selected element to (base, triplet, dotted): shorter leaves a
 * rest for the remainder; longer overwrites what follows, MuseScore-style
 * (`spliceElement`); a tie the new length no longer meets is cleared. The
 * duration controls take the new value and the element stays selected.
 * Refused, with nothing changed, past the end of the bars.
 */
function resizeSelected(base: BaseDurationId, triplet: boolean, dotted: boolean): boolean {
	const notes = stepEntry.enteredNotes;
	const index = stepEntry.selectedNoteIndex as number;
	const target = notes[index];
	const duration = getDurationFraction(base, triplet, dotted);
	if (compareFractions(addFractions(target.offset, duration), getMaxCapacity()) > 0) return false;
	const change = compareFractions(duration, target.duration);
	let out: Note[];
	let at = index;
	if (change < 0) {
		const resized: Note = { ...target, duration };
		const remainder: Note = {
			pitch: null,
			duration: subtractFractions(target.duration, duration),
			offset: addFractions(target.offset, duration)
		};
		out = [...notes.slice(0, index).map((n) => ({ ...n })), resized, remainder, ...notes.slice(index + 1).map((n) => ({ ...n }))];
	} else if (change > 0) {
		({ notes: out, index: at } = spliceElement(notes, { ...target, duration }));
	} else {
		out = notes.map((n) => ({ ...n }));
	}
	const resized = out[at];
	if (resized.tied) {
		const next = out[at + 1];
		const resizedEnd = addFractions(resized.offset, resized.duration);
		if (!next || next.pitch !== resized.pitch || compareFractions(next.offset, resizedEnd) !== 0) resized.tied = false;
	}
	// Keep the requested rest and its remainder separate: coalescing here
	// would undo a rest resize and make the remainder impossible to select.
	stepEntry.enteredNotes = out;
	stepEntry.currentDuration = base;
	stepEntry.tripletMode = triplet;
	stepEntry.dottedMode = dotted;
	stepEntry.selectedNoteIndex = at;
	stepEntry.selectionMode = 'edit';
	return true;
}

/**
 * Turning a modifier ON is refused when the current base has no such variant
 * (no sixteenth triplet, no dotted whole note) — otherwise the keyboard would
 * set a flag the disabled button forbids, and it would silently take effect on
 * the next base that does support it. Turning one OFF is always allowed, so a
 * flag left over from another base can still be cleared.
 */
export function toggleTriplet(): void {
	if (!stepEntry.tripletMode && !TRIPLET_BASES.has(stepEntry.currentDuration)) return;
	const triplet = !stepEntry.tripletMode;
	const dotted = triplet ? false : stepEntry.dottedMode;
	if (isEditSelection() && !stepEntry.insertMode) {
		resizeSelected(stepEntry.currentDuration, triplet, dotted);
		return;
	}
	stepEntry.tripletMode = triplet;
	stepEntry.dottedMode = dotted;
}

/** Toggle the dotted modifier for the next note — or, on an edit selection outside insert mode, resize the selected element. */
export function toggleDotted(): void {
	if (!stepEntry.dottedMode && !DOTTED_BASES.has(stepEntry.currentDuration)) return;
	const dotted = !stepEntry.dottedMode;
	const triplet = dotted ? false : stepEntry.tripletMode;
	if (isEditSelection() && !stepEntry.insertMode) {
		resizeSelected(stepEntry.currentDuration, triplet, dotted);
		return;
	}
	stepEntry.dottedMode = dotted;
	stepEntry.tripletMode = triplet;
}

export function setAccidental(acc: 'sharp' | 'flat' | 'natural'): void {
	stepEntry.accidental = stepEntry.accidental === acc ? 'natural' : acc;
}

export function adjustOctave(delta: number): void {
	stepEntry.selectedOctave = Math.max(1, Math.min(8, stepEntry.selectedOctave + delta));
}

/** Chromatic pitch classes that have enharmonic equivalents (black keys) */
const CHROMATIC_PCS = new Set([1, 3, 6, 8, 10]);

/** Toggle the enharmonic spelling of the selected note (or last pitched note). */
export function flipSelectedNoteSpelling(): void {
	const notes = stepEntry.enteredNotes;
	const target = resolvePitchedTargetIndex();
	if (target === null) return;
	const note = notes[target];
	if (note.pitch === null) return;

	const trans = entryTransposition();
	const writtenPc = (((note.pitch + trans) % 12) + 12) % 12;
	if (!CHROMATIC_PCS.has(writtenPc)) return;

	if (note.spelling) {
		note.spelling = note.spelling === 'sharp' ? 'flat' : 'sharp';
	} else {
		// Default spelling follows the drawn signature (minor → relative major's side).
		note.spelling = signatureFlatsFor(stepEntry.phraseKey, stepEntry.phraseMode) ? 'sharp' : 'flat';
	}
}

/** Backward-compat alias — delegates to `flipSelectedNoteSpelling`. */
export const flipLastNoteSpelling = flipSelectedNoteSpelling;
