/**
 * Integration tests for the phrase generation pipeline.
 *
 * Tests the full flow: GeneratorOptions → generatePhrase() → Phrase,
 * combiner (scale × rhythm → Phrase), mutator transformations,
 * difficulty calculation, and phrase validation.
 */

import { describe, it, expect } from 'vitest';
import { generatePhrase, getDefaultHarmony } from '../../src/lib/phrases/generator';
import { combine, realizeScalePattern, generateAllCombinations } from '../../src/lib/phrases/combiner';
import { rhythmicDisplacement, retrograde, truncate } from '../../src/lib/phrases/mutator';
import { validatePhrase, rulesForDifficulty, isInRange } from '../../src/lib/phrases/validator';
import { calculateDifficulty } from '../../src/lib/difficulty/calculate';
import { getScale, SCALES } from '../../src/lib/music/scales';
import { SCALE_PATTERNS, RHYTHM_PATTERNS } from '../../src/lib/data/patterns/index';
import type { Phrase, Note, HarmonicSegment } from '../../src/lib/types/music';

// ─── Helpers ───────────────────────────────────────────────────

function makeNote(pitch: number | null, offset: [number, number], duration: [number, number] = [1, 4]): Note {
	return { pitch, offset, duration };
}

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1] as [number, number],
			duration: [1, 1] as [number, number]
		}],
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

// ─── Phrase Generator ──────────────────────────────────────────

describe('phrase generator — end-to-end', () => {
	it('generates a valid phrase for ii-V-I-major in C', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');
		const phrase = generatePhrase({
			key: 'C',
			category: 'ii-V-I-major',
			difficulty: 3,
			harmony,
			bars: 2
		});

		expect(phrase).toBeDefined();
		expect(phrase.key).toBe('C');
		expect(phrase.category).toBe('ii-V-I-major');
		expect(phrase.notes.length).toBeGreaterThan(0);
		expect(phrase.timeSignature).toEqual([4, 4]);
		expect(phrase.harmony.length).toBeGreaterThan(0);
	});

	it('generates phrases for all categories', () => {
		const categories = ['ii-V-I-major', 'ii-V-I-minor', 'blues', 'bebop-lines'] as const;

		for (const category of categories) {
			const harmony = getDefaultHarmony(category, 'C');
			const phrase = generatePhrase({
				key: 'C',
				category,
				difficulty: 3,
				harmony,
				bars: 2
			});

			expect(phrase.notes.length).toBeGreaterThan(0);
			expect(phrase.category).toBe(category);
		}
	});

	it('generates phrases at different difficulty levels', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');

		const easy = generatePhrase({ key: 'C', category: 'ii-V-I-major', difficulty: 1, harmony, bars: 1 });
		const hard = generatePhrase({ key: 'C', category: 'ii-V-I-major', difficulty: 7, harmony, bars: 2 });

		expect(easy.notes.length).toBeGreaterThan(0);
		expect(hard.notes.length).toBeGreaterThan(0);
	});

	it('generates phrases in different keys', () => {
		const keys = ['C', 'F', 'Bb', 'Eb', 'Ab'] as const;

		for (const key of keys) {
			const harmony = getDefaultHarmony('blues', key);
			const phrase = generatePhrase({
				key,
				category: 'blues',
				difficulty: 3,
				harmony,
				bars: 2
			});

			expect(phrase.key).toBe(key);
			expect(phrase.notes.length).toBeGreaterThan(0);
		}
	});

	it('generated phrases have notes within tenor sax range', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');

		for (let i = 0; i < 5; i++) {
			const phrase = generatePhrase({
				key: 'C',
				category: 'ii-V-I-major',
				difficulty: 5,
				harmony,
				bars: 2
			});

			const pitched = phrase.notes.filter(n => n.pitch !== null);
			for (const note of pitched) {
				expect(note.pitch!).toBeGreaterThanOrEqual(44); // Ab2
				expect(note.pitch!).toBeLessThanOrEqual(75);   // Eb5
			}
		}
	});

	it('getDefaultHarmony returns correct chord progressions', () => {
		const major = getDefaultHarmony('ii-V-I-major', 'C');
		expect(major).toHaveLength(3);
		expect(major[0].chord.quality).toBe('min7');   // ii
		expect(major[1].chord.quality).toBe('7');      // V
		expect(major[2].chord.quality).toBe('maj7');   // I

		const minor = getDefaultHarmony('ii-V-I-minor', 'C');
		expect(minor).toHaveLength(3);
		expect(minor[0].chord.quality).toBe('min7b5'); // ii°
		expect(minor[1].chord.quality).toBe('7alt');   // V alt
		expect(minor[2].chord.quality).toBe('min7');   // i

		const blues = getDefaultHarmony('blues', 'C');
		expect(blues).toHaveLength(1);
		expect(blues[0].chord.quality).toBe('7');
	});
});

// ─── Combiner ──────────────────────────────────────────────────

