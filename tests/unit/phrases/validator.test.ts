import { describe, it, expect } from 'vitest';
import { validatePhrase, isChordTone, isInRange, rulesForDifficulty } from '$lib/phrases/validator.ts';
import type { Phrase, Note, Fraction, HarmonicSegment } from '$lib/types/music.ts';

function makeNote(pitch: number | null, offset: Fraction = [0, 1], duration: Fraction = [1, 4]): Note {
	return { pitch, offset, duration };
}

const defaultHarmony: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: 'maj7' }, startOffset: [0, 1], duration: [2, 1] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'Test',
		timeSignature: [4, 4] as [number, number],
		key: 'C',
		notes,
		harmony: defaultHarmony,
		difficulty: { level: 10, pitchComplexity: 10, rhythmComplexity: 10, lengthBars: 1 },
		category: 'ii-V-I-major',
		tags: [],
		source: 'curated'
	};
}

describe('validatePhrase', () => {
	it('valid stepwise phrase passes', () => {
		const phrase = makePhrase([
			makeNote(60), makeNote(62), makeNote(64), makeNote(62), makeNote(60)
		]);
		const result = validatePhrase(phrase);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('phrase with < 2 pitched notes is always valid', () => {
		const phrase = makePhrase([makeNote(60)]);
		expect(validatePhrase(phrase).valid).toBe(true);
	});

	it('phrase with only rests is always valid', () => {
		const phrase = makePhrase([makeNote(null), makeNote(null)]);
		expect(validatePhrase(phrase).valid).toBe(true);
	});

	it('rejects note out of range', () => {
		const phrase = makePhrase([
			makeNote(30), // below 44 (Ab2)
			makeNote(60)
		]);
		const result = validatePhrase(phrase);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('out of range'))).toBe(true);
	});

	it('rejects interval exceeding maxInterval', () => {
		const phrase = makePhrase([
			makeNote(48),
			makeNote(48 + 15) // 15 semitones > default max 14
		]);
		const result = validatePhrase(phrase);
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('exceeds max'))).toBe(true);
	});

	it('rejects too many consecutive leaps', () => {
		// 5 consecutive large leaps (> 2 semitones each)
		const phrase = makePhrase([
			makeNote(48), makeNote(55), makeNote(48), makeNote(55), makeNote(48), makeNote(55)
		]);
		const result = validatePhrase(phrase, { maxConsecutiveLeaps: 1 });
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('consecutive leaps'))).toBe(true);
	});

	it('rejects step ratio below minimum', () => {
		// All large intervals, no steps
		const phrase = makePhrase([
			makeNote(48), makeNote(55), makeNote(62), makeNote(69)
		]);
		const result = validatePhrase(phrase, { minStepRatio: 0.9 });
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('Step ratio'))).toBe(true);
	});

	it('rejects missing leap recovery', () => {
		// Large leap (7+) followed by another leap in the same direction
		const phrase = makePhrase([
			makeNote(48),
			makeNote(60),  // +12 leap up
			makeNote(67)   // +7 leap up (same direction, no step recovery)
		]);
		const result = validatePhrase(phrase, { leapRecovery: true, leapRecoveryThreshold: 7 });
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('leap recovery'))).toBe(true);
	});

	it('accepts leap recovery when step follows in opposite direction', () => {
		const phrase = makePhrase([
			makeNote(48),
			makeNote(60),  // +12 leap up
			makeNote(59)   // -1 step down (recovery)
		]);
		const result = validatePhrase(phrase, { leapRecovery: true, leapRecoveryThreshold: 7 });
		// No leap recovery error
		expect(result.errors.filter(e => e.includes('leap recovery'))).toHaveLength(0);
	});

	it('custom rules override defaults', () => {
		const phrase = makePhrase([
			makeNote(30), // below default range [44, 75]
			makeNote(35)
		]);
		// Custom range allows these notes
		const result = validatePhrase(phrase, { range: [20, 80] });
		expect(result.errors.filter(e => e.includes('out of range'))).toHaveLength(0);
	});

	it('checks direction changes', () => {
		// Monotone ascending — no direction changes
		const phrase = makePhrase([
			makeNote(60), makeNote(62), makeNote(64), makeNote(65), makeNote(67)
		]);
		const result = validatePhrase(phrase, { minDirectionChanges: 2 });
		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('direction changes'))).toBe(true);
	});
});

describe('isChordTone', () => {
	it('C (60) is a chord tone of Cmaj7 [60,64,67,71]', () => {
		expect(isChordTone(60, [60, 64, 67, 71])).toBe(true);
	});

	it('D (62) is not a chord tone of Cmaj7', () => {
		expect(isChordTone(62, [60, 64, 67, 71])).toBe(false);
	});

	it('works across octaves (C4=60 matches C5=72)', () => {
		expect(isChordTone(72, [60, 64, 67, 71])).toBe(true);
	});

	it('Eb (63) is a chord tone of Cm7 [60,63,67,70]', () => {
		expect(isChordTone(63, [60, 63, 67, 70])).toBe(true);
	});
});

describe('isInRange', () => {
	it('all notes in range → true', () => {
		const notes = [makeNote(50), makeNote(60), makeNote(70)];
		expect(isInRange(notes, 44, 75)).toBe(true);
	});

	it('note below range → false', () => {
		const notes = [makeNote(40), makeNote(60)];
		expect(isInRange(notes, 44, 75)).toBe(false);
	});

	it('note above range → false', () => {
		const notes = [makeNote(60), makeNote(80)];
		expect(isInRange(notes, 44, 75)).toBe(false);
	});

	it('rests (null pitch) always pass', () => {
		const notes = [makeNote(null), makeNote(60)];
		expect(isInRange(notes, 44, 75)).toBe(true);
	});
});

describe('rulesForDifficulty', () => {
	it('level 1 returns strictest rules', () => {
		const rules = rulesForDifficulty(1);
		expect(rules.maxInterval).toBe(5);
		expect(rules.maxConsecutiveLeaps).toBe(1);
	});

	it('level 20 returns same as level 1 (boundary)', () => {
		expect(rulesForDifficulty(20).maxInterval).toBe(5);
	});

	it('level 21 relaxes rules', () => {
		expect(rulesForDifficulty(21).maxInterval).toBe(7);
	});

	it('level 100 returns loosest rules', () => {
		const rules = rulesForDifficulty(100);
		expect(rules.maxInterval).toBe(14);
		expect(rules.maxConsecutiveLeaps).toBe(3);
	});

	it('boundaries at 40, 60, 80', () => {
		expect(rulesForDifficulty(40).maxInterval).toBe(7);
		expect(rulesForDifficulty(41).maxInterval).toBe(10);
		expect(rulesForDifficulty(60).maxInterval).toBe(10);
		expect(rulesForDifficulty(61).maxInterval).toBe(12);
		expect(rulesForDifficulty(80).maxInterval).toBe(12);
		expect(rulesForDifficulty(81).maxInterval).toBe(14);
	});
});
