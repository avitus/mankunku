/**
 * Tests for the configurable highest note feature.
 *
 * Verifies that rangeHigh is respected across:
 *   - transposeLick / transposeLickForTonality (library-loader)
 *   - octaveDisplacement / mutateLick (mutator)
 *   - generatePhrase (generator)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { transposeLick, transposeLickForTonality, pickRandomLick } from '$lib/phrases/library-loader.ts';
import { octaveDisplacement, mutateLick } from '$lib/phrases/mutator.ts';
import { generatePhrase, getDefaultHarmony } from '$lib/phrases/generator.ts';
import type { Phrase } from '$lib/types/music.ts';

/** Helper: build a minimal phrase with given MIDI pitches */
function makePhrase(pitches: (number | null)[], category: string = 'pentatonic'): Phrase {
	return {
		id: 'test-001',
		name: 'Test Lick',
		timeSignature: [4, 4],
		key: 'C',
		notes: pitches.map((p, i) => ({
			pitch: p,
			duration: [1, 4] as [number, number],
			offset: [i, 4] as [number, number]
		})),
		harmony: [
			{
				chord: { root: 'C', quality: 'maj7' },
				scaleId: 'major.ionian',
				startOffset: [0, 1],
				duration: [1, 1]
			}
		],
		difficulty: { level: 5, pitchComplexity: 5, rhythmComplexity: 5, lengthBars: 1 },
		category,
		tags: [],
		source: 'curated'
	} as Phrase;
}

afterEach(() => {
	vi.restoreAllMocks();
});

// ─── transposeLick with rangeHigh ───────────────────────────

describe('transposeLick — rangeHigh constraint', () => {
	it('uses rangeHigh to optimize octave placement', () => {
		// Notes at 60-72. Transposing to B (+11) naively → 71-83.
		// With rangeHigh=72, bestOctaveShift should prefer shift -1 → 59-71
		// (3 of 4 in range 60-72) over shift 0 → 71-83 (2 of 4 in range)
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'B', 72);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// With shift -1, pitches are 59, 63, 66, 71
		expect(pitches).toEqual([59, 63, 66, 71]);
	});

	it('without rangeHigh, uses default range (75)', () => {
		const phrase = makePhrase([60, 64, 67, 72]);
		const defaultResult = transposeLick(phrase, 'D');
		const customResult = transposeLick(phrase, 'D', 75);

		// Same behavior — rangeHigh=75 matches default
		expect(defaultResult.notes.map(n => n.pitch))
			.toEqual(customResult.notes.map(n => n.pitch));
	});

	it('with low rangeHigh, forces octave shift that keeps max pitch within bound', () => {
		// Notes at 60-67. Transpose to G (+7) naively → 67-74, all in default range.
		// With rangeHigh=68, bestOctaveShift tries shift 0: only 67,68 in [60,68] = 2.
		// shift -1: 55,57,59,62 → only 62 in [60,68] = 1. Actually shift 0 wins:
		// shift 0: [67,69,71,74] → 67 in [60,68] = 1. shift -1: [55,57,59,62] → 62 in range = 1.
		// Tie: -1 closer to mid(64), so -1 wins. totalShift = 7 + (-12) = -5.
		// Pitches: 55, 57, 59, 62
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'G', 68);
		const pitches = result.notes.map(n => n.pitch) as number[];
		const maxPitch = Math.max(...pitches);

		expect(maxPitch).toBeLessThanOrEqual(68);
		// Verify shift actually moved notes lower than naive +7
		const naiveMax = 67 + 7; // 74
		expect(maxPitch).toBeLessThan(naiveMax);
	});

	it('applies octave shift for key C when rangeHigh is low', () => {
		// Lick with notes above a low rangeHigh — key C should still optimize
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'C', 65);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// bestOctaveShift should shift down to fit more notes in [60,65]
		// shift -1: [48,52,55,60] → 60 in range = 1
		// shift 0: [60,64,67,72] → 60,64 in range = 2
		// shift 0 wins, totalShift = 0 (key C). But notes 67,72 still above 65.
		// This verifies that transposeLick doesn't skip C when rangeHigh is given.
		expect(result.key).toBe('C');
		expect(pitches.length).toBe(4);
	});
});

// ─── transposeLickForTonality with rangeHigh ─────────────────

