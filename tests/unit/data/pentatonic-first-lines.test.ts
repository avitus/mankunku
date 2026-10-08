import { describe, it, expect } from 'vitest';
import { PENTATONIC_FIRST_LINES } from '$lib/data/licks/pentatonic-first-lines';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import { calculateDifficulty, effectiveDifficultyLevel } from '$lib/difficulty/calculate';
import { earTrainingNoteLimit } from '$lib/phrases/ear-training-pool';
import { findDuplicateLick } from '$lib/phrases/duplicate-detection';
import type { Fraction, Phrase } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
const pitched = (lick: Phrase) => lick.notes.filter((n) => n.pitch !== null);
/** The line as heard in concert C: pitches and rhythm over its chords, no other metadata. */
const sounding = (lick: Phrase): string =>
	JSON.stringify([
		lick.notes.map((n) => [n.pitch, val(n.offset), val(n.duration)]),
		lick.harmony.map((h) => [h.chord.root, h.chord.quality])
	]);

/**
 * Major Pentatonic is the one scale open from the start, and at levels 1-3 it
 * served four or five two-note cells (2026-10-07), so a new player heard the
 * same handful on repeat. These lines fill those levels.
 */
describe('Major Pentatonic first lines', () => {
	it('has 40 lines with unique ids and names', () => {
		expect(PENTATONIC_FIRST_LINES).toHaveLength(40);
		expect(new Set(PENTATONIC_FIRST_LINES.map((l) => l.id)).size).toBe(40);
		expect(new Set(PENTATONIC_FIRST_LINES.map((l) => l.name)).size).toBe(40);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size, 'duplicate ids in ALL_CURATED_LICKS').toBe(curatedIds.length);
		for (const lick of PENTATONIC_FIRST_LINES) {
			expect(curatedIds.includes(lick.id), `${lick.id} missing from ALL_CURATED_LICKS`).toBe(true);
		}
	});

	it('every line is declared over Cmaj7 in major pentatonic and offered in Major Pentatonic sessions', () => {
		for (const lick of PENTATONIC_FIRST_LINES) {
			expect(lick.key, lick.id).toBe('C');
			expect(lick.category, lick.id).toBe('pentatonic');
			expect(lick.harmony.map((h) => [h.chord.root, h.chord.quality, h.scaleId]), lick.id).toEqual([
				['C', 'maj7', 'pentatonic.major']
			]);
			expect(isLickCompatible(lick, 'major-pentatonic'), lick.id).toBe(true);
		}
	});

	it('every note is in C major pentatonic', () => {
		const pentatonic = new Set([0, 2, 4, 7, 9]);
		for (const lick of PENTATONIC_FIRST_LINES) {
			for (const n of pitched(lick)) expect(pentatonic.has(n.pitch! % 12), `${lick.id} has ${n.pitch}`).toBe(true);
		}
	});

	// Every note is diatonic, so calculateDifficulty needs no adjustment here
	// (unlike the modal collections, which it reads as chromatic).
	it('every line is rated exactly as calculated, at levels 1-3, short enough for those levels', () => {
		for (const lick of PENTATONIC_FIRST_LINES) {
			expect(lick.difficulty, lick.id).toEqual(calculateDifficulty(lick));
			expect(lick.difficulty.level, lick.id).toBeLessThanOrEqual(3);
			expect(effectiveDifficultyLevel(lick), lick.id).toBe(lick.difficulty.level);
			expect(pitched(lick).length, lick.id).toBeLessThanOrEqual(earTrainingNoteLimit(lick.difficulty.level));
		}
		for (const level of [1, 2, 3]) {
			expect(PENTATONIC_FIRST_LINES.filter((l) => l.difficulty.level === level).length, `level ${level}`).toBeGreaterThanOrEqual(10);
		}
	});

	it('no line repeats another curated phrase over the same chord', () => {
		const others = ALL_CURATED_LICKS.filter((l) => !PENTATONIC_FIRST_LINES.includes(l));
		const heard = new Map(others.map((l) => [sounding(l), l.id]));
		for (const lick of PENTATONIC_FIRST_LINES) {
			expect(heard.get(sounding(lick)), `${lick.id} sounds like`).toBeUndefined();
			heard.set(sounding(lick), lick.id);
			// The editor's Steal check matches a shape in any key (four notes and up).
			const rest = ALL_CURATED_LICKS.filter((l) => l.id !== lick.id);
			expect(findDuplicateLick(lick, rest)?.id, `${lick.id} duplicates`).toBeUndefined();
		}
	});

	it('notes are well-formed and stay within the harmony', () => {
		for (const lick of PENTATONIC_FIRST_LINES) {
			const total = val(lick.harmony[0].duration);
			expect(total, lick.id).toBe(lick.difficulty.lengthBars);
			let prevEnd = -Infinity;
			for (const n of lick.notes) {
				const off = val(n.offset);
				const dur = val(n.duration);
				expect(dur, `${lick.id} duration`).toBeGreaterThan(0);
				expect(off, `${lick.id} overlaps previous note`).toBeGreaterThanOrEqual(prevEnd - 1e-9);
				expect(off + dur, `${lick.id} spills past end`).toBeLessThanOrEqual(total + 1e-9);
				prevEnd = off + dur;
			}
		}
	});
});
