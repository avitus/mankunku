import { describe, it, expect } from 'vitest';
import { realizeScalePattern, combine, generateAllCombinations, COMBINED_LICKS } from '$lib/phrases/combiner';
import { SCALE_PATTERNS, RHYTHM_PATTERNS } from '$lib/data/patterns/index';
import type { HarmonicSegment } from '$lib/types/music';

const CMAJ_HARMONY: HarmonicSegment[] = [{
	chord: { root: 'C', quality: 'maj7' },
	scaleId: 'major.ionian',
	startOffset: [0, 1],
	duration: [1, 1]
}];

describe('realizeScalePattern', () => {
	it('produces correct MIDI for major scale degrees', () => {
		// Ionian: C(0) D(1) E(2) F(3) G(4) A(5) B(6) — root at C4=60
		const pitches = realizeScalePattern([0, 2, 4, 6], 'major.ionian', 'C');
		expect(pitches).toEqual([60, 64, 67, 71]); // C4 E4 G4 B4
	});

	it('produces correct MIDI for pentatonic scale', () => {
		// Major pent: C(0) D(1) E(2) G(3) A(4) — root at C4=60
		const pitches = realizeScalePattern([0, 1, 2, 3, 4], 'pentatonic.major', 'C');
		expect(pitches).toEqual([60, 62, 64, 67, 69]); // C4 D4 E4 G4 A4
	});

	it('produces correct MIDI for blues scale', () => {
		// Minor blues: C(0) Eb(1) F(2) F#(3) G(4) Bb(5) — root at C4=60
		const pitches = realizeScalePattern([0, 1, 2, 3, 4], 'blues.minor', 'C');
		expect(pitches).toEqual([60, 63, 65, 66, 67]); // C4 Eb4 F4 F#4 G4
	});

	it('handles negative degrees (below root)', () => {
		// degree -1 on major = B3 (scale tone below C4)
		const pitches = realizeScalePattern([-1, 0, 1], 'major.ionian', 'C');
		expect(pitches).toEqual([59, 60, 62]); // B3 C4 D4
	});

	it('handles octave wrapping for 5-note scales', () => {
		// degree 5 on pentatonic = C5 (wraps to next octave root)
		const pitches = realizeScalePattern([0, 5], 'pentatonic.major', 'C');
		expect(pitches).toEqual([60, 72]); // C4 C5
	});

	it('handles octave wrapping for 7-note scales', () => {
		// degree 7 on major = C5 (next octave root)
		const pitches = realizeScalePattern([0, 7], 'major.ionian', 'C');
		expect(pitches).toEqual([60, 72]); // C4 C5
	});

	it('returns null for unknown scale', () => {
		expect(realizeScalePattern([0, 1, 2], 'nonexistent.scale', 'C')).toBeNull();
	});

	it('works with non-C keys', () => {
		// G major: G(0) A(1) B(2) C(3) D(4)... root near G3=55 or G4=67
		// Root closest to 60 → G3=55 (dist 5) vs G4=67 (dist 7) → picks G3
		const pitches = realizeScalePattern([0, 2, 4], 'major.ionian', 'G');
		expect(pitches).not.toBeNull();
		// G root closest to 60 is 55 (G3, 5 away) or 67 (G4, 7 away) → 55
		expect(pitches![0]).toBe(55); // G3
		expect(pitches![1]).toBe(59); // B3
		expect(pitches![2]).toBe(62); // D4
	});
});

