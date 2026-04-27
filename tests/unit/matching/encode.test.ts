import { describe, it, expect } from 'vitest';
import { encodeNotes, encodePhrase } from '$lib/matching/encode';
import type { Note, Phrase } from '$lib/types/music';

function quarterNotes(pitches: Array<number | null>): Note[] {
	return pitches.map((pitch, i) => ({
		pitch,
		duration: [1, 4],
		offset: [i, 4]
	}));
}

describe('encodeNotes', () => {
	it('returns empty arrays for an empty note list', () => {
		const f = encodeNotes([]);
		expect(f).toEqual({ intervals: [], iois: [], noteCount: 0, totalBeats: 0, keyPc: 0 });
	});

	it('computes semitone intervals between consecutive pitched notes', () => {
		// C4, E4, G4 — major triad ascending
		const notes = quarterNotes([60, 64, 67]);
		const f = encodeNotes(notes);
		expect(f.intervals).toEqual([4, 3]);
	});

	it('skips rests so intervals jump across them', () => {
		// C4, rest, E4 — rest should not produce a 0-interval segment
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 4], offset: [0, 4] },
			{ pitch: null, duration: [1, 4], offset: [1, 4] },
			{ pitch: 64, duration: [1, 4], offset: [2, 4] }
		];
		const f = encodeNotes(notes);
		expect(f.intervals).toEqual([4]);
		expect(f.noteCount).toBe(2);
	});

	it('quantizes IOIs to 16th-note ticks', () => {
		// Quarter = 4 sixteenths
		const f = encodeNotes(quarterNotes([60, 62]));
		expect(f.iois).toEqual([4]);
	});

	it('quantizes triplet IOIs (eighth triplet = 12ths)', () => {
		// Three notes of [1,12] durations = eighth-note triplets. Each IOI is 1/12
		// whole note = 16/12 = 1.333 sixteenth ticks → rounds to 1.
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 12], offset: [0, 1] },
			{ pitch: 62, duration: [1, 12], offset: [1, 12] },
			{ pitch: 64, duration: [1, 12], offset: [2, 12] }
		];
		const f = encodeNotes(notes);
		// Both IOIs round from 1.333 to 1
		expect(f.iois).toEqual([1, 1]);
	});

	it('produces identical intervals when the same phrase is transposed', () => {
		const inC = encodeNotes(quarterNotes([60, 64, 67, 72]));
		const inF = encodeNotes(quarterNotes([65, 69, 72, 77]));
		expect(inF.intervals).toEqual(inC.intervals);
		expect(inF.iois).toEqual(inC.iois);
	});

	it('computes totalBeats from the last note', () => {
		// Four quarters starting at offset 0 → ends at 4 beats
		const f = encodeNotes(quarterNotes([60, 62, 64, 65]));
		expect(f.totalBeats).toBeCloseTo(4, 5);
	});
});

describe('encodePhrase', () => {
	it('sets keyPc from the phrase key', () => {
		const phrase: Phrase = {
			id: 'x',
			name: 'x',
			timeSignature: [4, 4],
			key: 'F',
			notes: quarterNotes([65, 69]),
			harmony: [],
			difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category: 'user',
			tags: [],
			source: 'user-entered'
		};
		const f = encodePhrase(phrase);
		expect(f.keyPc).toBe(5); // F = pitch-class 5
	});
});
