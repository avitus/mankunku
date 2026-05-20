import { describe, it, expect, beforeEach } from 'vitest';
import {
	stepEntry,
	loadFromPhrase,
	reset,
	getCurrentPhrase
} from '$lib/state/step-entry.svelte';
import { settings } from '$lib/state/settings.svelte';
import { INSTRUMENTS } from '$lib/types/instruments';
import type { Phrase } from '$lib/types/music';
import { writtenKeyToConcert } from '$lib/music/transposition';

function makePhrase(overrides: Partial<Phrase> = {}): Phrase {
	return {
		id: 'lick-edit-1',
		name: 'My Lick',
		timeSignature: [4, 4],
		key: 'F', // concert
		notes: [
			{ pitch: 60, duration: [1, 4] as [number, number], offset: [0, 1] as [number, number] },
			{ pitch: 64, duration: [1, 4] as [number, number], offset: [1, 4] as [number, number] },
			{ pitch: 67, duration: [1, 2] as [number, number], offset: [1, 2] as [number, number] }
		],
		harmony: [],
		difficulty: { level: 4, pitchComplexity: 3, rhythmComplexity: 2, lengthBars: 2 },
		category: 'major-chord',
		tags: ['user-entered', 'practice', 'prog:major-vamp'],
		source: 'user-entered',
		...overrides
	};
}

beforeEach(() => {
	settings.instrumentId = 'concert';
	reset();
});

describe('reset() clears editing fields', () => {
	it('nulls editingId, editingSource, editingTags, editingCategory after reset', () => {
		stepEntry.editingId = 'foo';
		stepEntry.editingSource = 'user-entered';
		stepEntry.editingTags = ['user-entered', 'practice'];
		stepEntry.editingCategory = 'blues';
		reset();
		expect(stepEntry.editingId).toBeNull();
		expect(stepEntry.editingSource).toBeNull();
		expect(stepEntry.editingTags).toBeNull();
		expect(stepEntry.editingCategory).toBeNull();
	});
});

describe('loadFromPhrase', () => {
	it('hydrates enteredNotes from the lick (concert pitch preserved)', () => {
		loadFromPhrase(makePhrase(), INSTRUMENTS['concert']);
		expect(stepEntry.enteredNotes).toHaveLength(3);
		expect(stepEntry.enteredNotes.map((n) => n.pitch)).toEqual([60, 64, 67]);
	});

	it('sets phraseName, category, and barCount from the lick', () => {
		loadFromPhrase(makePhrase(), INSTRUMENTS['concert']);
		expect(stepEntry.phraseName).toBe('My Lick');
		expect(stepEntry.category).toBe('major-chord');
		expect(stepEntry.barCount).toBe(2);
	});

	it('stores the editing snapshot (id, source, tags, category)', () => {
		loadFromPhrase(makePhrase(), INSTRUMENTS['concert']);
		expect(stepEntry.editingId).toBe('lick-edit-1');
		expect(stepEntry.editingSource).toBe('user-entered');
		expect(stepEntry.editingTags).toEqual(['user-entered', 'practice', 'prog:major-vamp']);
		expect(stepEntry.editingCategory).toBe('major-chord');
	});

	it('converts concert key to written for the dropdown on a transposing instrument', () => {
		// Concert F on tenor sax (Bb, +14 semitones) → written G
		loadFromPhrase(makePhrase({ key: 'F' }), INSTRUMENTS['tenor-sax']);
		expect(stepEntry.phraseKey).toBe('G');
	});

	it('leaves the dropdown key equal to the lick key for a concert instrument', () => {
		loadFromPhrase(makePhrase({ key: 'Eb' }), INSTRUMENTS['concert']);
		expect(stepEntry.phraseKey).toBe('Eb');
	});

	it('clamps barCount to [1, 4]', () => {
		loadFromPhrase(
			makePhrase({ difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 8 } }),
			INSTRUMENTS['concert']
		);
		expect(stepEntry.barCount).toBe(4);
	});

	it('round-trips key on a transposing instrument: getCurrentPhrase converts back to concert', () => {
		const tenor = INSTRUMENTS['tenor-sax'];
		loadFromPhrase(makePhrase({ key: 'F' }), tenor);
		settings.instrumentId = 'tenor-sax';
		const phrase = getCurrentPhrase();
		// Written G in stepEntry.phraseKey → concert F via getCurrentPhrase
		expect(phrase.key).toBe(writtenKeyToConcert(stepEntry.phraseKey, tenor));
		expect(phrase.key).toBe('F');
	});

	it('shallow-copies notes so editing the rune does not mutate the source lick', () => {
		const source = makePhrase();
		loadFromPhrase(source, INSTRUMENTS['concert']);
		stepEntry.enteredNotes[0].pitch = 99;
		expect(source.notes[0].pitch).toBe(60); // original untouched
	});

	it('shallow-copies the tags array so the editing snapshot can be mutated independently', () => {
		const source = makePhrase({ tags: ['user-entered'] });
		loadFromPhrase(source, INSTRUMENTS['concert']);
		stepEntry.editingTags!.push('mutated');
		expect(source.tags).toEqual(['user-entered']);
	});

	it('clears editingId etc. when reset() is called after loadFromPhrase', () => {
		loadFromPhrase(makePhrase(), INSTRUMENTS['concert']);
		reset();
		expect(stepEntry.editingId).toBeNull();
		expect(stepEntry.editingTags).toBeNull();
		expect(stepEntry.editingCategory).toBeNull();
		expect(stepEntry.enteredNotes).toEqual([]);
		expect(stepEntry.phraseName).toBe('');
	});
});
