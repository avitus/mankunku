import { describe, it, expect } from 'vitest';
import { LYDIAN_LICKS } from '$lib/data/licks/lydian';
import { DORIAN_LICKS } from '$lib/data/licks/dorian';
import { AEOLIAN_LICKS } from '$lib/data/licks/aeolian';
import { MIXOLYDIAN_LICKS } from '$lib/data/licks/mixolydian';
import { ALL_CURATED_LICKS } from '$lib/data/licks/index';
import { isLickCompatible } from '$lib/tonality/scale-compatibility';
import { calculateDifficulty } from '$lib/difficulty/calculate';
import { noteCountFloorLevel } from '$lib/difficulty/params';
import { getScale } from '$lib/music/scales';
import { realizeScale } from '$lib/music/keys';
import type { ScaleType } from '$lib/tonality/tonality';
import type { ChordQuality, Fraction, Phrase } from '$lib/types/music';

const val = (f: Fraction): number => f[0] / f[1];
const pcs = (lick: Phrase): number[] =>
	lick.notes.filter((n) => n.pitch !== null).map((n) => n.pitch! % 12);
const offsets = (scaleId: string): number[] => realizeScale('C', getScale(scaleId)!.intervals);
const IONIAN = offsets('major.ionian');

/**
 * The four colour-tone collections (2026-10-07): each mode's pool below level
 * ~20 used to be pentatonic or blues cells that cannot hold the note that
 * defines the mode. Every line sounds that note, and the short ones sit where
 * a newly unlocked scale starts.
 */
const COLLECTIONS: {
	name: string; licks: Phrase[]; scaleId: string; quality: ChordQuality; scaleType: ScaleType; colour: number;
}[] = [
	{ name: 'Lydian #4', licks: LYDIAN_LICKS, scaleId: 'major.lydian', quality: 'maj7', scaleType: 'lydian', colour: 6 },
	{ name: 'Dorian 6', licks: DORIAN_LICKS, scaleId: 'major.dorian', quality: 'min7', scaleType: 'dorian', colour: 9 },
	{ name: 'Aeolian b6', licks: AEOLIAN_LICKS, scaleId: 'major.aeolian', quality: 'min7', scaleType: 'minor', colour: 8 },
	{ name: 'Mixolydian b7', licks: MIXOLYDIAN_LICKS, scaleId: 'major.mixolydian', quality: '7', scaleType: 'mixolydian', colour: 10 }
];

describe.each(COLLECTIONS)('$name licks', ({ licks, scaleId, quality, scaleType, colour }) => {
	const scale = new Set(offsets(scaleId));

	it('has 40 licks with unique ids and names', () => {
		expect(licks).toHaveLength(40);
		expect(new Set(licks.map((l) => l.id)).size).toBe(40);
		expect(new Set(licks.map((l) => l.name)).size).toBe(40);
	});

	it('is wired into the curated library exactly once, with no id collisions', () => {
		const curatedIds = ALL_CURATED_LICKS.map((l) => l.id);
		expect(new Set(curatedIds).size, 'duplicate ids in ALL_CURATED_LICKS').toBe(curatedIds.length);
		for (const lick of licks) {
			expect(curatedIds.includes(lick.id), `${lick.id} missing from ALL_CURATED_LICKS`).toBe(true);
		}
	});

	it(`every lick is declared over C${quality} in its mode and offered in ${scaleType} sessions`, () => {
		for (const lick of licks) {
			expect(lick.key, lick.id).toBe('C');
			expect(lick.harmony.map((h) => [h.chord.root, h.chord.quality, h.scaleId]), lick.id).toEqual([
				['C', quality, scaleId]
			]);
			expect(isLickCompatible(lick, scaleType), lick.id).toBe(true);
		}
	});

	it('every lick sounds the colour tone and stays inside the mode', () => {
		for (const lick of licks) {
			expect(pcs(lick).includes(colour), `${lick.id} lacks pitch class ${colour}`).toBe(true);
			for (const pc of pcs(lick)) expect(scale.has(pc), `${lick.id} has pitch class ${pc}`).toBe(true);
		}
	});

	it('is front-loaded: at least ten lines at levels 1-5, where the colour was missing', () => {
		expect(licks.filter((l) => l.difficulty.level <= 5).length).toBeGreaterThanOrEqual(10);
	});

	// calculateDifficulty measures chromaticism against C major, so it reads a
	// mode's own altered degrees as out of scale. Each line is rated as the
	// same shape in C major, every degree moved to its major-scale version,
	// raised to the note-count floor.
	it('every lick is rated as its C-major shape, at or above its note-count floor', () => {
		const from = offsets(scaleId);
		for (const lick of licks) {
			const shape: Phrase = {
				...lick,
				notes: lick.notes.map((n) => n.pitch === null ? n : {
					...n, pitch: n.pitch + IONIAN[from.indexOf(n.pitch % 12)] - (n.pitch % 12)
				})
			};
			const rated = calculateDifficulty(shape);
			expect(lick.difficulty, lick.id).toEqual({
				...rated,
				level: Math.max(rated.level, noteCountFloorLevel(pcs(lick).length))
			});
		}
	});

	it('notes are well-formed and stay within the harmony', () => {
		for (const lick of licks) {
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
