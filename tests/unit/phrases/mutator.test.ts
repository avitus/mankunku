import { describe, it, expect } from 'vitest';
import { rhythmicDisplacement, octaveDisplacement, truncate, retrograde } from '$lib/phrases/mutator.ts';
import type { Phrase, Note, Fraction, HarmonicSegment } from '$lib/types/music.ts';
import { addFractions } from '$lib/music/intervals.ts';

function makeNote(pitch: number | null, offset: Fraction, duration: Fraction = [1, 8]): Note {
	return { pitch, offset, duration };
}

const defaultHarmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'C-major', startOffset: [0, 1], duration: [2, 1] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test-lick',
		name: 'Test Lick',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes,
		harmony: defaultHarmony,
		difficulty: { level: 30, pitchComplexity: 30, rhythmComplexity: 30, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

describe('rhythmicDisplacement', () => {
	it('shifts all note offsets by an 8th note', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [1, 4])
		]);
		const displaced = rhythmicDisplacement(phrase);

		for (let i = 0; i < phrase.notes.length; i++) {
			const expected = addFractions(phrase.notes[i].offset, [1, 8]);
			expect(displaced.notes[i].offset).toEqual(expected);
		}
	});

	it('preserves pitches', () => {
		const phrase = makePhrase([makeNote(60, [0, 1]), makeNote(62, [1, 8])]);
		const displaced = rhythmicDisplacement(phrase);
		expect(displaced.notes[0].pitch).toBe(60);
		expect(displaced.notes[1].pitch).toBe(62);
	});

	it('updates id and name', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const displaced = rhythmicDisplacement(phrase);
		expect(displaced.id).toBe('test-lick_displaced');
		expect(displaced.name).toContain('displaced');
	});

	it('sets source to mutated:{originalId}', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const displaced = rhythmicDisplacement(phrase);
		expect(displaced.source).toBe('mutated:test-lick');
	});
});

describe('octaveDisplacement', () => {
	it('does not displace first or last note', () => {
		const notes = [
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [2, 8]),
			makeNote(66, [3, 8]),
			makeNote(68, [4, 8])
		];
		const phrase = makePhrase(notes);

		// Run multiple times to account for randomness
		for (let trial = 0; trial < 20; trial++) {
			const result = octaveDisplacement(phrase);
			expect(result.notes[0].pitch).toBe(60);
			expect(result.notes[4].pitch).toBe(68);
		}
	});

	it('returns unchanged phrase with < 4 pitched notes', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [2, 8])
		]);
		const result = octaveDisplacement(phrase);
		expect(result).toBe(phrase); // same reference
	});

	it('keeps displaced notes within range [44, rangeHigh]', () => {
		const notes = [
			makeNote(48, [0, 1]),   // close to lower bound
			makeNote(50, [1, 8]),
			makeNote(52, [2, 8]),
			makeNote(54, [3, 8]),
			makeNote(56, [4, 8])
		];
		const phrase = makePhrase(notes);
		for (let trial = 0; trial < 20; trial++) {
			const result = octaveDisplacement(phrase, 75);
			for (const note of result.notes) {
				if (note.pitch !== null) {
					expect(note.pitch).toBeGreaterThanOrEqual(44);
					expect(note.pitch).toBeLessThanOrEqual(75);
				}
			}
		}
	});

	it('updates id and source', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]), makeNote(62, [1, 8]),
			makeNote(64, [2, 8]), makeNote(66, [3, 8])
		]);
		const result = octaveDisplacement(phrase);
		expect(result.id).toBe('test-lick_octdispl');
		expect(result.source).toBe('mutated:test-lick');
	});
});

describe('truncate', () => {
	it('shortens phrase to ~60% of pitched notes by default', () => {
		const notes = Array.from({ length: 10 }, (_, i) =>
			makeNote(60 + i, [i, 8] as Fraction)
		);
		const phrase = makePhrase(notes);
		const result = truncate(phrase);
		expect(result.notes.length).toBeLessThan(phrase.notes.length);
		expect(result.notes.length).toBe(Math.ceil(10 * 0.6));
	});

	it('respects custom maxNotes', () => {
		const notes = Array.from({ length: 10 }, (_, i) =>
			makeNote(60 + i, [i, 8] as Fraction)
		);
		const phrase = makePhrase(notes);
		const result = truncate(phrase, 3);
		expect(result.notes.length).toBe(3);
	});

	it('returns unchanged phrase with <= 4 pitched notes', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [2, 8])
		]);
		const result = truncate(phrase);
		expect(result).toBe(phrase);
	});

	it('recalculates lengthBars', () => {
		const notes = Array.from({ length: 10 }, (_, i) =>
			makeNote(60 + i, [i, 4] as Fraction)
		);
		const phrase = makePhrase(notes);
		const result = truncate(phrase);
		expect(result.difficulty.lengthBars).toBeGreaterThanOrEqual(1);
		expect(result.difficulty.lengthBars).toBeLessThanOrEqual(phrase.difficulty.lengthBars + 5);
	});

	it('updates id and source', () => {
		const notes = Array.from({ length: 8 }, (_, i) =>
			makeNote(60 + i, [i, 8] as Fraction)
		);
		const phrase = makePhrase(notes);
		const result = truncate(phrase);
		expect(result.id).toBe('test-lick_trunc');
		expect(result.source).toBe('mutated:test-lick');
	});
});

describe('retrograde', () => {
	it('reverses the pitch sequence', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 8]),
			makeNote(64, [2, 8])
		]);
		const result = retrograde(phrase);
		expect(result.notes[0].pitch).toBe(64);
		expect(result.notes[1].pitch).toBe(62);
		expect(result.notes[2].pitch).toBe(60);
	});

	it('preserves rhythm (offsets and durations)', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1], [1, 8]),
			makeNote(62, [1, 8], [1, 4]),
			makeNote(64, [3, 8], [1, 8])
		]);
		const result = retrograde(phrase);
		// Offsets and durations should be unchanged
		expect(result.notes[0].offset).toEqual([0, 1]);
		expect(result.notes[0].duration).toEqual([1, 8]);
		expect(result.notes[1].offset).toEqual([1, 8]);
		expect(result.notes[1].duration).toEqual([1, 4]);
	});

	it('reverses rests along with pitched notes', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(null, [1, 8]),
			makeNote(64, [2, 8])
		]);
		const result = retrograde(phrase);
		expect(result.notes[0].pitch).toBe(64);
		expect(result.notes[1].pitch).toBeNull();
		expect(result.notes[2].pitch).toBe(60);
	});

	it('updates id and source', () => {
		const phrase = makePhrase([makeNote(60, [0, 1]), makeNote(62, [1, 8])]);
		const result = retrograde(phrase);
		expect(result.id).toBe('test-lick_retro');
		expect(result.source).toBe('mutated:test-lick');
	});
});
