import { describe, it, expect } from 'vitest';
import { MAJOR_4_7_LICKS } from '$lib/data/licks/major-4-7';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import type { Fraction } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
const DIATONIC_C = new Set([0, 2, 4, 5, 7, 9, 11]); // C major pitch classes

describe('major 4th & 7th licks', () => {
	it('has 40 licks with unique ids', () => {
		expect(MAJOR_4_7_LICKS).toHaveLength(40);
		const ids = MAJOR_4_7_LICKS.map((l) => l.id);
		expect(new Set(ids).size).toBe(40);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size, 'duplicate ids in ALL_CURATED_LICKS').toBe(curatedIds.length);
		for (const lick of MAJOR_4_7_LICKS) {
			expect(curatedIds.includes(lick.id), `${lick.id} missing from ALL_CURATED_LICKS`).toBe(true);
		}
	});

	it('every lick is major-scale compatible', () => {
		for (const lick of MAJOR_4_7_LICKS) {
			expect(isLickCompatible(lick, 'major'), lick.id).toBe(true);
		}
	});

	it('diatonic licks are front-loaded to levels 1-20; chromatic licks sit at/above the tier-5 floor', () => {
		for (const lick of MAJOR_4_7_LICKS) {
			const chromatic = lick.notes.some(
				(n) => n.pitch !== null && !DIATONIC_C.has(n.pitch % 12)
			);
			expect(lick.difficulty.level, lick.id).toBeGreaterThanOrEqual(chromatic ? 31 : 1);
			expect(lick.difficulty.level, lick.id).toBeLessThanOrEqual(chromatic ? 100 : 20);
		}
	});

	it('every lick features the 4th or the 7th scale degree', () => {
		for (const lick of MAJOR_4_7_LICKS) {
			const pcs = lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12);
			expect(pcs.includes(5) || pcs.includes(11), `${lick.id} has no 4th or 7th`).toBe(true);
		}
	});

	it('notes are well-formed and stay within the phrase', () => {
		for (const lick of MAJOR_4_7_LICKS) {
			const total = lick.difficulty.lengthBars; // whole notes in 4/4
			let prev = -Infinity;
			for (const n of lick.notes) {
				const off = val(n.offset);
				const dur = val(n.duration);
				expect(dur, `${lick.id} duration`).toBeGreaterThan(0);
				expect(off, `${lick.id} offset order`).toBeGreaterThanOrEqual(prev - 1e-9);
				expect(off + dur, `${lick.id} spills past end`).toBeLessThanOrEqual(total + 1e-9);
				prev = off;
			}
		}
	});

	it('single-chord (Ionian) licks are strictly diatonic so they survive the major-session snap', () => {
		for (const lick of MAJOR_4_7_LICKS) {
			const isSingleChord =
				lick.harmony.length === 1 && lick.harmony[0]?.scaleId === 'major.ionian';
			if (!isSingleChord) continue;
			for (const n of lick.notes) {
				if (n.pitch === null) continue;
				expect(DIATONIC_C.has(n.pitch % 12), `${lick.id} has chromatic note`).toBe(true);
			}
		}
	});
});
