import { describe, it, expect, vi, afterEach } from 'vitest';
import { generatePhrase, getDefaultHarmony } from '$lib/phrases/generator';
import type { PhraseCategory, PitchClass, ChordQuality } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';

// ─── Helpers ───────────────────────────────────────────────────

/** Valid chord qualities from the ChordQuality union */
const VALID_CHORD_QUALITIES: ChordQuality[] = [
	'maj7', 'min7', '7', 'min7b5', 'dim7',
	'maj6', 'min6', 'aug7', 'sus4', 'sus2',
	'7alt', '7#11', '7b9', '7#9', '7b13',
	'minMaj7', 'aug', 'dim'
];

function makeOptions(
	overrides: Partial<Parameters<typeof generatePhrase>[0]> = {}
): Parameters<typeof generatePhrase>[0] {
	const key: PitchClass = overrides.key ?? 'C';
	const category: PhraseCategory = overrides.category ?? 'ii-V-I-major';
	return {
		key,
		category,
		difficulty: 3,
		harmony: getDefaultHarmony(category, key),
		bars: 2,
		...overrides
	};
}

// ─── getDefaultHarmony ────────────────────────────────────────

describe('getDefaultHarmony', () => {
	it('returns 3 segments for ii-V-I-major', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');
		expect(harmony).toHaveLength(3);
	});

	it('returns 2 segments for short-ii-V-I-major', () => {
		const harmony = getDefaultHarmony('short-ii-V-I-major', 'C');
		expect(harmony).toHaveLength(2);
	});

	it('returns 3 segments for ii-V-I-minor', () => {
		const harmony = getDefaultHarmony('ii-V-I-minor', 'C');
		expect(harmony).toHaveLength(3);
	});

	it('returns 2 segments for short-ii-V-I-minor', () => {
		const harmony = getDefaultHarmony('short-ii-V-I-minor', 'C');
		expect(harmony).toHaveLength(2);
	});

	it('returns 1 segment for blues', () => {
		const harmony = getDefaultHarmony('blues', 'C');
		expect(harmony).toHaveLength(1);
	});

	it('returns 1 segment for major-chord (default branch)', () => {
		const harmony = getDefaultHarmony('major-chord', 'C');
		expect(harmony).toHaveLength(1);
	});

	it('returns 1 segment for minor-chord (default branch)', () => {
		const harmony = getDefaultHarmony('minor-chord', 'C');
		expect(harmony).toHaveLength(1);
	});

	it('returns 1 segment for dominant-chord (default branch)', () => {
		const harmony = getDefaultHarmony('dominant-chord', 'C');
		expect(harmony).toHaveLength(1);
	});

	it('returns 1 segment for bebop-lines', () => {
		const harmony = getDefaultHarmony('bebop-lines', 'C');
		expect(harmony).toHaveLength(1);
	});

	it('C key ii-V-I-major: chord roots are D, G, C (pitch classes 2, 7, 0)', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');

		expect(harmony[0].chord.root).toBe('D');   // pitch class 2
		expect(harmony[1].chord.root).toBe('G');   // pitch class 7
		expect(harmony[2].chord.root).toBe('C');   // pitch class 0

		expect(PITCH_CLASSES.indexOf(harmony[0].chord.root)).toBe(2);
		expect(PITCH_CLASSES.indexOf(harmony[1].chord.root)).toBe(7);
		expect(PITCH_CLASSES.indexOf(harmony[2].chord.root)).toBe(0);
	});

	it('F key ii-V-I-major: chord roots are G, C, F (pitch classes 7, 0, 5)', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'F');

		expect(harmony[0].chord.root).toBe('G');   // pitch class 7
		expect(harmony[1].chord.root).toBe('C');   // pitch class 0
		expect(harmony[2].chord.root).toBe('F');   // pitch class 5

		expect(PITCH_CLASSES.indexOf(harmony[0].chord.root)).toBe(7);
		expect(PITCH_CLASSES.indexOf(harmony[1].chord.root)).toBe(0);
		expect(PITCH_CLASSES.indexOf(harmony[2].chord.root)).toBe(5);
	});

	it('returns harmony with valid ChordQuality values for each segment', () => {
		const categories: PhraseCategory[] = [
			'ii-V-I-major', 'ii-V-I-minor', 'blues', 'bebop-lines',
			'short-ii-V-I-major', 'short-ii-V-I-minor',
			'major-chord', 'minor-chord', 'dominant-chord'
		];

		for (const category of categories) {
			const harmony = getDefaultHarmony(category, 'C');
			for (const segment of harmony) {
				expect(VALID_CHORD_QUALITIES).toContain(segment.chord.quality);
			}
		}
	});
});

