/**
 * Data integrity tests for all curated lick data.
 *
 * Validates structural correctness, valid references, and consistent
 * metadata across the entire lick library. Bad data causes silent
 * downstream failures in playback, scoring, and adaptive difficulty.
 */

import { describe, it, expect } from 'vitest';
import { ALL_CURATED_LICKS } from '../../src/lib/data/licks/index';
import { fractionToFloat } from '../../src/lib/music/intervals';
import { getScale } from '../../src/lib/music/scales';
import { calculateDifficulty } from '../../src/lib/difficulty/calculate';
import type { PhraseCategory, ChordQuality, PitchClass } from '../../src/lib/types/music';

/** All valid PhraseCategory values */
const VALID_CATEGORIES: PhraseCategory[] = [
	'ii-V-I-major', 'ii-V-I-minor', 'blues', 'bebop-lines',
	'short-ii-V-I-major', 'short-ii-V-I-minor',
	'long-ii-V-I-major', 'long-ii-V-I-minor',
	'V-I-major', 'V-I-minor',
	'major-chord', 'dominant-chord', 'minor-chord', 'diminished-chord',
	'pentatonic', 'enclosures', 'digital-patterns', 'approach-notes',
	'turnarounds', 'rhythm-changes', 'ballad', 'modal',
	'user'
];

/** All valid ChordQuality values */
const VALID_CHORD_QUALITIES: ChordQuality[] = [
	'maj7', 'min7', '7', 'min7b5', 'dim7',
	'maj6', 'min6', 'aug7', 'sus4', 'sus2',
	'7alt', '7#11', '7b9', '7#9', '7b13',
	'minMaj7', 'aug', 'dim'
];

/** All valid PitchClass values */
const VALID_PITCH_CLASSES: PitchClass[] = [
	'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'
];

/** Valid time signature beat units */
const VALID_BEAT_UNITS = [2, 4, 8];

/**
 * Instrument range for curated licks (concert pitch MIDI).
 * Hand-authored licks may exceed the generator's default [44, 75] —
 * the upper bound here covers the practical tenor sax altissimo range.
 */
const DEFAULT_RANGE_LOW = 44;
const DEFAULT_RANGE_HIGH = 84;