describe('combine', () => {
	const sp3 = SCALE_PATTERNS.find(p => p.degrees.length === 3 && p.category === 'ii-V-I-major')!;
	const rp3 = RHYTHM_PATTERNS.find(p => p.noteCount === 3)!;
	const rp4 = RHYTHM_PATTERNS.find(p => p.noteCount === 4)!;

	it('returns a Phrase for matching note counts', () => {
		const phrase = combine(sp3, rp3, 'major.ionian', 'C', CMAJ_HARMONY);
		expect(phrase).not.toBeNull();
		expect(phrase!.notes).toHaveLength(3);
		expect(phrase!.id).toMatch(/^cmb-/);
		expect(phrase!.source).toBe('combined');
	});

	it('returns null for mismatched note counts', () => {
		const phrase = combine(sp3, rp4, 'major.ionian', 'C', CMAJ_HARMONY);
		expect(phrase).toBeNull();
	});

	it('returns null when scale family is incompatible', () => {
		// sp-pent-triad-up requires pentatonic family
		const pentSp = SCALE_PATTERNS.find(p => p.id === 'sp-pent-triad-up')!;
		const phrase = combine(pentSp, rp3, 'major.ionian', 'C', CMAJ_HARMONY);
		expect(phrase).toBeNull();
	});

	it('generates correct note pitches and timing', () => {
		const phrase = combine(sp3, rp3, 'major.ionian', 'C', CMAJ_HARMONY);
		expect(phrase).not.toBeNull();
		// All notes should have valid MIDI pitches
		for (const note of phrase!.notes) {
			expect(note.pitch).toBeGreaterThanOrEqual(36);
			expect(note.pitch).toBeLessThanOrEqual(96);
		}
		// Offsets should match rhythm pattern slots
		for (let i = 0; i < rp3.slots.length; i++) {
			expect(phrase!.notes[i].offset).toEqual(rp3.slots[i].offset);
			expect(phrase!.notes[i].duration).toEqual(rp3.slots[i].duration);
		}
	});
});

describe('generateAllCombinations', () => {
	it('produces phrases for all valid scale × rhythm pairs', () => {
		const phrases = generateAllCombinations();
		expect(phrases.length).toBeGreaterThan(0);

		// Count expected: for each scale pattern, count rhythm patterns with matching noteCount
		let expectedCount = 0;
		for (const sp of SCALE_PATTERNS) {
			for (const rp of RHYTHM_PATTERNS) {
				if (sp.degrees.length === rp.noteCount) expectedCount++;
			}
		}
		// Actual may be <= expected due to family compatibility filtering
		expect(phrases.length).toBeLessThanOrEqual(expectedCount);
		expect(phrases.length).toBeGreaterThan(expectedCount * 0.5); // at least half should pass
	});

	it('all phrases have valid difficulty metadata', () => {
		const phrases = generateAllCombinations();
		for (const p of phrases) {
			expect(p.difficulty.level).toBeGreaterThanOrEqual(1);
			expect(p.difficulty.level).toBeLessThanOrEqual(100);
			expect(p.difficulty.pitchComplexity).toBeGreaterThanOrEqual(1);
			expect(p.difficulty.rhythmComplexity).toBeGreaterThanOrEqual(1);
			expect(p.difficulty.lengthBars).toBeGreaterThanOrEqual(1);
		}
	});

	it('all phrases have unique IDs', () => {
		const phrases = generateAllCombinations();
		const ids = phrases.map(p => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('all phrases have standard Phrase shape', () => {
		const phrases = generateAllCombinations();
		for (const p of phrases) {
			expect(p.id).toMatch(/^cmb-/);
			expect(p.source).toBe('combined');
			expect(p.key).toBe('C');
			expect(p.timeSignature).toEqual([4, 4]);
			expect(p.harmony.length).toBeGreaterThan(0);
			expect(p.notes.length).toBeGreaterThan(0);
			expect(p.tags).toContain('combined');
		}
	});
});

describe('COMBINED_LICKS', () => {
	it('is pre-generated and non-empty', () => {
		expect(COMBINED_LICKS.length).toBeGreaterThan(50);
	});

	it('contains phrases across multiple categories', () => {
		const categories = new Set(COMBINED_LICKS.map(p => p.category));
		expect(categories.size).toBeGreaterThanOrEqual(3);
	});

	it('contains phrases at varying difficulty levels', () => {
		const levels = COMBINED_LICKS.map(p => p.difficulty.level);
		const minLevel = Math.min(...levels);
		const maxLevel = Math.max(...levels);
		expect(maxLevel - minLevel).toBeGreaterThan(5);
	});
});