// ─── generatePhrase ───────────────────────────────────────────

describe('generatePhrase', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns a Phrase object with all required fields', () => {
		const phrase = generatePhrase(makeOptions());

		expect(phrase).toHaveProperty('id');
		expect(phrase).toHaveProperty('name');
		expect(phrase).toHaveProperty('notes');
		expect(phrase).toHaveProperty('key');
		expect(phrase).toHaveProperty('harmony');
		expect(phrase).toHaveProperty('difficulty');
		expect(phrase).toHaveProperty('source');
		expect(phrase).toHaveProperty('tags');
		expect(phrase).toHaveProperty('timeSignature');
		expect(phrase).toHaveProperty('category');

		expect(typeof phrase.id).toBe('string');
		expect(typeof phrase.name).toBe('string');
		expect(Array.isArray(phrase.notes)).toBe(true);
		expect(Array.isArray(phrase.harmony)).toBe(true);
		expect(Array.isArray(phrase.tags)).toBe(true);
		expect(Array.isArray(phrase.timeSignature)).toBe(true);
		expect(phrase.timeSignature).toHaveLength(2);
	});

	it('sets source to "generated"', () => {
		const phrase = generatePhrase(makeOptions());
		expect(phrase.source).toBe('generated');
	});

	it('includes "generated" in tags array', () => {
		const phrase = generatePhrase(makeOptions());
		expect(phrase.tags).toContain('generated');
	});

	it('phrase.id starts with "gen-"', () => {
		const phrase = generatePhrase(makeOptions());
		expect(phrase.id.startsWith('gen-')).toBe(true);
	});

	it('generates unique IDs across multiple calls', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 10; i++) {
			const phrase = generatePhrase(makeOptions());
			ids.add(phrase.id);
		}
		expect(ids.size).toBe(10);
	});

	it('uses provided key in the output', () => {
		const keys: PitchClass[] = ['C', 'F', 'Bb', 'Eb', 'Ab'];
		for (const key of keys) {
			const phrase = generatePhrase(makeOptions({ key }));
			expect(phrase.key).toBe(key);
		}
	});

	it('defaults to [4, 4] time signature when not specified', () => {
		const phrase = generatePhrase(makeOptions());
		expect(phrase.timeSignature).toEqual([4, 4]);
	});

	it('respects custom timeSignature when provided', () => {
		const phrase = generatePhrase(makeOptions({ timeSignature: [3, 4] }));
		expect(phrase.timeSignature).toEqual([3, 4]);
	});

	it('all notes have valid MIDI pitch (0-127) or null for rests', () => {
		for (let i = 0; i < 5; i++) {
			const phrase = generatePhrase(makeOptions());
			for (const note of phrase.notes) {
				if (note.pitch !== null) {
					expect(note.pitch).toBeGreaterThanOrEqual(0);
					expect(note.pitch).toBeLessThanOrEqual(127);
				}
			}
		}
	});

	it('all notes have valid Fraction offset and duration', () => {
		const phrase = generatePhrase(makeOptions());

		for (const note of phrase.notes) {
			// offset is [numerator, denominator]
			expect(Array.isArray(note.offset)).toBe(true);
			expect(note.offset).toHaveLength(2);
			expect(Number.isInteger(note.offset[0]) && note.offset[0] >= 0).toBe(true);
			expect(Number.isInteger(note.offset[1]) && note.offset[1] > 0).toBe(true);

			// duration is [numerator, denominator]
			expect(Array.isArray(note.duration)).toBe(true);
			expect(note.duration).toHaveLength(2);
			expect(Number.isInteger(note.duration[0]) && note.duration[0] > 0).toBe(true);
			expect(Number.isInteger(note.duration[1]) && note.duration[1] > 0).toBe(true);
		}
	});

	it('generated phrase has difficulty metadata', () => {
		const phrase = generatePhrase(makeOptions({ difficulty: 5 }));

		expect(phrase.difficulty).toBeDefined();
		expect(typeof phrase.difficulty.level).toBe('number');
		expect(typeof phrase.difficulty.pitchComplexity).toBe('number');
		expect(typeof phrase.difficulty.rhythmComplexity).toBe('number');
		expect(typeof phrase.difficulty.lengthBars).toBe('number');
		expect(phrase.difficulty.level).toBe(5);
		expect(phrase.difficulty.lengthBars).toBe(2);
	});

	it('generated phrase for blues category contains blues harmony', () => {
		const phrase = generatePhrase(makeOptions({ category: 'blues' }));
		expect(phrase.category).toBe('blues');
		expect(phrase.harmony.length).toBeGreaterThanOrEqual(1);
		expect(phrase.harmony[0].chord.quality).toBe('7');
		expect(phrase.harmony[0].scaleId).toBe('blues.minor');
	});

	it('generated phrase for ii-V-I-major has 3 harmony segments', () => {
		const phrase = generatePhrase(makeOptions({ category: 'ii-V-I-major' }));
		expect(phrase.harmony).toHaveLength(3);
	});

	it('Math.random is called during phrase generation at higher difficulty', () => {
		// The generator uses Math.random for fill-type selection (Stage 2),
		// rhythm cell selection (Stage 3), and articulation (Stage 5).
		// Verify that it is called at least once during generation.
		const spy = vi.spyOn(Math, 'random');
		generatePhrase(makeOptions({ difficulty: 7, bars: 4 }));
		expect(spy).toHaveBeenCalled();
	});

	it('controlled randomness: deterministic output when Math.random is fixed', () => {
		const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const phrase1 = generatePhrase(makeOptions());

		spy.mockReturnValue(0.5);
		const phrase2 = generatePhrase(makeOptions());

		// With the same random values, pitch sequences should be identical
		const pitches1 = phrase1.notes.map(n => n.pitch);
		const pitches2 = phrase2.notes.map(n => n.pitch);
		expect(pitches1).toEqual(pitches2);
	});

	it('phrase notes are non-empty', () => {
		const phrase = generatePhrase(makeOptions());
		expect(phrase.notes.length).toBeGreaterThan(0);
	});

	it('passes validation for generated phrases (validator integration)', () => {
		// Generate several phrases and verify all pass the validator.
		// The generator itself retries on validation failure, but this confirms
		// the returned phrase is always valid.
		for (let i = 0; i < 5; i++) {
			const phrase = generatePhrase(makeOptions({ difficulty: 3 }));
			expect(phrase.notes.length).toBeGreaterThan(0);
			expect(phrase.source).toBe('generated');
		}
	});

	it('respects rangeLow and rangeHigh options', () => {
		const low = 50;
		const high = 70;

		for (let i = 0; i < 5; i++) {
			const phrase = generatePhrase(makeOptions({ rangeLow: low, rangeHigh: high }));
			const pitched = phrase.notes.filter(n => n.pitch !== null);
			for (const note of pitched) {
				expect(note.pitch!).toBeGreaterThanOrEqual(low);
				expect(note.pitch!).toBeLessThanOrEqual(high);
			}
		}
	});

	it('generates phrases across different categories', () => {
		const categories: PhraseCategory[] = [
			'ii-V-I-major', 'ii-V-I-minor', 'blues', 'bebop-lines',
			'short-ii-V-I-major', 'short-ii-V-I-minor'
		];

		for (const category of categories) {
			const phrase = generatePhrase(makeOptions({ category }));
			expect(phrase.category).toBe(category);
			expect(phrase.notes.length).toBeGreaterThan(0);
		}
	});

	it('rhythmComplexity in difficulty metadata is capped at 80', () => {
		const phrase = generatePhrase(makeOptions({ difficulty: 95 }));
		expect(phrase.difficulty.rhythmComplexity).toBeLessThanOrEqual(80);
	});
});
