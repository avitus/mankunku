/**
 * Integration tests for lick transposition integrity.
 *
 * Every curated lick is transposed at runtime. A single transposition bug
 * corrupts playback/scoring. This file tests the transposition pipeline
 * against ALL real lick data x ALL 12 keys, plus tonality-aware transposition
 * and scale snapping.
 */

import { describe, it, expect } from 'vitest';
import {
	transposeLick,
	transposeLickForTonality,
	snapLickToScale
} from '../../src/lib/phrases/library-loader';
import { ALL_CURATED_LICKS } from '../../src/lib/data/licks/index';
import { PITCH_CLASSES } from '../../src/lib/types/music';
import { getScale } from '../../src/lib/music/scales';
import { realizeScale } from '../../src/lib/music/keys';
import type { PitchClass, Phrase, Note } from '../../src/lib/types/music';

/** Instrument range: concert Ab3 (44) to concert Eb5 (75) — tenor sax */
const RANGE_LOW = 44;
const RANGE_HIGH = 75;

/** Extract only pitched (non-rest) notes from a phrase */
function pitchedNotes(phrase: Phrase): Note[] {
	return phrase.notes.filter((n) => n.pitch !== null);
}

/** Get melodic contour as array of signs: -1, 0, or 1 */
function melodicContour(phrase: Phrase): number[] {
	const pitched = pitchedNotes(phrase);
	const signs: number[] = [];
	for (let i = 1; i < pitched.length; i++) {
		const diff = pitched[i].pitch! - pitched[i - 1].pitch!;
		signs.push(diff > 0 ? 1 : diff < 0 ? -1 : 0);
	}
	return signs;
}

// ─── Core transposition: all licks x all keys ────────────────────