describe('curated lick data integrity', () => {
	const licks = ALL_CURATED_LICKS;

	it('library is non-empty', () => {
		expect(licks.length).toBeGreaterThan(0);
	});

	it('every lick has a non-empty id', () => {
		for (const lick of licks) {
			expect(lick.id, `lick at index ${licks.indexOf(lick)} has empty/missing id`).toBeTruthy();
			expect(typeof lick.id).toBe('string');
			expect(lick.id.trim().length, `lick id is whitespace-only`).toBeGreaterThan(0);
		}
	});

	it('no duplicate IDs across the entire library', () => {
		const ids = licks.map((l) => l.id);
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const id of ids) {
			if (seen.has(id)) duplicates.push(id);
			seen.add(id);
		}
		expect(duplicates, `duplicate IDs found: ${duplicates.join(', ')}`).toEqual([]);
	});

	it('every lick has a non-empty name', () => {
		for (const lick of licks) {
			expect(lick.name, `lick ${lick.id} has empty/missing name`).toBeTruthy();
			expect(typeof lick.name).toBe('string');
			expect(lick.name.trim().length, `lick ${lick.id} name is whitespace-only`).toBeGreaterThan(0);
		}
	});

	it('every lick category is a valid PhraseCategory', () => {
		for (const lick of licks) {
			expect(
				VALID_CATEGORIES,
				`lick ${lick.id} has invalid category '${lick.category}'`
			).toContain(lick.category);
		}
	});

	it('every note has valid MIDI pitch (integer 0-127) or null for rests', () => {
		for (const lick of licks) {
			for (let i = 0; i < lick.notes.length; i++) {
				const note = lick.notes[i];
				if (note.pitch === null) continue;
				expect(
					Number.isInteger(note.pitch),
					`lick ${lick.id} note ${i}: pitch ${note.pitch} is not an integer`
				).toBe(true);
				expect(
					note.pitch,
					`lick ${lick.id} note ${i}: pitch ${note.pitch} out of MIDI range`
				).toBeGreaterThanOrEqual(0);
				expect(
					note.pitch,
					`lick ${lick.id} note ${i}: pitch ${note.pitch} out of MIDI range`
				).toBeLessThanOrEqual(127);
			}
		}
	});

	it('every note has a valid Fraction duration (numerator > 0, denominator > 0, both integers)', () => {
		for (const lick of licks) {
			for (let i = 0; i < lick.notes.length; i++) {
				const note = lick.notes[i];
				const [num, den] = note.duration;
				expect(
					Array.isArray(note.duration) && note.duration.length === 2,
					`lick ${lick.id} note ${i}: duration is not a [num, den] tuple`
				).toBe(true);
				expect(
					Number.isInteger(num) && num > 0,
					`lick ${lick.id} note ${i}: duration numerator ${num} must be a positive integer`
				).toBe(true);
				expect(
					Number.isInteger(den) && den > 0,
					`lick ${lick.id} note ${i}: duration denominator ${den} must be a positive integer`
				).toBe(true);
			}
		}
	});

	it('every note has a valid Fraction offset (numerator >= 0, denominator > 0, both integers)', () => {
		for (const lick of licks) {
			for (let i = 0; i < lick.notes.length; i++) {
				const note = lick.notes[i];
				const [num, den] = note.offset;
				expect(
					Array.isArray(note.offset) && note.offset.length === 2,
					`lick ${lick.id} note ${i}: offset is not a [num, den] tuple`
				).toBe(true);
				expect(
					Number.isInteger(num) && num >= 0,
					`lick ${lick.id} note ${i}: offset numerator ${num} must be a non-negative integer`
				).toBe(true);
				expect(
					Number.isInteger(den) && den > 0,
					`lick ${lick.id} note ${i}: offset denominator ${den} must be a positive integer`
				).toBe(true);
			}
		}
	});

	it('note offsets are monotonically non-decreasing within each lick', () => {
		for (const lick of licks) {
			for (let i = 1; i < lick.notes.length; i++) {
				const prev = fractionToFloat(lick.notes[i - 1].offset);
				const curr = fractionToFloat(lick.notes[i].offset);
				expect(
					curr,
					`lick ${lick.id} note ${i}: offset ${curr} < previous offset ${prev}`
				).toBeGreaterThanOrEqual(prev);
			}
		}
	});

	it('every lick has at least one harmony segment', () => {
		for (const lick of licks) {
			expect(
				lick.harmony.length,
				`lick ${lick.id} has no harmony segments`
			).toBeGreaterThanOrEqual(1);
		}
	});

	it('every harmony chord root is a valid PitchClass', () => {
		for (const lick of licks) {
			for (let i = 0; i < lick.harmony.length; i++) {
				const seg = lick.harmony[i];
				expect(
					VALID_PITCH_CLASSES,
					`lick ${lick.id} harmony ${i}: root '${seg.chord.root}' is not a valid PitchClass`
				).toContain(seg.chord.root);
			}
		}
	});

	it('every harmony chord quality is a valid ChordQuality', () => {
		for (const lick of licks) {
			for (let i = 0; i < lick.harmony.length; i++) {
				const seg = lick.harmony[i];
				expect(
					VALID_CHORD_QUALITIES,
					`lick ${lick.id} harmony ${i}: quality '${seg.chord.quality}' is not valid`
				).toContain(seg.chord.quality);
			}
		}
	});

	it('every harmony scaleId resolves via getScale()', () => {
		// NOTE: we deliberately do NOT also assert `chordApplications.contains(quality)`.
		// Curated licks legitimately use scale/chord pairings that aren't listed in
		// the scale's conservative `chordApplications` set (e.g., Phrygian over
		// sus4 in modal jazz). The existence check is the meaningful invariant here.
		for (const lick of licks) {
			for (let i = 0; i < lick.harmony.length; i++) {
				const seg = lick.harmony[i];
				const scale = getScale(seg.scaleId);
				expect(
					scale,
					`lick ${lick.id} harmony ${i}: scaleId '${seg.scaleId}' not found in SCALE_CATALOG`
				).toBeDefined();
			}
		}
	});

	it('difficulty.level is between 1 and 100 for every lick', () => {
		for (const lick of licks) {
			expect(
				lick.difficulty.level,
				`lick ${lick.id}: difficulty.level ${lick.difficulty.level} out of range`
			).toBeGreaterThanOrEqual(1);
			expect(
				lick.difficulty.level,
				`lick ${lick.id}: difficulty.level ${lick.difficulty.level} out of range`
			).toBeLessThanOrEqual(100);
		}
	});

	it('difficulty.pitchComplexity is between 1 and 100', () => {
		for (const lick of licks) {
			expect(
				lick.difficulty.pitchComplexity,
				`lick ${lick.id}: pitchComplexity ${lick.difficulty.pitchComplexity} out of range`
			).toBeGreaterThanOrEqual(1);
			expect(
				lick.difficulty.pitchComplexity,
				`lick ${lick.id}: pitchComplexity ${lick.difficulty.pitchComplexity} out of range`
			).toBeLessThanOrEqual(100);
		}
	});

	it('difficulty.rhythmComplexity is between 1 and 100', () => {
		for (const lick of licks) {
			expect(
				lick.difficulty.rhythmComplexity,
				`lick ${lick.id}: rhythmComplexity ${lick.difficulty.rhythmComplexity} out of range`
			).toBeGreaterThanOrEqual(1);
			expect(
				lick.difficulty.rhythmComplexity,
				`lick ${lick.id}: rhythmComplexity ${lick.difficulty.rhythmComplexity} out of range`
			).toBeLessThanOrEqual(100);
		}
	});

	it('difficulty.lengthBars >= 1', () => {
		for (const lick of licks) {
			expect(
				lick.difficulty.lengthBars,
				`lick ${lick.id}: lengthBars ${lick.difficulty.lengthBars} < 1`
			).toBeGreaterThanOrEqual(1);
		}
	});

	it('declared difficulty.level is within +/-35 of calculateDifficulty() output', () => {
		const TOLERANCE = 35;
		for (const lick of licks) {
			const computed = calculateDifficulty(lick);
			const diff = Math.abs(lick.difficulty.level - computed.level);
			expect(
				diff,
				`lick ${lick.id} "${lick.name}": declared level ${lick.difficulty.level} vs calculated ${computed.level} (diff ${diff} > ${TOLERANCE})`
			).toBeLessThanOrEqual(TOLERANCE);
		}
	});

	it('every curated lick has key C (all curated licks stored in concert C)', () => {
		for (const lick of licks) {
			expect(
				lick.key,
				`lick ${lick.id}: key is '${lick.key}', expected 'C'`
			).toBe('C');
		}
	});

	it('every curated lick has source "curated" or "combined"', () => {
		for (const lick of licks) {
			expect(
				['curated', 'combined'],
				`lick ${lick.id}: source is '${lick.source}', expected 'curated' or 'combined'`
			).toContain(lick.source);
		}
	});

	it('every lick has a tags array', () => {
		for (const lick of licks) {
			expect(
				Array.isArray(lick.tags),
				`lick ${lick.id}: tags is not an array`
			).toBe(true);
		}
	});

	it('timeSignature is a valid tuple with beats > 0 and unit in [2, 4, 8]', () => {
		for (const lick of licks) {
			const [beats, unit] = lick.timeSignature;
			expect(
				Array.isArray(lick.timeSignature) && lick.timeSignature.length === 2,
				`lick ${lick.id}: timeSignature is not a [beats, unit] tuple`
			).toBe(true);
			expect(
				Number.isInteger(beats) && beats > 0,
				`lick ${lick.id}: timeSignature beats ${beats} must be a positive integer`
			).toBe(true);
			expect(
				VALID_BEAT_UNITS,
				`lick ${lick.id}: timeSignature unit ${unit} not in [2, 4, 8]`
			).toContain(unit);
		}
	});

	it(`all pitched notes in curated (non-combined) licks are within range [${DEFAULT_RANGE_LOW}, ${DEFAULT_RANGE_HIGH}]`, () => {
		const curated = licks.filter((l) => l.source === 'curated');
		for (const lick of curated) {
			for (let i = 0; i < lick.notes.length; i++) {
				const note = lick.notes[i];
				if (note.pitch === null) continue;
				expect(
					note.pitch,
					`lick ${lick.id} note ${i}: pitch ${note.pitch} below range floor ${DEFAULT_RANGE_LOW}`
				).toBeGreaterThanOrEqual(DEFAULT_RANGE_LOW);
				expect(
					note.pitch,
					`lick ${lick.id} note ${i}: pitch ${note.pitch} above range ceiling ${DEFAULT_RANGE_HIGH}`
				).toBeLessThanOrEqual(DEFAULT_RANGE_HIGH);
			}
		}
	});
});
