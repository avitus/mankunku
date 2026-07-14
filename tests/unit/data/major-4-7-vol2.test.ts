import { describe, it, expect } from 'vitest';
import { MAJOR_4_7_VOL2_LICKS } from '$lib/data/licks/major-4-7-vol2';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import type { Fraction } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
const DIATONIC_C = new Set([0, 2, 4, 5, 7, 9, 11]); // C major pitch classes

describe('major 4th & 7th licks, volume 2', () => {
	it('has 40 licks with unique ids', () => {
		expect(MAJOR_4_7_VOL2_LICKS).toHaveLength(40);
		const ids = MAJOR_4_7_VOL2_LICKS.map((l) => l.id);
		expect(new Set(ids).size).toBe(40);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size, 'duplicate ids in ALL_CURATED_LICKS').toBe(curatedIds.length);
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			expect(curatedIds.includes(lick.id), `${lick.id} missing from ALL_CURATED_LICKS`).toBe(true);
		}
	});

	it('every lick is major-scale compatible', () => {
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			expect(isLickCompatible(lick, 'major'), lick.id).toBe(true);
		}
	});

	it('every lick sits in the intermediate band, difficulty level 18-30', () => {
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			expect(lick.difficulty.level, lick.id).toBeGreaterThanOrEqual(18);
			expect(lick.difficulty.level, lick.id).toBeLessThanOrEqual(30);
		}
	});

	// Levels 18-30 sit below the chromatic tier floor (31, see
	// difficulty-calibration.test.ts), so the whole collection must be diatonic —
	// including the ii-V-I licks, which bypass snap-to-scale at runtime.
	it('every lick is strictly diatonic — no chromatic notes below the tier-5 floor', () => {
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			for (const n of lick.notes) {
				if (n.pitch === null) continue;
				expect(DIATONIC_C.has(n.pitch % 12), `${lick.id} has chromatic note ${n.pitch}`).toBe(
					true
				);
			}
		}
	});

	it('every lick features the 4th or the 7th scale degree', () => {
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			const pcs = lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12);
			expect(pcs.includes(5) || pcs.includes(11), `${lick.id} has no 4th or 7th`).toBe(true);
		}
	});

	it('the collection uses all seven scale degrees', () => {
		const pcs = new Set(
			MAJOR_4_7_VOL2_LICKS.flatMap((l) =>
				l.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12)
			)
		);
		expect([...pcs].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
	});

	it('no level hosts a pile-up — at most 4 licks per difficulty level', () => {
		const counts = new Map<number, number>();
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			counts.set(lick.difficulty.level, (counts.get(lick.difficulty.level) ?? 0) + 1);
		}
		for (const [level, count] of counts) {
			expect(count, `level ${level} has ${count} licks`).toBeLessThanOrEqual(4);
		}
	});

	it('notes are well-formed and stay within the phrase', () => {
		for (const lick of MAJOR_4_7_VOL2_LICKS) {
			const total = lick.difficulty.lengthBars; // whole notes in 4/4
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
