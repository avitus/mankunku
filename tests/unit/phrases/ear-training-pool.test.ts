import { describe, expect, it } from 'vitest';
import { earTrainingNoteLimit, selectEarTrainingLicks, transposeEarTrainingLick } from '$lib/phrases/ear-training-pool';
import type { Phrase, PitchClass } from '$lib/types/music';
import { PITCH_CLASSES } from '$lib/types/music';
import { ALL_CURATED_LICKS } from '$lib/data/licks';
import { SCALE_UNLOCK_ORDER } from '$lib/tonality/tonality';
import { melodyFitsScale } from '$lib/tonality/scale-compatibility';

/** A book phrase with explicit pitch content and a stored difficulty. */
function bookLick(pitches: (number | null)[], level = 1, key: PitchClass = 'C'): Phrase {
	return {
		id: 'user-test', name: 'Book lick', key, timeSignature: [4, 4],
		notes: pitches.map((pitch, i) => ({ pitch, offset: [i, 8], duration: [1, 8] })),
		harmony: [], category: 'major-chord', source: 'user-entered', tags: [],
		difficulty: { level, pitchComplexity: level, rhythmComplexity: level, lengthBars: 3 }
	};
}

describe('ear-training eligibility', () => {
	it('excludes the reported 16-note, level-55 book lick at major pentatonic level 59', () => {
		const lick = bookLick([83, 83, 85, 83, 78, 80, 83, 78, 75, 75, 78, 75, 71, 71, 73, 71], 55, 'B');
		lick.name = 'Eric Alexander Chord Tone Lick';
		expect(selectEarTrainingLicks([lick], 59, 'major-pentatonic')).toEqual([]);
		expect(selectEarTrainingLicks([lick], 79, 'major-pentatonic')).toEqual([lick]);
	});

	it('admits ten notes at level 59 but not eleven, regardless of a low stored rating', () => {
		const ten = bookLick(Array(10).fill(60));
		const eleven = bookLick(Array(11).fill(60));
		expect(selectEarTrainingLicks([ten, eleven], 59, 'major-pentatonic')).toEqual([ten]);
	});

	it('counts played notes, not padded rests, and still enforces the stored rating', () => {
		const fitting = bookLick([...Array(10).fill(60), null, null]);
		const hard = bookLick([60, 64], 60);
		expect(selectEarTrainingLicks([fitting, hard], 59, 'major-pentatonic')).toEqual([fitting]);
	});

	it('keeps a small compatible pool instead of widening to incompatible book licks', () => {
		const fitting = bookLick([60, 64]);
		const fourth = bookLick([60, 65]);
		expect(selectEarTrainingLicks([fitting, fourth], 59, 'major-pentatonic')).toEqual([fitting]);
		expect(selectEarTrainingLicks([fourth], 59, 'major-pentatonic')).toEqual([]);
	});

	it('the empty-pool fallback admits only adaptable curated exercises', () => {
		const exercise = ALL_CURATED_LICKS.find(lick => lick.id === 'bc-001')!;
		const incompatibleBook = bookLick([60, 62]);
		expect(selectEarTrainingLicks([exercise, incompatibleBook], 1, 'altered')).toEqual([exercise]);
		// A real progression: the combiner's single-bar phrases filed under
		// ii-V-I-major come first in the catalog and are single-chord exercises.
		const progression = ALL_CURATED_LICKS.find(lick => lick.category === 'ii-V-I-major' && lick.harmony.length > 1)!;
		expect(selectEarTrainingLicks([progression], 100, 'major-pentatonic')).toEqual([]);
	});

	it.each(['user', 'user-entered', 'user-recorded', 'community-import', 'curated'])('checks actual notes for source %s, even with misleading scale metadata', source => {
		const lick = bookLick([60, 65]);
		lick.source = source;
		lick.harmony = [{ chord: { root: 'C', quality: 'maj7' }, scaleId: 'pentatonic.major', startOffset: [0, 1], duration: [1, 1] }];
		expect(selectEarTrainingLicks([lick], 59, 'major-pentatonic')).toEqual([]);
	});

	it('uses the stored concert key, including accidentals and octave changes', () => {
		const fitting = bookLick([59, 61, 75, 78, null], 1, 'B');
		const fourth = bookLick([59, 64], 1, 'B');
		expect(selectEarTrainingLicks([fitting, fourth], 59, 'major-pentatonic')).toEqual([fitting]);
	});

	it('does not admit a rest-only phrase', () => {
		expect(selectEarTrainingLicks([bookLick([null])], 59, 'major-pentatonic')).toEqual([]);
	});

	it('grows gradually across player levels, with sixteen notes reserved for level 79+', () => {
		for (let level = 1; level <= 100; level++) {
			const limit = earTrainingNoteLimit(level);
			expect(limit).toBeGreaterThanOrEqual(earTrainingNoteLimit(level - 1));
			if (level < 79) expect(limit).toBeLessThan(16);
		}
		expect(earTrainingNoteLimit(40)).toBe(8);
		expect(earTrainingNoteLimit(52)).toBe(9);
		expect(earTrainingNoteLimit(59)).toBe(10);
		expect(earTrainingNoteLimit(79)).toBe(16);
		expect(earTrainingNoteLimit(100)).toBe(24);
	});

	it('retains eligible curated material and applies the ceiling throughout the catalog', () => {
		for (const scaleType of SCALE_UNLOCK_ORDER) {
			const pool = selectEarTrainingLicks(ALL_CURATED_LICKS, 59, scaleType);
			expect(pool.length, scaleType).toBeGreaterThan(0);
			for (const lick of pool) expect(lick.notes.filter(n => n.pitch !== null).length).toBeLessThanOrEqual(10);
		}
		expect(selectEarTrainingLicks(ALL_CURATED_LICKS, 1, 'major-pentatonic').length).toBeGreaterThan(0);
	});

	it.each(SCALE_UNLOCK_ORDER)('keeps a newly unlocked %s scale playable at level 1 with short curated exercises', scaleType => {
		const pool = selectEarTrainingLicks(ALL_CURATED_LICKS, 1, scaleType);
		expect(pool.length).toBeGreaterThan(0);
		for (const lick of pool) {
			expect(lick.notes.filter(note => note.pitch !== null).length).toBeLessThanOrEqual(4);
			expect(lick.difficulty.level).toBeLessThanOrEqual(1);
			const prepared = transposeEarTrainingLick(lick, 'B', scaleType, 48, 84);
			expect(melodyFitsScale(prepared, scaleType)).toBe(true);
		}
	});

	it('transposes a book progression intact, preserving intervals and rhythm in the selected mode', () => {
		const lick = bookLick([60, 62, 63, null, 65, 67]);
		lick.category = 'ii-V-I-major';
		expect(selectEarTrainingLicks([lick], 59, 'dorian')).toEqual([lick]);
		const prepared = transposeEarTrainingLick(lick, 'D', 'dorian', 54, 84);
		expect(prepared.notes.map(n => n.pitch)).toEqual([62, 64, 65, null, 67, 69]);
		expect(prepared.notes.map(({ offset, duration }) => ({ offset, duration })))
			.toEqual(lick.notes.map(({ offset, duration }) => ({ offset, duration })));
		expect(melodyFitsScale(prepared, 'dorian')).toBe(true);
		expect(lick.notes.map(n => n.pitch)).toEqual([60, 62, 63, null, 65, 67]);
	});

	it.each(PITCH_CLASSES)('preserves the book melody and scale fit when transposing to %s', key => {
		const fitting = bookLick([60, 62, 64, 67, 69]);
		const prepared = transposeEarTrainingLick(fitting, key, 'major-pentatonic', 48, 84);
		expect(melodyFitsScale(prepared, 'major-pentatonic')).toBe(true);
		const pitches = prepared.notes.map(note => note.pitch!);
		expect(pitches.slice(1).map((pitch, i) => pitch - pitches[i])).toEqual([2, 2, 3, 2]);
	});
});

