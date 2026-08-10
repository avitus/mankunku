import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry, addNote, reset, setDuration, toggleDotted, toggleTriplet
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

describe('sixteenth-note entry', () => {
	it('enters a sixteenth note', () => {
		setDuration('sixteenth');
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].duration).toEqual([1, 16]);
	});

	it('enters a dotted eighth followed by a sixteenth — one beat', () => {
		setDuration('eighth');
		toggleDotted();
		addNote(0, 4, 'natural');
		toggleDotted();
		setDuration('sixteenth');
		addNote(2, 4, 'natural');

		const [first, second] = stepEntry.enteredNotes;
		expect(first.duration).toEqual([3, 16]);
		expect(second.duration).toEqual([1, 16]);
		// 3/16 + 1/16 = 1/4 — the figure fills exactly one beat in 4/4.
		expect(first.duration[0] / first.duration[1] + second.duration[0] / second.duration[1]).toBeCloseTo(0.25);
	});
});

describe('modifier toggles refuse bases with no such variant', () => {
	it('ignores Triplet on a sixteenth', () => {
		setDuration('sixteenth');
		toggleTriplet();
		expect(stepEntry.tripletMode).toBe(false);

		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].duration).toEqual([1, 16]);
	});

	it('ignores Dotted on a whole note', () => {
		setDuration('whole');
		toggleDotted();
		expect(stepEntry.dottedMode).toBe(false);
	});

	it('still allows turning a leftover modifier off', () => {
		// Triplet legitimately set on an eighth, then the base changes to one
		// that has no triplet: the flag survives but must remain clearable.
		toggleTriplet();
		expect(stepEntry.tripletMode).toBe(true);
		setDuration('sixteenth');
		expect(stepEntry.tripletMode).toBe(true);

		toggleTriplet();
		expect(stepEntry.tripletMode).toBe(false);
	});

	it('does not apply a leftover triplet flag to a sixteenth', () => {
		toggleTriplet(); // valid on the default eighth
		setDuration('sixteenth');
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].duration).toEqual([1, 16]);
	});

	it('resumes a leftover triplet flag on a base that supports it', () => {
		toggleTriplet();
		setDuration('sixteenth');
		setDuration('quarter');
		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].duration).toEqual([1, 6]);
	});
});