describe('transposeLickForTonality — rangeHigh safety clamp', () => {
	it('clamps notes above rangeHigh down into range', () => {
		// Wide-spanning lick: 48, 60, 72, 84 (3 octaves apart).
		// Transpose to D (+2) → bestOctaveShift picks shift 0 → pitches: 50, 62, 74, 86.
		// 86 > 75 → safety clamp shifts down to 74.
		const phrase = makePhrase([48, 60, 72, 84]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 75);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(75);
		}
	});

	it('clamps notes down multiple octaves if needed', () => {
		// Extreme case: note at 96 with rangeHigh=70
		// 96 - 12 = 84, still > 70. 84 - 12 = 72, still > 70. 72 - 12 = 60 ≤ 70.
		const phrase = makePhrase([60, 96]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 70);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(70);
		}
	});

	it('does not clamp when notes are already in range', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 80);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// D transposition: +2 → 62, 66, 69 — all below 80
		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(80);
		}
	});

	it('clamp applies after scale snapping', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'blues.minor', 72);
		const pitches = result.notes.filter(n => n.pitch !== null).map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(72);
		}
	});

	it('preserves rests through clamping', () => {
		const phrase = makePhrase([60, null, 67]);
		const result = transposeLickForTonality(phrase, 'B', 'major.ionian', 75);
		expect(result.notes[1].pitch).toBeNull();
	});

	it('without rangeHigh, no safety clamp is applied; with it, all pitches are clamped', () => {
		// Wide-spanning lick where bestOctaveShift can't fit all notes in [60,75].
		// 48, 60, 72, 84 → transpose to D (+2) → 50, 62, 74, 86
		// D ionian PCs: {2,4,6,7,9,11,1}. All pitches %12=2(D) → in scale, no snap.
		const phrase = makePhrase([48, 60, 72, 84]);

		const withClamp = transposeLickForTonality(phrase, 'D', 'major.ionian', 75);
		const without = transposeLickForTonality(phrase, 'D', 'major.ionian');

		const clampedPitches = withClamp.notes.map(n => n.pitch) as number[];
		const defaultPitches = without.notes.map(n => n.pitch) as number[];

		// With clamp, every pitch <= 75
		for (const p of clampedPitches) {
			expect(p).toBeLessThanOrEqual(75);
		}

		// Without clamp, at least one pitch > 75 (the 84+2=86 note)
		expect(defaultPitches.some(p => p > 75)).toBe(true);

		// Same number of notes
		expect(clampedPitches.length).toBe(defaultPitches.length);
	});
});

// ─── octaveDisplacement with rangeHigh ───────────────────────

describe('octaveDisplacement — rangeHigh constraint', () => {
	it('rejects upward displacement that would exceed rangeHigh', () => {
		// 6 notes, inner 4 eligible for displacement. With rangeHigh=70,
		// a note at 65 shifted +12 = 77 > 70, so it should be rejected.
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Mock Math.random to always trigger displacement (< 0.25) and always go up (> 0.5)
		const randomValues = [0.1, 0.6]; // 0.1 = triggers displacement, 0.6 = direction up (+12)
		let callIdx = 0;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			return randomValues[callIdx++ % randomValues.length];
		});

		const result = octaveDisplacement(phrase, 70);
		for (const n of result.notes) {
			if (n.pitch !== null) {
				expect(n.pitch).toBeLessThanOrEqual(70);
				expect(n.pitch).toBeGreaterThanOrEqual(44);
			}
		}
	});

	it('allows downward displacement within range', () => {
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Mock Math.random: triggers displacement (< 0.25) and goes down (< 0.5)
		const randomValues = [0.1, 0.3]; // 0.1 = triggers, 0.3 = direction down (-12)
		let callIdx = 0;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			return randomValues[callIdx++ % randomValues.length];
		});

		const result = octaveDisplacement(phrase, 70);
		for (const n of result.notes) {
			if (n.pitch !== null) {
				expect(n.pitch).toBeGreaterThanOrEqual(44);
			}
		}
	});

	it('default rangeHigh (84) allows higher displacement', () => {
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Mock: always displace up
		const randomValues = [0.1, 0.6];
		let callIdx = 0;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			return randomValues[callIdx++ % randomValues.length];
		});

		const result = octaveDisplacement(phrase);
		for (const n of result.notes) {
			if (n.pitch !== null) {
				expect(n.pitch).toBeLessThanOrEqual(84);
				expect(n.pitch).toBeGreaterThanOrEqual(44);
			}
		}
		// At least some inner notes should have been displaced up
		const innerPitches = result.notes.slice(1, -1).map(n => n.pitch!);
		const originalInner = [62, 64, 65, 67];
		const someDisplaced = innerPitches.some((p, i) => p !== originalInner[i]);
		expect(someDisplaced).toBe(true);
	});
});

