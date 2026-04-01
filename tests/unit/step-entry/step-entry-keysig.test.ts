import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry, addNote, adjustLastNotePitch, reset,
	getCurrentPhrase
} from '$lib/state/step-entry.svelte';
import { phraseToAbc } from '$lib/music/notation';

/** Get the ABC note tokens line (last line) from the current phrase. */
function noteLine(): string {
	const phrase = getCurrentPhrase();
	const abc = phraseToAbc(phrase);
	return abc.split('\n').pop()!;
}

beforeEach(() => {
	reset();
	stepEntry.phraseKey = 'C';
	stepEntry.selectedOctave = 4;
});

describe('key signature applied on note entry', () => {
	describe('key of D (F#, C#)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'D'; });

		it('pressing F enters F#', () => {
			addNote(5, 4, 'natural'); // F
			expect(stepEntry.enteredNotes[0].pitch).toBe(66); // F#4
		});

		it('pressing C enters C#', () => {
			addNote(0, 4, 'natural'); // C
			expect(stepEntry.enteredNotes[0].pitch).toBe(61); // C#4
		});

		it('F# shows no accidental in notation (matches key sig)', () => {
			addNote(5, 4, 'natural');
			const line = noteLine();
			expect(line).not.toContain('^F');
			expect(line).not.toContain('=F');
		});

		it('D is unaffected by key sig', () => {
			addNote(2, 4, 'natural'); // D
			expect(stepEntry.enteredNotes[0].pitch).toBe(62); // D4 natural
		});

		it('pressing down arrow on F# gives F natural with natural sign', () => {
			addNote(5, 4, 'natural'); // enters F#4 = 66
			adjustLastNotePitch(-1);  // → F4 = 65
			expect(stepEntry.enteredNotes[0].pitch).toBe(65);
			expect(noteLine()).toContain('=F');
		});

		it('pressing down arrow on C# gives C natural with natural sign', () => {
			addNote(0, 4, 'natural'); // enters C#4 = 61
			adjustLastNotePitch(-1);  // → C4 = 60
			expect(stepEntry.enteredNotes[0].pitch).toBe(60);
			expect(noteLine()).toContain('=C');
		});
	});

	describe('key of G (F#)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'G'; });

		it('pressing F enters F#', () => {
			addNote(5, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(66);
		});

		it('pressing G enters G natural (not affected)', () => {
			addNote(7, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(67);
		});

		it('down arrow on F# gives F natural', () => {
			addNote(5, 4, 'natural');
			adjustLastNotePitch(-1);
			expect(stepEntry.enteredNotes[0].pitch).toBe(65);
			expect(noteLine()).toContain('=F');
		});
	});

	describe('key of A (F#, C#, G#)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'A'; });

		it('pressing G enters G#', () => {
			addNote(7, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(68);
		});

		it('down arrow on G# gives G natural', () => {
			addNote(7, 4, 'natural');
			adjustLastNotePitch(-1);
			expect(stepEntry.enteredNotes[0].pitch).toBe(67);
			expect(noteLine()).toContain('=G');
		});
	});

	describe('key of F (Bb)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'F'; });

		it('pressing B enters Bb', () => {
			addNote(11, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(70); // Bb4
		});

		it('pressing A is unaffected', () => {
			addNote(9, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(69); // A4
		});

		it('up arrow on Bb gives B natural', () => {
			addNote(11, 4, 'natural');
			adjustLastNotePitch(1);
			expect(stepEntry.enteredNotes[0].pitch).toBe(71);
			expect(noteLine()).toContain('=B');
		});
	});

	describe('key of Bb (Bb, Eb)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'Bb'; });

		it('pressing E enters Eb', () => {
			addNote(4, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(63); // Eb4
		});

		it('pressing B enters Bb', () => {
			addNote(11, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(70);
		});

		it('up arrow on Eb gives E natural', () => {
			addNote(4, 4, 'natural');
			adjustLastNotePitch(1);
			expect(stepEntry.enteredNotes[0].pitch).toBe(64);
			expect(noteLine()).toContain('=E');
		});
	});

	describe('key of Eb (Bb, Eb, Ab)', () => {
		beforeEach(() => { stepEntry.phraseKey = 'Eb'; });

		it('pressing A enters Ab', () => {
			addNote(9, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(68); // Ab4
		});

		it('up arrow on Ab gives A natural', () => {
			addNote(9, 4, 'natural');
			adjustLastNotePitch(1);
			expect(stepEntry.enteredNotes[0].pitch).toBe(69);
			expect(noteLine()).toContain('=A');
		});
	});

	describe('key of C (no accidentals)', () => {
		it('pressing F enters F natural', () => {
			addNote(5, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(65);
		});

		it('pressing C enters C natural', () => {
			addNote(0, 4, 'natural');
			expect(stepEntry.enteredNotes[0].pitch).toBe(60);
		});
	});

	describe('explicit accidentals override key signature', () => {
		beforeEach(() => { stepEntry.phraseKey = 'G'; });

		it('sharp + F enters F# (same as key sig)', () => {
			addNote(5, 4, 'sharp');
			expect(stepEntry.enteredNotes[0].pitch).toBe(66);
		});

		it('flat + F enters Fb/E in key of G', () => {
			addNote(5, 4, 'flat');
			expect(stepEntry.enteredNotes[0].pitch).toBe(64); // E4
		});
	});
});
