import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry,
	addNote,
	reset,
	resolveEntryPitch
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';

/**
 * `resolveEntryPitch` is the pitch-resolution pipeline extracted out of
 * `addNote`: key-signature/accidental application → nearest-octave
 * placement relative to a caller-supplied reference (concert pitch, or
 * `null` to use the typed octave literally) → written-range validation →
 * written→concert conversion. `addNote` is the sole existing caller today,
 * passing the last pitched note's concert pitch as the reference — these
 * tests pin that behavior and cross-check the two paths agree.
 */

beforeEach(() => {
	// Concert-pitch instrument by default: stored MIDI matches written MIDI
	// directly (no transposition), keeping the arithmetic legible. Individual
	// tests override the instrument where transposition itself is the point.
	settings.instrumentId = 'concert';
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
});

describe('resolveEntryPitch: key signature application', () => {
	it('applies a sharp key signature (D major: F -> F#) and matches addNote', () => {
		stepEntry.phraseKey = 'D';
		const resolved = resolveEntryPitch(5, 4, 'natural', null); // F
		expect(resolved).toBe(66); // F#4

		addNote(5, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(resolved);
	});

	it('applies a flat key signature (Bb major: E -> Eb) and matches addNote', () => {
		stepEntry.phraseKey = 'Bb';
		const resolved = resolveEntryPitch(4, 4, 'natural', null); // E
		expect(resolved).toBe(63); // Eb4

		addNote(4, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(resolved);
	});
});

describe('resolveEntryPitch: explicit accidental overrides key signature', () => {
	it('an explicit flat wins over the key signature (G major: F -> E via flat)', () => {
		stepEntry.phraseKey = 'G';
		const resolved = resolveEntryPitch(5, 4, 'flat', null); // F, flatted
		expect(resolved).toBe(64); // E4

		addNote(5, 4, 'flat');
		expect(stepEntry.enteredNotes[0].pitch).toBe(resolved);
	});
});

describe('resolveEntryPitch: referenceConcertPitch null honors the typed octave', () => {
	it('places the note in the literal typed octave when there is no reference', () => {
		const resolved = resolveEntryPitch(9, 5, 'natural', null); // A5
		expect(resolved).toBe(81);
	});
});

describe('resolveEntryPitch: nearest-octave placement relative to a reference', () => {
	it('picks the octave above when it is closer than the octave below', () => {
		// Reference B4 (concert 71). Pressing C: C5 (72) is 1 semitone away,
		// C4 (60) is 11 semitones away, so C5 wins.
		stepEntry.enteredNotes = [{ pitch: 71, duration: [1, 4], offset: [0, 1] }];
		const resolved = resolveEntryPitch(0, 4, 'natural', 71);
		expect(resolved).toBe(72); // C5

		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[1].pitch).toBe(resolved);
	});

	it('picks the octave below when it is closer than the octave above', () => {
		// Reference C#4 (concert 61). Pressing B: B3 (59) is 2 semitones away,
		// B4 (71) is 10 semitones away, so B3 wins.
		stepEntry.enteredNotes = [{ pitch: 61, duration: [1, 4], offset: [0, 1] }];
		const resolved = resolveEntryPitch(11, 4, 'natural', 61);
		expect(resolved).toBe(59); // B3

		addNote(11, 4, 'natural');
		expect(stepEntry.enteredNotes[1].pitch).toBe(resolved);
	});

	it('breaks an equidistant tie by preferring the lower octave', () => {
		// Reference F#4 (concert 66) sits exactly midway between C4 (60) and
		// C5 (72), both 6 semitones away. The tie resolves to C4.
		stepEntry.enteredNotes = [{ pitch: 66, duration: [1, 4], offset: [0, 1] }];
		const resolved = resolveEntryPitch(0, 4, 'natural', 66);
		expect(resolved).toBe(60); // C4, not C5

		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[1].pitch).toBe(resolved);
	});
});

describe('resolveEntryPitch: written-range rejection at both ends', () => {
	it('rejects a typed octave below the entry range when there is no reference', () => {
		expect(resolveEntryPitch(0, 1, 'natural', null)).toBeNull(); // C1, way below Bb3
	});

	it('rejects a typed octave above the entry range when there is no reference', () => {
		expect(resolveEntryPitch(0, 9, 'natural', null)).toBeNull(); // C9, way above F6
	});

	it('rejects when every octave near a very low reference is still out of range', () => {
		expect(resolveEntryPitch(0, 4, 'natural', 0)).toBeNull();
	});

	it('rejects when every octave near a very high reference is still out of range', () => {
		expect(resolveEntryPitch(0, 4, 'natural', 200)).toBeNull();
	});

	it('addNote returns false in lockstep with a null resolveEntryPitch', () => {
		const resolved = resolveEntryPitch(0, 1, 'natural', null);
		expect(resolved).toBeNull();

		const added = addNote(0, 1, 'natural');
		expect(added).toBe(false);
		expect(stepEntry.enteredNotes).toHaveLength(0);
	});
});

describe('resolveEntryPitch: transpositionOverride', () => {
	it('honors a non-null override instead of the instrument transposition', () => {
		settings.instrumentId = 'tenor-sax'; // would normally add +14
		stepEntry.transpositionOverride = 0; // but treat typed pitches as concert
		stepEntry.phraseKey = 'C';

		const resolved = resolveEntryPitch(0, 4, 'natural', null);
		expect(resolved).toBe(60); // C4, no transposition applied

		addNote(0, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(resolved);
	});
});

describe('resolveEntryPitch: purity', () => {
	it('does not mutate enteredNotes or selection', () => {
		stepEntry.enteredNotes = [{ pitch: 60, duration: [1, 4], offset: [0, 1] }];
		stepEntry.selectedNoteIndex = 0;

		resolveEntryPitch(0, 4, 'natural', 60);

		expect(stepEntry.enteredNotes).toHaveLength(1);
		expect(stepEntry.enteredNotes[0].pitch).toBe(60);
		expect(stepEntry.selectedNoteIndex).toBe(0);
	});
});