/**
 * 2026-10-07: C Lydian unlocked, three levels played, and not one phrase
 * sounded the F# — the #4 that is the whole point of the scale. The beginner
 * pool was major-pentatonic cells (no 4th at all) and major-scale cells whose
 * F the adaptation snapped down to E; above it, single-bar phrases were moved
 * to G and ii-V-Is played in G major.
 *
 * The share was at least half until the Major Pentatonic first lines joined
 * these pools by the subset rule; Andy chose that over keeping them out, and
 * the floor became one in seven (lowest measured: 9 of 56 at level 3).
 */
describe('C Lydian sessions sound the #4 (2026-10-07)', () => {
	/** The phrases a C Lydian session serves at `level`, each lick transposed into C Lydian within MIDI 46-77. */
	const served = (level: number): Phrase[] =>
		selectEarTrainingLicks(ALL_CURATED_LICKS, level, 'lydian').map(lick =>
			transposeEarTrainingLick(lick, 'C', 'lydian', 46, 77)
		);
	/** Whether any pitched note of the phrase has pitch class `pc` (0-11, C = 0). */
	const sounds = (phrase: Phrase, pc: number): boolean =>
		phrase.notes.some(note => note.pitch !== null && note.pitch % 12 === pc);

	it.each([1, 2, 3, 4, 5])('at level %i, at least one phrase in seven carries the F#', level => {
		const pool = served(level);
		const withSharpFour = pool.filter(phrase => sounds(phrase, 6));
		expect(withSharpFour.length * 7, `${withSharpFour.length} of ${pool.length}`).toBeGreaterThanOrEqual(pool.length);
	});

	// Progression licks keep their own harmony and are never adapted note by
	// note, so above the chromatic tier (level 31) a ii-V-I may carry approach
	// tones; every single-chord phrase is adapted into the scale at every level.
	it('serves no note outside C Lydian: single-chord phrases at every level, everything through level 30', () => {
		const lydian = new Set([0, 2, 4, 6, 7, 9, 11]);
		for (let level = 1; level <= 100; level++) {
			for (const phrase of served(level)) {
				if (level > 30 && phrase.harmony.length !== 1) continue;
				for (const note of phrase.notes) {
					if (note.pitch === null) continue;
					expect(lydian.has(note.pitch % 12), `level ${level}: ${phrase.id} plays pitch class ${note.pitch % 12}`).toBe(true);
				}
			}
		}
	});

	it('plays every single-chord phrase on the session root, never moved to the parent key', () => {
		for (const level of [10, 30, 60, 100]) {
			for (const phrase of served(level).filter(p => p.harmony.length === 1)) {
				expect(phrase.harmony[0].chord.root, `level ${level}: ${phrase.id}`).toBe('C');
			}
		}
	});
});

