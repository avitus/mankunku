import { describe, it, expect } from 'vitest';
import { LYDIAN_LICKS } from '$lib/data/licks/lydian';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import { calculateDifficulty } from '$lib/difficulty/calculate';
import { noteCountFloorLevel } from '$lib/difficulty/params';
import type { Fraction, Phrase } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
const C_LYDIAN = new Set([0, 2, 4, 6, 7, 9, 11]);
const SHARP_FOUR = 6;
const pcs = (lick: Phrase): number[] =>
	lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12);

describe('Lydian #4 licks', () => {
	it('has 40 licks with unique ids and names', () => {
		expect(LYDIAN_LICKS).toHaveLength(40);
		expect(new Set(LYDIAN_LICKS.map((l) => l.id)).size).toBe(40);
		expect(new Set(LYDIAN_LICKS.map((l) => l.name)).size).toBe(40);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size, 'duplicate ids in ALL_CURATED_LICKS').toBe(curatedIds.length);
		for (const lick of LYDIAN_LICKS) {
			expect(curatedIds.includes(lick.id), `${lick.id} missing from ALL_CURATED_LICKS`).toBe(true);
		}
	});

	it('every lick is declared over Cmaj7 in C Lydian and offered in Lydian sessions', () => {
		for (const lick of LYDIAN_LICKS) {
			expect(lick.key, lick.id).toBe('C');
			expect(lick.harmony.map((h) => [h.chord.root, h.chord.quality, h.scaleId]), lick.id).toEqual([
				['C', 'maj7', 'major.lydian']
			]);
			expect(isLickCompatible(lick, 'lydian'), lick.id).toBe(true);
		}
	});

	it('every lick sounds the #4 and stays inside C Lydian', () => {
		for (const lick of LYDIAN_LICKS) {
			expect(pcs(lick).includes(SHARP_FOUR), `${lick.id} has no F#`).toBe(true);
			for (const pc of pcs(lick)) expect(C_LYDIAN.has(pc), `${lick.id} has pitch class ${pc}`).toBe(true);
		}
	});

	it('is front-loaded: at least a dozen lines at levels 1-5, where Lydian had none', () => {
		expect(LYDIAN_LICKS.filter((l) => l.difficulty.level <= 5).length).toBeGreaterThanOrEqual(12);
	});

	// calculateDifficulty measures chromaticism against C major, so it reads
	// Lydian's own F# as out of scale. The collection is rated as the same
	// shape in C major (which is also what a major session adapts it to),
	// raised to the note-count floor.
	it('every lick is rated as its C-major shape, at or above its note-count floor', () => {
		for (const lick of LYDIAN_LICKS) {
			const shape: Phrase = {
				...lick,
				notes: lick.notes.map((n) => ({ ...n, pitch: n.pitch !== null && n.pitch % 12 === SHARP_FOUR ? n.pitch - 1 : n.pitch }))
			};
			const rated = calculateDifficulty(shape);
			const count = pcs(lick).length;
			expect(lick.difficulty, lick.id).toEqual({
				...rated,
				level: Math.max(rated.level, noteCountFloorLevel(count))
			});
		}
	});

	it('notes are well-formed and stay within the harmony', () => {
		for (const lick of LYDIAN_LICKS) {
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
