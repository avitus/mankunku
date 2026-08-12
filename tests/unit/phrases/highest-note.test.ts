/**
 * Tests for the configurable highest note feature.
 *
 * Verifies that rangeHigh is respected across:
 *   - transposeLick / transposeLickForTonality (library-loader)
 */

import { describe, it, expect } from 'vitest';
import { transposeLick, transposeLickForTonality } from '$lib/phrases/library-loader';
import type { Phrase } from '$lib/types/music';

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
		// With rangeLow=60, rangeHigh=72, bestOctaveShift should prefer shift -1 → 59-71
		// (3 of 4 in range 60-72) over shift 0 → 71-83 (2 of 4 in range)
		const phrase = makePhrase([60, 64, 67, 72]);
		const result = transposeLick(phrase, 'B', 60, 72);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// With shift -1, pitches are 59, 63, 66, 71
		expect(pitches).toEqual([59, 63, 66, 71]);
	});

	it('without range, uses fallback range', () => {
		const phrase = makePhrase([60, 64, 67, 72]);
		const defaultResult = transposeLick(phrase, 'D');
		const customResult = transposeLick(phrase, 'D', 60, 75);

		// Fallback matches (60, 75)
		expect(defaultResult.notes.map(n => n.pitch))
			.toEqual(customResult.notes.map(n => n.pitch));
	});

	it('with low rangeHigh, forces octave shift that keeps max pitch within bound', () => {
		const phrase = makePhrase([60, 62, 64, 67]);
		const result = transposeLick(phrase, 'G', 60, 68);
		const pitches = result.notes.map(n => n.pitch) as number[];
		const maxPitch = Math.max(...pitches);

		expect(maxPitch).toBeLessThanOrEqual(68);
		// Verify shift actually moved notes lower than naive +7
		const naiveMax = 67 + 7; // 74
		expect(maxPitch).toBeLessThan(naiveMax);
	});

	it('applies a same-key octave shift when the lick sits above the range', () => {
		// No transposition (C → C), but passing a range skips the semitones===0
		// early return: the lick lives at 72–84 while the range tops out at 72,
		// so bestOctaveShift must drop it exactly one octave.
		const phrase = makePhrase([72, 76, 79, 84]);
		const result = transposeLick(phrase, 'C', 60, 72);

		expect(result.key).toBe('C');
		expect(result.notes.map(n => n.pitch)).toEqual([60, 64, 67, 72]);
	});
});

// ─── transposeLickForTonality with rangeHigh ─────────────────

describe('transposeLickForTonality — rangeHigh safety clamp', () => {
	it('clamps notes above rangeHigh down into range', () => {
		// Wide-spanning lick: 48, 60, 72, 84 (3 octaves apart).
		// Transpose to D (+2) → bestOctaveShift picks shift 0 → pitches: 50, 62, 74, 86.
		// 86 > 75 → safety clamp shifts down to 74.
		const phrase = makePhrase([48, 60, 72, 84]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 60, 75);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(75);
		}
	});

	it('clamps notes down multiple octaves if needed', () => {
		// Extreme case: note at 96 with rangeHigh=70
		// 96 - 12 = 84, still > 70. 84 - 12 = 72, still > 70. 72 - 12 = 60 ≤ 70.
		const phrase = makePhrase([60, 96]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 60, 70);
		const pitches = result.notes.map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(70);
		}
	});

	it('does not clamp when notes are already in range', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'D', 'major.ionian', 60, 80);
		const pitches = result.notes.map(n => n.pitch) as number[];

		// D transposition: +2 → 62, 66, 69 — all below 80
		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(80);
		}
	});

	it('clamp applies after scale snapping', () => {
		const phrase = makePhrase([60, 64, 67]);
		const result = transposeLickForTonality(phrase, 'A', 'blues.minor', 60, 72);
		const pitches = result.notes.filter(n => n.pitch !== null).map(n => n.pitch) as number[];

		for (const p of pitches) {
			expect(p).toBeLessThanOrEqual(72);
		}
	});

	it('preserves rests through clamping', () => {
		const phrase = makePhrase([60, null, 67]);
		const result = transposeLickForTonality(phrase, 'B', 'major.ionian', 60, 75);
		expect(result.notes[1].pitch).toBeNull();
	});

	it('without rangeHigh, no safety clamp is applied; with it, all pitches are clamped', () => {
		// Wide-spanning lick where bestOctaveShift can't fit all notes in [60,75].
		// 48, 60, 72, 84 → transpose to D (+2) → 50, 62, 74, 86
		// D ionian PCs: {2,4,6,7,9,11,1}. All pitches %12=2(D) → in scale, no snap.
		const phrase = makePhrase([48, 60, 72, 84]);

		const withClamp = transposeLickForTonality(phrase, 'D', 'major.ionian', 60, 75);
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

