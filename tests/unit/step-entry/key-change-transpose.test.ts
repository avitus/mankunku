import { describe, it, expect } from 'vitest';
import { transposeNotesForKeyChange } from '$lib/step-entry/transpose';
import type { Note, PitchClass } from '$lib/types/music';
import type { InstrumentConfig } from '$lib/types/instruments';

/** Build a minimal InstrumentConfig; only transposition + range matter here. */
function makeInstrument(
	transpositionSemitones: number,
	concertRangeLow: number,
	concertRangeHigh: number
): InstrumentConfig {
	return {
		name: 'Test',
		key: 'C',
		transpositionSemitones,
		concertRangeLow,
		concertRangeHigh,
		clef: 'treble',
		gmProgram: 0,
		highNotePresets: []
	} as InstrumentConfig;
}

/** Build notes from MIDI pitches (null = rest), with sequential quarter-note offsets. */
function notesFrom(pitches: (number | null)[]): Note[] {
	return pitches.map((p, i) => ({
		pitch: p,
		duration: [1, 4] as [number, number],
		offset: [i, 4] as [number, number]
	}));
}

describe('transposeNotesForKeyChange', () => {
	it('transposes pitched notes by the key interval and keeps them in range', () => {
		// Concert instrument (no written offset), range centered on G4 (55..79, mid 67).
		const inst = makeInstrument(0, 55, 79);
		const notes = notesFrom([60, 64, 67]); // C E G
		const result = transposeNotesForKeyChange(notes, 'C', 'G', inst, 79);
		// C→G is +7; the home octave is already centred so no octave shift.
		expect(result.map((n) => n.pitch)).toEqual([67, 71, 74]);
	});

	it('octave-shifts down to fit the instrument range', () => {
		// Range 55..75. C→G (+7) sends [67,72] → [74,79]; 79 exceeds 75, so the
		// best fit drops an octave to land both notes in range.
		const inst = makeInstrument(0, 55, 75);
		const notes = notesFrom([67, 72]);
		const result = transposeNotesForKeyChange(notes, 'C', 'G', inst, 75);
		expect(result.map((n) => n.pitch)).toEqual([62, 67]);
	});

	it('preserves rests and per-note metadata', () => {
		const inst = makeInstrument(0, 55, 79);
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 8], offset: [0, 8], spelling: 'flat', tied: true },
			{ pitch: null, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 4], offset: [2, 8] }
		];
		const result = transposeNotesForKeyChange(notes, 'C', 'G', inst, 79);
		expect(result[1].pitch).toBeNull();
		expect(result[0].duration).toEqual([1, 8]);
		expect(result[2].offset).toEqual([2, 8]);
		expect(result[0].spelling).toBe('flat');
		expect(result[0].tied).toBe(true);
	});

	it('returns an unchanged copy when the key does not change', () => {
		const inst = makeInstrument(0, 55, 79);
		const notes = notesFrom([60, 64, 67]);
		const result = transposeNotesForKeyChange(notes, 'C', 'C' as PitchClass, inst, 79);
		expect(result.map((n) => n.pitch)).toEqual([60, 64, 67]);
		expect(result).not.toBe(notes); // a fresh array, safe to assign back to state
	});

	it('returns an empty array when there are no notes', () => {
		const inst = makeInstrument(0, 55, 79);
		expect(transposeNotesForKeyChange([], 'C', 'G', inst, 79)).toEqual([]);
	});

	it('handles a transposing instrument via written-key change', () => {
		// Tenor-like: +14 written offset, concert range 44..76. Changing the WRITTEN
		// key C→D is a +2 concert move; notes must shift by exactly +2, not +2±offset.
		const inst = makeInstrument(14, 44, 76);
		const notes = notesFrom([60, 62, 64]);
		const result = transposeNotesForKeyChange(notes, 'C', 'D', inst, 75);
		expect(result.map((n) => n.pitch)).toEqual([62, 64, 66]);
	});

	it('does not mutate the input notes', () => {
		const inst = makeInstrument(0, 55, 79);
		const notes = notesFrom([60, 64, 67]);
		transposeNotesForKeyChange(notes, 'C', 'G', inst, 79);
		expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67]);
	});
});