/**
 * 2026-10-07, after Lydian: Dorian's 6, the natural minor's b6 and
 * Mixolydian's b7 were just as absent — 0 of 19 Dorian and Minor phrases at
 * level 5 carried them — because each beginner pool was pentatonic or blues
 * cells. The colour-tone collections ADD to those pools; nothing is removed.
 * Mixolydian's floor is one phrase in seven, not half, since the Major
 * Pentatonic first lines joined it (as for Lydian above; lowest measured:
 * 10 of 57 at level 4).
 */
describe.each([
	{ scaleType: 'dorian', colour: 9, scale: [0, 2, 3, 5, 7, 9, 10], oneIn: 2 },
	{ scaleType: 'minor', colour: 8, scale: [0, 2, 3, 5, 7, 8, 10], oneIn: 2 },
	{ scaleType: 'mixolydian', colour: 10, scale: [0, 2, 4, 5, 7, 9, 10], oneIn: 7 }
] as const)('C $scaleType sessions sound their colour tone (2026-10-07)', ({ scaleType, colour, scale, oneIn }) => {
	/** The phrases a C `scaleType` session serves at `level`, each lick transposed into that scale on C within MIDI 46-77. */
	const served = (level: number): Phrase[] =>
		selectEarTrainingLicks(ALL_CURATED_LICKS, level, scaleType).map(lick =>
			transposeEarTrainingLick(lick, 'C', scaleType, 46, 77)
		);

	it.each([1, 2, 3, 4, 5])(`at level %i, at least one phrase in ${oneIn} carries it`, level => {
		const pool = served(level);
		const carrying = pool.filter(phrase => phrase.notes.some(note => note.pitch !== null && note.pitch % 12 === colour));
		expect(carrying.length * oneIn, `${carrying.length} of ${pool.length}`).toBeGreaterThanOrEqual(pool.length);
	});

	it('every single-chord phrase at every level stays inside the scale', () => {
		const allowed = new Set<number>(scale);
		for (let level = 1; level <= 100; level++) {
			for (const phrase of served(level).filter(p => p.harmony.length === 1)) {
				for (const note of phrase.notes) {
					if (note.pitch === null) continue;
					expect(allowed.has(note.pitch % 12), `level ${level}: ${phrase.id} plays pitch class ${note.pitch % 12}`).toBe(true);
				}
			}
		}
	});
});

/**
 * 2026-10-07: Major Pentatonic, the one scale open from the start, served
 * four phrases at level 1 and five at levels 2-3, all of them two-note cells,
 * so a new player looped the same handful.
 */
describe('Major Pentatonic gives a new player more than a handful of phrases (2026-10-07)', () => {
	it.each([[1, 12], [2, 24], [3, 36]])('at level %i, at least %i phrases', (level, floor) => {
		expect(selectEarTrainingLicks(ALL_CURATED_LICKS, level, 'major-pentatonic').length).toBeGreaterThanOrEqual(floor);
	});
});

/**
 * Selection must only ever ADD as a player levels up. Scales the catalog
 * reaches mostly by adaptation (Melodic Minor, Altered, Lydian Dominant) used
 * to swap their whole adapted pool for the first native lick that unlocked:
 * Altered served 92 phrases at level 10 and ONE from level 15 to 49.
 */
describe('the pool never shrinks as the player levels up', () => {
	it.each(SCALE_UNLOCK_ORDER)('%s', scaleType => {
		let previous = 0;
		for (let level = 1; level <= 100; level++) {
			const size = selectEarTrainingLicks(ALL_CURATED_LICKS, level, scaleType).length;
			expect(size, `level ${level} serves ${size}, level ${level - 1} served ${previous}`).toBeGreaterThanOrEqual(previous);
			previous = size;
		}
	});

	it('native licks join an adapted pool rather than replacing it', () => {
		const native = ALL_CURATED_LICKS.find(lick => lick.harmony[0]?.scaleId === 'melodic-minor.altered')!;
		const exercise = ALL_CURATED_LICKS.find(lick => lick.id === 'bc-001')!;
		expect(selectEarTrainingLicks([native, exercise], 100, 'altered')).toEqual([native, exercise]);
	});
});