describe('combiner — scale × rhythm', () => {
	it('produces null when note counts do not match', () => {
		const sp = SCALE_PATTERNS[0];
		// Find a rhythm pattern with different note count
		const rp = RHYTHM_PATTERNS.find(r => r.noteCount !== sp.degrees.length);
		if (!rp) return; // skip if all match (unlikely)

		const harmony: HarmonicSegment[] = [{
			chord: { root: 'C', quality: 'maj7' },
			scaleId: 'major.ionian',
			startOffset: [0, 1],
			duration: [1, 1]
		}];

		const result = combine(sp, rp, 'major.ionian', 'C', harmony);
		expect(result).toBeNull();
	});

	it('produces a valid phrase when note counts match', () => {
		// Find a compatible scale + rhythm pair
		let result = null;
		for (const sp of SCALE_PATTERNS) {
			for (const rp of RHYTHM_PATTERNS) {
				if (sp.degrees.length !== rp.noteCount) continue;

				const harmony: HarmonicSegment[] = [{
					chord: { root: 'C', quality: 'maj7' },
					scaleId: 'major.ionian',
					startOffset: [0, 1] as [number, number],
					duration: [1, 1] as [number, number]
				}];

				result = combine(sp, rp, 'major.ionian', 'C', harmony);
				if (result) break;
			}
			if (result) break;
		}

		expect(result).not.toBeNull();
		expect(result!.notes.length).toBeGreaterThan(0);
		expect(result!.notes.every(n => n.pitch !== null)).toBe(true);
		expect(result!.difficulty.level).toBeGreaterThanOrEqual(1);
	});

	it('realizeScalePattern maps degrees to MIDI correctly', () => {
		const pitches = realizeScalePattern([0, 1, 2, 3, 4], 'major.ionian', 'C');
		expect(pitches).not.toBeNull();
		expect(pitches!).toHaveLength(5);

		// C major ascending from root near C4
		// Degrees 0-4 should be C, D, E, F, G (ascending)
		for (let i = 1; i < pitches!.length; i++) {
			expect(pitches![i]).toBeGreaterThan(pitches![i - 1]);
		}
	});

	it('realizeScalePattern returns null for out-of-range degrees', () => {
		// Extreme degrees that would exceed the pool
		const pitches = realizeScalePattern([0, 50], 'major.ionian', 'C');
		expect(pitches).toBeNull();
	});

	it('generateAllCombinations produces multiple phrases', () => {
		const all = generateAllCombinations();
		expect(all.length).toBeGreaterThan(0);

		// Every combined phrase should have computed difficulty
		for (const phrase of all) {
			expect(phrase.difficulty.level).toBeGreaterThanOrEqual(1);
			expect(phrase.notes.length).toBeGreaterThan(0);
			expect(phrase.source).toBe('combined');
		}
	});
});

// ─── Mutator ───────────────────────────────────────────────────

describe('mutator transformations', () => {
	it('rhythmic displacement shifts all offsets by an 8th note', () => {
		const notes = [
			makeNote(60, [0, 1]),
			makeNote(64, [1, 4]),
			makeNote(67, [1, 2]),
		];
		const phrase = makePhrase(notes);

		const displaced = rhythmicDisplacement(phrase);

		expect(displaced.id).toContain('displaced');
		// Each note offset should be shifted by [1, 8]
		// [0,1] + [1,8] = [1,8]
		expect(displaced.notes[0].offset[0] / displaced.notes[0].offset[1])
			.toBeCloseTo(0 + 1 / 8);
	});

	it('retrograde reverses pitch sequence preserving rhythm', () => {
		const notes = [
			makeNote(60, [0, 1]),
			makeNote(64, [1, 4]),
			makeNote(67, [1, 2]),
		];
		const phrase = makePhrase(notes);

		const retro = retrograde(phrase);

		expect(retro.notes[0].pitch).toBe(67);
		expect(retro.notes[1].pitch).toBe(64);
		expect(retro.notes[2].pitch).toBe(60);

		// Rhythm (offsets) should be preserved
		expect(retro.notes[0].offset).toEqual(notes[0].offset);
		expect(retro.notes[1].offset).toEqual(notes[1].offset);
		expect(retro.notes[2].offset).toEqual(notes[2].offset);
	});

	it('truncate reduces note count', () => {
		const notes = Array.from({ length: 8 }, (_, i) =>
			makeNote(60 + i, [i, 4] as [number, number])
		);
		const phrase = makePhrase(notes);

		const truncated = truncate(phrase, 4);

		expect(truncated.notes).toHaveLength(4);
		expect(truncated.id).toContain('trunc');
	});

	it('truncate does not reduce phrases with <= 4 notes', () => {
		const notes = [
			makeNote(60, [0, 1]),
			makeNote(64, [1, 4]),
			makeNote(67, [1, 2]),
		];
		const phrase = makePhrase(notes);

		const result = truncate(phrase);
		expect(result.notes).toHaveLength(3);
	});
});

// ─── Validator ─────────────────────────────────────────────────

