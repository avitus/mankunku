import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry, addNote, adjustLastNotePitch, reset,
	getCurrentPhrase
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';
import { phraseToAbc } from '$lib/music/notation';

/** Get the ABC note tokens line (last line) from the current phrase. */
function noteLine(): string {
	const phrase = getCurrentPhrase();
	const abc = phraseToAbc(phrase);
	return abc.split('\n').pop()!;
}

beforeEach(() => {
	// Use concert-pitch instrument so stored MIDI matches typed pitch directly
	// (no written-to-concert transposition). Exercising the key-sig logic only.
	settings.instrumentId = 'concert';
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

describe('written-to-concert conversion for transposing instruments', () => {
	it('tenor sax: typing F4 stores concert Eb3 (MIDI 51)', () => {
		settings.instrumentId = 'tenor-sax';
		reset();
		stepEntry.phraseKey = 'C';
		// User fingers written F on tenor sax; we store the concert equivalent
		addNote(5, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(51); // F4 written - 14 = Eb3
	});

	it('tenor sax: typing D4 stores concert C3 (MIDI 48)', () => {
		settings.instrumentId = 'tenor-sax';
		reset();
		stepEntry.phraseKey = 'C';
		// Written D on tenor = concert C (user's tonic)
		addNote(2, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(48); // D4 written - 14 = C3
	});

	it('alto sax: typing A4 stores concert C4 (MIDI 60)', () => {
		settings.instrumentId = 'alto-sax';
		reset();
		stepEntry.phraseKey = 'C';
		// Alto sax transposes 9 semitones
		addNote(9, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(60); // A4 written - 9 = C4
	});

	it('trumpet: typing D4 stores concert C4 (MIDI 60)', () => {
		settings.instrumentId = 'trumpet';
		reset();
		stepEntry.phraseKey = 'C';
		// Trumpet transposes 2 semitones
		addNote(2, 4, 'natural');
		expect(stepEntry.enteredNotes[0].pitch).toBe(60); // D4 written - 2 = C4
	});

	it('nearestOctave picks in written space, not concert', () => {
		settings.instrumentId = 'tenor-sax';
		reset();
		stepEntry.phraseKey = 'C';
		// First note: written F4 (concert Eb3 = 51)
		addNote(5, 4, 'natural');
		// Second note: A. User wants it near the previous F4 → written A4 (concert G3 = 55)
		addNote(9, 4, 'natural');
		expect(stepEntry.enteredNotes[1].pitch).toBe(55); // A4 written - 14 = G3
	});
});

describe('getCurrentPhrase written-to-concert key conversion', () => {
	it('tenor sax: selecting D major stores concert key C', async () => {
		const { getCurrentPhrase } = await import('$lib/state/step-entry.svelte');
		settings.instrumentId = 'tenor-sax';
		reset();
		stepEntry.phraseKey = 'D';
		const phrase = getCurrentPhrase();
		// Written D on tenor = concert C
		expect(phrase.key).toBe('C');
	});

	it('tenor sax: selecting Bb major stores concert key Ab', async () => {
		const { getCurrentPhrase } = await import('$lib/state/step-entry.svelte');
		settings.instrumentId = 'tenor-sax';
		reset();
		stepEntry.phraseKey = 'Bb';
		const phrase = getCurrentPhrase();
		// Written Bb on tenor = concert Ab
		expect(phrase.key).toBe('Ab');
	});

	it('alto sax: selecting C major stores concert key Eb', async () => {
		const { getCurrentPhrase } = await import('$lib/state/step-entry.svelte');
		settings.instrumentId = 'alto-sax';
		reset();
		stepEntry.phraseKey = 'C';
		const phrase = getCurrentPhrase();
		// Written C on alto = concert Eb
		expect(phrase.key).toBe('Eb');
	});

	it('concert instrument: phrase.key equals stepEntry.phraseKey', async () => {
		const { getCurrentPhrase } = await import('$lib/state/step-entry.svelte');
		settings.instrumentId = 'concert';
		reset();
		stepEntry.phraseKey = 'D';
		const phrase = getCurrentPhrase();
		// No transposition
		expect(phrase.key).toBe('D');
	});
});