describe('lick transposition integrity', () => {
	it('all curated licks transpose to all 12 keys without throwing', () => {
		const errors: string[] = [];

		for (const lick of ALL_CURATED_LICKS) {
			for (let pc = 0; pc < 12; pc++) {
				const targetKey = PITCH_CLASSES[pc];
				try {
					transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);
				} catch (e) {
					errors.push(
						`Lick "${lick.id}" -> key ${targetKey}: ${e instanceof Error ? e.message : String(e)}`
					);
					break; // One failure per lick is enough to report
				}
			}
		}

		expect(errors, `Transposition threw for:\n${errors.join('\n')}`).toHaveLength(0);
	});

	it('transposed licks have majority of notes within instrument range [44, 75]', () => {
		// transposeLick uses best-octave optimization but does NOT hard-clamp
		// individual notes. Verify that at least 75% of pitched notes land in range
		// for every lick x key combination — the octave shift should make most fit.
		const violations: string[] = [];

		for (const lick of ALL_CURATED_LICKS) {
			for (let pc = 0; pc < 12; pc++) {
				const targetKey = PITCH_CLASSES[pc];
				const transposed = transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);

				const pitched = transposed.notes.filter((n) => n.pitch !== null);
				if (pitched.length === 0) continue;

				const inRange = pitched.filter(
					(n) => n.pitch! >= RANGE_LOW && n.pitch! <= RANGE_HIGH
				).length;
				const ratio = inRange / pitched.length;

				if (ratio < 0.75) {
					violations.push(
						`Lick "${lick.id}" -> ${targetKey}: only ${inRange}/${pitched.length} (${(ratio * 100).toFixed(0)}%) in range`
					);
				}
			}
		}

		expect(violations, `Range violations:\n${violations.join('\n')}`).toHaveLength(0);
	});

	it('transposeLickForTonality enforces range ceiling via safety clamp', () => {
		// transposeLickForTonality has a final safety clamp that shifts notes
		// above rangeHigh down by octaves. No note should exceed rangeHigh.
		const violations: string[] = [];

		for (const lick of ALL_CURATED_LICKS) {
			for (let pc = 0; pc < 12; pc++) {
				const targetKey = PITCH_CLASSES[pc];
				// Use major.ionian as a simple tonality for this range test
				const transposed = transposeLickForTonality(
					lick, targetKey, 'major.ionian', RANGE_LOW, RANGE_HIGH
				);

				for (const note of transposed.notes) {
					if (note.pitch !== null && note.pitch > RANGE_HIGH) {
						violations.push(
							`Lick "${lick.id}" -> ${targetKey}: pitch ${note.pitch} exceeds ceiling ${RANGE_HIGH}`
						);
						break;
					}
				}
			}
		}

		expect(violations, `Ceiling violations:\n${violations.join('\n')}`).toHaveLength(0);
	});

	it('transposition preserves note count', () => {
		// Sample 4 keys spread across the chromatic circle
		const sampleKeys: PitchClass[] = ['C', 'Eb', 'F#', 'A'];

		for (const lick of ALL_CURATED_LICKS) {
			for (const targetKey of sampleKeys) {
				const transposed = transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);
				expect(
					transposed.notes.length,
					`Lick "${lick.id}" -> ${targetKey}: note count changed from ${lick.notes.length} to ${transposed.notes.length}`
				).toBe(lick.notes.length);
			}
		}
	});

	it('transposition preserves rest positions', () => {
		// Only test licks that actually contain rests
		const licksWithRests = ALL_CURATED_LICKS.filter((l) =>
			l.notes.some((n) => n.pitch === null)
		);

		for (const lick of licksWithRests) {
			const restIndices = lick.notes
				.map((n, i) => (n.pitch === null ? i : -1))
				.filter((i) => i >= 0);

			for (let pc = 0; pc < 12; pc++) {
				const targetKey = PITCH_CLASSES[pc];
				const transposed = transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);

				for (const idx of restIndices) {
					expect(
						transposed.notes[idx].pitch,
						`Lick "${lick.id}" -> ${targetKey}: rest at index ${idx} became pitched`
					).toBeNull();
				}

				// Also verify no new rests appeared
				const transposedRestIndices = transposed.notes
					.map((n, i) => (n.pitch === null ? i : -1))
					.filter((i) => i >= 0);

				expect(
					transposedRestIndices,
					`Lick "${lick.id}" -> ${targetKey}: rest positions changed`
				).toEqual(restIndices);
			}
		}
	});

	it('transposition preserves melodic contour', () => {
		// Pick representative licks: first 5 that have at least 4 pitched notes
		const representative = ALL_CURATED_LICKS.filter(
			(l) => pitchedNotes(l).length >= 4
		).slice(0, 5);

		const sampleKeys: PitchClass[] = ['D', 'F', 'Ab', 'B'];

		for (const lick of representative) {
			const originalContour = melodicContour(lick);

			for (const targetKey of sampleKeys) {
				const transposed = transposeLick(lick, targetKey, RANGE_LOW, RANGE_HIGH);
				const transposedContour = melodicContour(transposed);

				expect(
					transposedContour,
					`Lick "${lick.id}" -> ${targetKey}: melodic contour changed`
				).toEqual(originalContour);
			}
		}
	});
});

// ─── Tonality-aware transposition ────────────────────────────────