describe('phrase validation', () => {
	it('accepts a well-formed phrase within tenor sax range', () => {
		// Notes within default range [44, 75] with stepwise motion
		const notes = [
			makeNote(60, [0, 1]),   // C4
			makeNote(62, [1, 4]),   // D4
			makeNote(60, [1, 2]),   // C4 (direction change)
			makeNote(64, [3, 4]),   // E4
		];
		const phrase = makePhrase(notes);

		const result = validatePhrase(phrase);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('rejects notes outside instrument range', () => {
		const notes = [
			makeNote(30, [0, 1]),  // way below range
			makeNote(90, [1, 4]),  // way above range
		];
		const phrase = makePhrase(notes);

		const result = validatePhrase(phrase);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
	});

	it('rejects excessive interval leaps', () => {
		const notes = [
			makeNote(44, [0, 1]),
			makeNote(75, [1, 4]),  // 31 semitones — way over max
		];
		const phrase = makePhrase(notes);

		const result = validatePhrase(phrase);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('Interval'))).toBe(true);
	});

	it('applies stricter rules at low difficulty', () => {
		const easyRules = rulesForDifficulty(10);
		const hardRules = rulesForDifficulty(90);

		expect(easyRules.maxInterval).toBeLessThan(hardRules.maxInterval!);
		expect(easyRules.maxConsecutiveLeaps).toBeLessThanOrEqual(hardRules.maxConsecutiveLeaps!);
		expect(easyRules.minStepRatio).toBeGreaterThan(hardRules.minStepRatio!);
	});

	it('accepts phrases with < 2 pitched notes without errors', () => {
		const phrase = makePhrase([makeNote(60, [0, 1])]);
		const result = validatePhrase(phrase);
		expect(result.valid).toBe(true);
	});

	it('isInRange checks all pitched notes', () => {
		const notes = [
			makeNote(50, [0, 1]),
			makeNote(null, [1, 4]),
			makeNote(70, [1, 2]),
		];

		expect(isInRange(notes, 44, 75)).toBe(true);
		expect(isInRange(notes, 55, 75)).toBe(false); // 50 < 55
	});
});

// ─── Difficulty Calculation ────────────────────────────────────

describe('difficulty calculation integration', () => {
	it('assigns higher difficulty to complex phrases', () => {
		// Simple: few notes, small intervals, quarter notes
		const simple = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(62, [1, 4]),
			makeNote(64, [1, 2]),
			makeNote(65, [3, 4]),
		]);

		// Complex: many notes, large intervals, fast subdivisions
		const complex = makePhrase([
			makeNote(48, [0, 1], [1, 16]),
			makeNote(60, [1, 16], [1, 16]),
			makeNote(55, [1, 8], [1, 16]),
			makeNote(67, [3, 16], [1, 16]),
			makeNote(50, [1, 4], [1, 16]),
			makeNote(72, [5, 16], [1, 16]),
			makeNote(53, [3, 8], [1, 16]),
			makeNote(65, [7, 16], [1, 16]),
			makeNote(48, [1, 2], [1, 16]),
			makeNote(71, [9, 16], [1, 16]),
		]);

		const simpleDiff = calculateDifficulty(simple);
		const complexDiff = calculateDifficulty(complex);

		expect(complexDiff.level).toBeGreaterThan(simpleDiff.level);
		expect(complexDiff.pitchComplexity).toBeGreaterThan(simpleDiff.pitchComplexity);
		expect(complexDiff.rhythmComplexity).toBeGreaterThan(simpleDiff.rhythmComplexity);
	});

	it('returns difficulty metadata with all required fields', () => {
		const phrase = makePhrase([
			makeNote(60, [0, 1]),
			makeNote(64, [1, 4]),
			makeNote(67, [1, 2]),
		]);

		const diff = calculateDifficulty(phrase);

		expect(diff.level).toBeGreaterThanOrEqual(1);
		expect(diff.level).toBeLessThanOrEqual(100);
		expect(diff.pitchComplexity).toBeGreaterThanOrEqual(1);
		expect(diff.pitchComplexity).toBeLessThanOrEqual(100);
		expect(diff.rhythmComplexity).toBeGreaterThanOrEqual(1);
		expect(diff.rhythmComplexity).toBeLessThanOrEqual(100);
		expect(diff.lengthBars).toBeGreaterThanOrEqual(1);
	});

	it('chromatic phrases score higher pitch complexity', () => {
		// Diatonic: C major scale
		const diatonic = makePhrase([
			makeNote(60, [0, 1]),  // C
			makeNote(62, [1, 4]),  // D
			makeNote(64, [1, 2]),  // E
			makeNote(65, [3, 4]),  // F
			makeNote(67, [1, 1]),  // G
		]);

		// Chromatic: non-diatonic notes
		const chromatic = makePhrase([
			makeNote(60, [0, 1]),  // C
			makeNote(61, [1, 4]),  // Db
			makeNote(63, [1, 2]),  // Eb
			makeNote(66, [3, 4]),  // F#
			makeNote(68, [1, 1]),  // Ab
		]);

		const diatonicDiff = calculateDifficulty(diatonic);
		const chromaticDiff = calculateDifficulty(chromatic);

		expect(chromaticDiff.pitchComplexity).toBeGreaterThan(diatonicDiff.pitchComplexity);
	});
});
