/**
 * Editor mode state: a lick's major/minor reading lives beside the written
 * key. The mode follows the chosen CATEGORY until the user touches the mode
 * control; "Read as relative key" relabels F major ↔ D minor without moving a
 * note; loading a lick hydrates an explicit mode as touched and an inferred one
 * as untouched; save stamps the mode on the phrase.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry,
	addNote,
	reset,
	getCurrentPhrase,
	loadFromPhrase,
	setPhraseMode,
	setCategory,
	switchToRelativeKey,
	flipSelectedNoteSpelling
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Phrase } from '$lib/types/music';

function lick(over: Partial<Phrase> = {}): Phrase {
	return {
		id: 'l1',
		name: 'L',
		timeSignature: [4, 4],
		key: 'D',
		notes: [{ pitch: 62, duration: [1, 4], offset: [0, 1] }],
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: ['user-entered'],
		source: 'user-entered',
		...over
	};
}

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
});

describe('defaults and category-follow', () => {
	it('starts major and untouched', () => {
		expect(stepEntry.phraseMode).toBe('major');
		expect(stepEntry.modeTouched).toBe(false);
	});

	it('follows a minor category while the mode control is untouched', () => {
		setCategory('ii-V-I-minor');
		expect(stepEntry.phraseMode).toBe('minor');
		setCategory('ii-V-I-major');
		expect(stepEntry.phraseMode).toBe('major');
		expect(stepEntry.modeTouched).toBe(false);
	});

	it('stops following the category once the user sets the mode', () => {
		setPhraseMode('major');
		expect(stepEntry.modeTouched).toBe(true);
		setCategory('minor-chord');
		expect(stepEntry.phraseMode).toBe('major');
	});
});

describe('switchToRelativeKey', () => {
	it('F major → D minor without moving notes; D minor → F major back', () => {
		stepEntry.phraseKey = 'F';
		addNote(9, 4, 'natural'); // A4
		addNote(11, 4, 'natural'); // Bb4 (F major signature)
		const before = stepEntry.enteredNotes.map((n) => n.pitch);
		switchToRelativeKey();
		expect(stepEntry.phraseKey).toBe('D');
		expect(stepEntry.phraseMode).toBe('minor');
		expect(stepEntry.modeTouched).toBe(true);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual(before);
		switchToRelativeKey();
		expect(stepEntry.phraseKey).toBe('F');
		expect(stepEntry.phraseMode).toBe('major');
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual(before);
	});
});

describe('load / save round-trip of the mode', () => {
	it('hydrates an explicit mode as touched', () => {
		loadFromPhrase(lick({ mode: 'minor' }), INSTRUMENTS['concert']);
		expect(stepEntry.phraseMode).toBe('minor');
		expect(stepEntry.modeTouched).toBe(true);
		expect(getCurrentPhrase().mode).toBe('minor');
	});

	it('hydrates an inferred mode (tonic harmony) as untouched', () => {
		loadFromPhrase(
			lick({
				key: 'C',
				harmony: [{ chord: { root: 'C', quality: 'min7' }, scaleId: 'major.aeolian', startOffset: [0, 1], duration: [1, 1] }]
			}),
			INSTRUMENTS['concert']
		);
		expect(stepEntry.phraseMode).toBe('minor');
		expect(stepEntry.modeTouched).toBe(false);
	});

	it('a legacy lick with no field and no harmony loads major', () => {
		loadFromPhrase(lick({ category: 'ii-V-I-minor' }), INSTRUMENTS['concert']);
		expect(stepEntry.phraseMode).toBe('major');
	});

	it('stamps the mode on every saved phrase and reset clears it', () => {
		setPhraseMode('minor');
		expect(getCurrentPhrase().mode).toBe('minor');
		reset();
		expect(stepEntry.phraseMode).toBe('major');
		expect(stepEntry.modeTouched).toBe(false);
		expect(getCurrentPhrase().mode).toBe('major');
	});
});

describe('enharmonic flip default follows the drawn signature', () => {
	it('in D minor (one flat) a black key defaults flat, so the first flip goes sharp', () => {
		stepEntry.phraseKey = 'D';
		setPhraseMode('minor');
		addNote(11, 4, 'flat'); // B + flat = Bb4
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBe('sharp');
	});

	it('in D major (two sharps) the first flip goes flat', () => {
		stepEntry.phraseKey = 'D';
		addNote(0, 4, 'sharp'); // C + sharp = C#4
		flipSelectedNoteSpelling();
		expect(stepEntry.enteredNotes[0].spelling).toBe('flat');
	});
});
