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
		const progression = ALL_CURATED_LICKS.find(lick => lick.category === 'ii-V-I-major')!;
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