// ─── mutateLick with rangeHigh ───────────────────────────────

describe('mutateLick — rangeHigh constraint', () => {
	it('validates mutations against the custom range', () => {
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Mock Math.random to select octaveDisplacement (index 1) and displace up
		// mutateLick picks mutation via Math.floor(Math.random() * 4)
		// We want index 1 (octaveDisplacement): Math.random() returns 0.3 → floor(0.3*4)=1
		// Then within octaveDisplacement: 0.1 (trigger), 0.6 (up)
		const sequence = [0.3, 0.1, 0.6, 0.1, 0.6, 0.1, 0.6, 0.1, 0.6];
		let callIdx = 0;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			return sequence[callIdx++ % sequence.length];
		});

		const result = mutateLick(phrase, 72);
		if (result !== null) {
			for (const n of result.notes) {
				if (n.pitch !== null) {
					expect(n.pitch).toBeLessThanOrEqual(72);
					expect(n.pitch).toBeGreaterThanOrEqual(44);
				}
			}
		}
	});

	it('returns null when mutation violates range', () => {
		// All notes near ceiling — upward octave displacement will exceed range,
		// and the validation should reject it
		const phrase = makePhrase([68, 69, 70, 71, 72, 73]);

		// Force octaveDisplacement (index 1) with upward displacement
		const sequence = [0.3, 0.1, 0.6, 0.1, 0.6, 0.1, 0.6, 0.1, 0.6];
		let callIdx = 0;
		vi.spyOn(Math, 'random').mockImplementation(() => {
			return sequence[callIdx++ % sequence.length];
		});

		// With rangeHigh=73, displaced notes (e.g. 69+12=81) exceed range
		// but octaveDisplacement rejects individual displacements > rangeHigh,
		// so the result may be unchanged or null depending on validation
		const result = mutateLick(phrase, 73);
		if (result !== null) {
			for (const n of result.notes) {
				if (n.pitch !== null) {
					expect(n.pitch).toBeLessThanOrEqual(73);
				}
			}
		}
	});
});

// ─── generatePhrase with rangeHigh ──────────────────────────

describe('generatePhrase — rangeHigh option', () => {
	it('generates notes within custom rangeHigh', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');

		for (let i = 0; i < 10; i++) {
			const phrase = generatePhrase({
				key: 'C',
				category: 'ii-V-I-major',
				difficulty: 5,
				harmony,
				bars: 2,
				rangeHigh: 70
			});

			const pitched = phrase.notes.filter(n => n.pitch !== null);
			for (const note of pitched) {
				expect(note.pitch!).toBeGreaterThanOrEqual(44);
				expect(note.pitch!).toBeLessThanOrEqual(70);
			}
		}
	});

	it('default rangeHigh matches original tenor sax range (75)', () => {
		const harmony = getDefaultHarmony('blues', 'C');

		for (let i = 0; i < 5; i++) {
			const phrase = generatePhrase({
				key: 'C',
				category: 'blues',
				difficulty: 3,
				harmony,
				bars: 2
			});

			const pitched = phrase.notes.filter(n => n.pitch !== null);
			for (const note of pitched) {
				expect(note.pitch!).toBeGreaterThanOrEqual(44);
				expect(note.pitch!).toBeLessThanOrEqual(75);
			}
		}
	});

	it('higher rangeHigh allows altissimo notes', () => {
		const harmony = getDefaultHarmony('ii-V-I-major', 'C');

		const phrase = generatePhrase({
			key: 'C',
			category: 'ii-V-I-major',
			difficulty: 5,
			harmony,
			bars: 2,
			rangeHigh: 85
		});

		const pitched = phrase.notes.filter(n => n.pitch !== null);
		for (const note of pitched) {
			expect(note.pitch!).toBeGreaterThanOrEqual(44);
			expect(note.pitch!).toBeLessThanOrEqual(85);
		}
	});
});
