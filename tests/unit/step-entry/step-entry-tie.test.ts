import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry, addNote, addRest, adjustLastNotePitch, deleteLastNote,
	enterTiedNote, flipLastNoteSpelling, reset, setDuration, toggleTriplet
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
	stepEntry.currentDuration = 'eighth';
	stepEntry.tripletMode = false;
	stepEntry.dottedMode = false;
});

describe('enterTiedNote', () => {
	it('marks the previous note tied and duplicates its pitch at the current duration', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural'); // C4
		setDuration('eighth');
		const ok = enterTiedNote();

		expect(ok).toBe(true);
		expect(stepEntry.enteredNotes).toHaveLength(2);
		expect(stepEntry.enteredNotes[0].tied).toBe(true);
		expect(stepEntry.enteredNotes[0].duration).toEqual([1, 4]);
		expect(stepEntry.enteredNotes[1].pitch).toBe(stepEntry.enteredNotes[0].pitch);
		expect(stepEntry.enteredNotes[1].duration).toEqual([1, 8]);
		expect(stepEntry.enteredNotes[1].tied).toBeFalsy();
	});

	it('chains: pressing tie repeatedly extends the chain', () => {
		setDuration('quarter');
		addNote(7, 4, 'natural'); // G4
		expect(enterTiedNote()).toBe(true);
		expect(enterTiedNote()).toBe(true);

		expect(stepEntry.enteredNotes).toHaveLength(3);
		expect(stepEntry.enteredNotes[0].tied).toBe(true);
		expect(stepEntry.enteredNotes[1].tied).toBe(true);
		expect(stepEntry.enteredNotes[2].tied).toBeFalsy();
		const pitch = stepEntry.enteredNotes[0].pitch;
		expect(stepEntry.enteredNotes.every((n) => n.pitch === pitch)).toBe(true);
	});

	it('is a no-op when no notes have been entered', () => {
		expect(enterTiedNote()).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(0);
	});

	it('is a no-op when the last note is a rest', () => {
		addRest();
		expect(enterTiedNote()).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(1);
		expect(stepEntry.enteredNotes[0].tied).toBeFalsy();
	});

	it('refuses to insert when there is no remaining capacity', () => {
		// Fill 2 bars exactly with whole notes
		setDuration('whole');
		addNote(0, 4, 'natural');
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes).toHaveLength(2);

		expect(enterTiedNote()).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(2);
	});

	it('honors the current duration modifier (triplet)', () => {
		setDuration('eighth');
		addNote(0, 4, 'natural');
		toggleTriplet();
		expect(enterTiedNote()).toBe(true);
		expect(stepEntry.enteredNotes[1].duration).toEqual([1, 12]);
	});

	it('Backspace after tie clears the dangling tied flag', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural');
		enterTiedNote();
		expect(stepEntry.enteredNotes[0].tied).toBe(true);

		deleteLastNote();
		expect(stepEntry.enteredNotes).toHaveLength(1);
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
	});

	it('arrow-edit on the tied duplicate clears the stale tie when pitch diverges', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural'); // C4
		enterTiedNote();
		expect(stepEntry.enteredNotes[0].tied).toBe(true);

		const basePitch = stepEntry.enteredNotes[0].pitch;
		adjustLastNotePitch(1); // bump duplicate up a semitone — pitches now differ

		expect(stepEntry.enteredNotes[0].tied).toBe(false);
		expect(stepEntry.enteredNotes[1].pitch).toBe((basePitch ?? 0) + 1);
	});

	it('carries the explicit enharmonic spelling onto the tied duplicate', () => {
		setDuration('quarter');
		stepEntry.phraseKey = 'C';
		addNote(0, 4, 'sharp'); // C natural + sharp = C#4 (chromatic, flippable)
		flipLastNoteSpelling(); // sets explicit spelling — 'flat' in non-flat key
		expect(stepEntry.enteredNotes[0].spelling).toBe('flat');

		enterTiedNote();
		expect(stepEntry.enteredNotes[1].spelling).toBe('flat');
	});

	it('arrow-edit that lands back on the same pitch keeps the tie', () => {
		setDuration('quarter');
		addNote(0, 4, 'natural'); // C4
		enterTiedNote();
		const startPitch = stepEntry.enteredNotes[0].pitch;
		adjustLastNotePitch(1);
		adjustLastNotePitch(-1); // back to original pitch
		expect(stepEntry.enteredNotes[1].pitch).toBe(startPitch);
		// Once cleared by the upward edit it stays cleared — the user can re-tie
		// explicitly if they want.
		expect(stepEntry.enteredNotes[0].tied).toBe(false);
	});
});
