import { describe, it, expect } from 'vitest';
import { BLUES_BLUE_NOTE_LICKS } from '$lib/data/licks/blues-blue-note';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import type { Fraction } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
// The six minor-blues-scale tones in concert C: 1 b3 4 b5 5 b7.
const BLUES_PCS = new Set([0, 3, 5, 6, 7, 10]);

describe('blues blue-note licks', () => {
	it('has 75 licks with unique ids', () => {
		expect(BLUES_BLUE_NOTE_LICKS).toHaveLength(75);
		const ids = BLUES_BLUE_NOTE_LICKS.map((l) => l.id);
		expect(new Set(ids).size).toBe(75);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size).toBe(curatedIds.length);
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			expect(curatedIds.includes(lick.id)).toBe(true);
		}
	});

	it('every lick is blues-scale compatible', () => {
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			expect(isLickCompatible(lick, 'blues'), lick.id).toBe(true);
		}
	});

	it('every lick sits between difficulty level 1 and 25', () => {
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			expect(lick.difficulty.level, lick.id).toBeGreaterThanOrEqual(1);
			expect(lick.difficulty.level, lick.id).toBeLessThanOrEqual(25);
		}
	});

	it('every lick features the b5 blue note (pitch class 6)', () => {
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			const pcs = lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12);
			expect(pcs.includes(6), `${lick.id} "${lick.name}"`).toBe(true);
		}
	});

	it('every note uses only the six blues-scale tones, so the b5 survives the blues-session snap', () => {
		// A blues session snaps every lick to the blues scale (library-loader snapLickToScale).
		// Any pitch outside the six blues tones would be silently snapped away, so the
		// whole collection must stay strictly inside the scale.
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			for (const n of lick.notes) {
				if (n.pitch === null) continue;
				expect(BLUES_PCS.has(n.pitch % 12), `${lick.id} pitch ${n.pitch}`).toBe(true);
			}
		}
	});

	it('notes are well-formed and stay within the phrase', () => {
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			const total = lick.difficulty.lengthBars;
			let prev = -Infinity;
			for (const n of lick.notes) {
				const off = val(n.offset);
				const dur = val(n.duration);
				expect(dur, lick.id).toBeGreaterThan(0);
				expect(off, lick.id).toBeGreaterThanOrEqual(prev - 1e-9);
				expect(off + dur, lick.id).toBeLessThanOrEqual(total + 1e-9);
				prev = off;
			}
		}
	});

	it('is evenly distributed across difficulty levels 1-25', () => {
		const counts = new Map<number, number>();
		for (let l = 1; l <= 25; l++) counts.set(l, 0);
		for (const lick of BLUES_BLUE_NOTE_LICKS) {
			counts.set(lick.difficulty.level, (counts.get(lick.difficulty.level) ?? 0) + 1);
		}
		for (let l = 1; l <= 25; l++) {
			expect(counts.get(l), `level ${l}`).toBeGreaterThanOrEqual(2);
		}
	});
});
