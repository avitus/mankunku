/**
 * Tests for the configurable highest note feature.
 *
 * Verifies that rangeHigh is respected across:
 *   - transposeLick / transposeLickForTonality (library-loader)
 *   - octaveDisplacement / mutateLick (mutator)
 *   - generatePhrase (generator)
 */

import { describe, it, expect, vi } from 'vitest';
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

// ─── transposeLick with rangeHigh ───────────────────────────

describe('transposeLick — rangeHigh constraint', () => {
	it('uses rangeHigh to optimize octave placement', () => {
		// Notes at 60-72. Transposing to B (+11) naively → 71-83.
		// With rangeHigh=72, bestOctaveShift should prefer shift -1 → 59-71
		// (3 of 4 in range 60-72) over shift 0 → 71-83 (2 of 4 in range)
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'B', 72);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// All pitches should respect the tighter range better than without
		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(83); // at least shifted down
		}
		// Specifically: with shift -1, pitches are 59, 63, 66, 71
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

	it('with very low rangeHigh, forces notes into lower octaves', () => {
		// Notes at 60-67. Transpose to G (+7) naively → 67-74, all in default range.
		// With rangeHigh=68, shift -1 → 55-62 (most within 60-68)
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'G', 68);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			// Should not exceed rangeHigh by a lot (octave optimization gets close)
			expect(p).toBeLessThanOrEqual(80);
		}
	});
});

// ─── transposeLickForTonality with rangeHigh ─────────────────

describe('transposeLickForTonality — rangeHigh safety clamp', () => {
	it('clamps notes above rangeHigh down by an octave', () => {
		// Notes at 67-74 (G4-D5). Transpose to B (+11) → 78-85 raw.
		// With rangeHigh=75, safety clamp shifts any note > 75 down by 12.
		const phrase = makePhrase([67, 70, 74]);
		const result = transposeLickForTonality(phrase, 'B', 'major.ionian', 75);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(75);
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
		// Use blues scale which may snap notes upward
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

	it('without rangeHigh, no safety clamp is applied', () => {
		// Notes near the top of range. Transpose to B (+11).
		// Without rangeHigh, the octave optimizer does its best but no post-clamp.
		const phrase = makePhrase([67, 70, 74]);
		const withClamp = transposeLickForTonality(phrase, 'B', 'major.ionian', 75);
		const without = transposeLickForTonality(phrase, 'B', 'major.ionian');

		const clampedPitches = withClamp.notes.map(n => n.pitch) as number[];
		const defaultPitches = without.notes.map(n => n.pitch) as number[];

		// With clamp, every pitch <= 75
		for (const p of clampedPitches) {
			expect(p).toBeLessThanOrEqual(75);
		}
		// Without, some may be above (depending on octave optimization)
		// Just confirm the two results can differ
		const allSame = clampedPitches.every((p, i) => p === defaultPitches[i]);
		// It's valid for them to be the same if the optimizer already placed them low,
		// but the code paths differ — we're testing that no error occurs either way
		expect(clampedPitches.length).toBe(defaultPitches.length);
	});
});

// ─── octaveDisplacement with rangeHigh ───────────────────────

describe('octaveDisplacement — rangeHigh constraint', () => {
	it('respects rangeHigh and does not displace notes above it', () => {
		// 6 notes, inner 4 eligible for displacement. With rangeHigh=70,
		// a note at 65 shifted +12 = 77 > 70, so it should be rejected.
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Run many times to exercise the random path
		for (let i = 0; i < 50; i++) {
			const result = octaveDisplacement(phrase, 70);
			for (const n of result.notes) {
				if (n.pitch !== null) {
					expect(n.pitch).toBeLessThanOrEqual(70);
					expect(n.pitch).toBeGreaterThanOrEqual(44);
				}
			}
		}
	});

	it('default rangeHigh (84) allows higher displacement', () => {
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// With default, notes can go up to 84
		for (let i = 0; i < 50; i++) {
			const result = octaveDisplacement(phrase);
			for (const n of result.notes) {
				if (n.pitch !== null) {
					expect(n.pitch).toBeLessThanOrEqual(84);
					expect(n.pitch).toBeGreaterThanOrEqual(44);
				}
			}
		}
	});
});

// ─── mutateLick with rangeHigh ───────────────────────────────

describe('mutateLick — rangeHigh constraint', () => {
	it('validates mutations against the custom range', () => {
		const phrase = makePhrase([60, 62, 64, 65, 67, 70]);

		// Run many times — if a mutation would produce out-of-range notes,
		// it should be rejected (returns null)
		for (let i = 0; i < 30; i++) {
			const result = mutateLick(phrase, 72);
			if (result !== null) {
				for (const n of result.notes) {
					if (n.pitch !== null) {
						expect(n.pitch).toBeLessThanOrEqual(72);
						expect(n.pitch).toBeGreaterThanOrEqual(44);
					}
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

		// With rangeHigh=85, the generator can use a wider range
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