describe('transposeLickForTonality', () => {
	it('progression licks (ii-V-I-major) transpose using parent key logic', () => {
		// Find a real ii-V-I-major lick from the curated library
		const iiVI = ALL_CURATED_LICKS.find((l) => l.category === 'ii-V-I-major');
		expect(iiVI, 'No ii-V-I-major lick found in curated library').toBeDefined();

		// Original lick is in C. Harmony roots should be D, G, C (ii, V, I).
		// Transpose for D Dorian (key=D, scale=major.dorian).
		// D Dorian's parent major key is C, so chord roots stay D, G, C.
		const result = transposeLickForTonality(iiVI!, 'D', 'major.dorian', RANGE_LOW, RANGE_HIGH);
		expect(result.key).toBe('D');

		// Verify harmony roots shifted by the parent-key interval
		// D Dorian parent = C major. Original is in C -> transposed to C. Roots unchanged.
		const originalRoots = iiVI!.harmony.map((h) => h.chord.root);
		const transposedRoots = result.harmony.map((h) => h.chord.root);
		expect(transposedRoots).toEqual(originalRoots);

		// Now transpose to E Dorian (parent = D major, +2 semitones from C)
		const resultE = transposeLickForTonality(iiVI!, 'E', 'major.dorian', RANGE_LOW, RANGE_HIGH);
		expect(resultE.key).toBe('E');

		// E Dorian parent = D major. Roots shift +2: D->E, G->A, C->D
		const expectedRootsE = originalRoots.map((root) => {
			const idx = PITCH_CLASSES.indexOf(root);
			return PITCH_CLASSES[(idx + 2) % 12];
		});
		const transposedRootsE = resultE.harmony.map((h) => h.chord.root);
		expect(transposedRootsE).toEqual(expectedRootsE);
	});

	it('modal licks snap to target scale', () => {
		// Find a pentatonic lick
		const pentLick = ALL_CURATED_LICKS.find((l) => l.category === 'pentatonic');
		expect(pentLick, 'No pentatonic lick found in curated library').toBeDefined();

		// Transpose for G Dorian — single-chord modal, so it transposes to G then snaps
		const result = transposeLickForTonality(pentLick!, 'G', 'major.dorian', RANGE_LOW, RANGE_HIGH);

		const dorianDef = getScale('major.dorian')!;
		const dorianPCs = new Set(realizeScale('G', dorianDef.intervals));

		for (const note of result.notes) {
			if (note.pitch !== null) {
				expect(
					dorianPCs.has(note.pitch % 12),
					`Pitch ${note.pitch} (pc=${note.pitch % 12}) not in G Dorian: {${[...dorianPCs].join(',')}}`
				).toBe(true);
			}
		}
	});
});

// ─── Scale snapping ──────────────────────────────────────────────

describe('snapLickToScale', () => {
	it('is idempotent — snapping an already-in-scale lick returns same notes', () => {
		// Find a lick in C major and snap to C Ionian. Notes should be unchanged.
		const majorLick = ALL_CURATED_LICKS.find((l) => {
			if (l.key !== 'C') return false;
			const ionianDef = getScale('major.ionian')!;
			const majorPCs = new Set(realizeScale('C', ionianDef.intervals));
			return l.notes
				.filter((n) => n.pitch !== null)
				.every((n) => majorPCs.has(n.pitch! % 12));
		});
		expect(majorLick, 'No C-major-diatonic lick found').toBeDefined();

		const snapped = snapLickToScale(majorLick!, 'C', 'major.ionian', RANGE_HIGH);
		const originalPitches = majorLick!.notes.map((n) => n.pitch);
		const snappedPitches = snapped.notes.map((n) => n.pitch);
		expect(snappedPitches).toEqual(originalPitches);
	});

	it('handles licks with out-of-scale notes by snapping to nearest scale tone', () => {
		// Take any lick and snap it to a scale it probably doesn't fully fit.
		// Use a blues lick snapped to C Ionian — blues notes (b3, b5, b7)
		// should snap to nearest major scale tones.
		const bluesLick = ALL_CURATED_LICKS.find(
			(l) => l.category === 'blues' && l.key === 'C'
		);
		expect(bluesLick, 'No C blues lick found').toBeDefined();

		const snapped = snapLickToScale(bluesLick!, 'C', 'major.ionian', RANGE_HIGH);

		const ionianDef = getScale('major.ionian')!;
		const majorPCs = new Set(realizeScale('C', ionianDef.intervals));

		for (const note of snapped.notes) {
			if (note.pitch !== null) {
				expect(
					majorPCs.has(note.pitch % 12),
					`After snap, pitch ${note.pitch} (pc=${note.pitch % 12}) not in C Ionian`
				).toBe(true);
			}
		}
	});
});
