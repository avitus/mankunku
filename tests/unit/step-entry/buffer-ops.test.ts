import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import {
	coalesceRests,
	insertElement,
	removeTime,
	replaceWithRest,
	spliceElement,
	stripTrailingRests,
	trimOverlappingNotes
} from '$lib/step-entry/buffer-ops';

/**
 * Pure edits on the step-entry buffer (a dense prefix-sum of notes and
 * rests). Delete-to-rest and remove-time are the two meanings of "delete"
 * in the editors since 2026-10-15; coalescing keeps one engraved rest ≈ one
 * selectable element; stripping trailing rests is how a saved lick's pad
 * rest leaves the buffer on load.
 */

function n(pitch: number | null, offset: [number, number], duration: [number, number], extra: Partial<Note> = {}): Note {
	return { pitch, offset, duration, ...extra };
}

/** `pitch @offset ×duration [~]` — one line per element, for readable asserts. */
function rows(notes: readonly Note[]): string[] {
	return notes.map((x) => `${x.pitch ?? 'z'} @${x.offset[0]}/${x.offset[1]} ×${x.duration[0]}/${x.duration[1]}${x.tied ? ' ~' : ''}`);
}

describe('replaceWithRest', () => {
	it('turns the element into a rest of the same span and moves nothing else', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4], { spelling: 'flat' }), n(64, [1, 2], [1, 2])];
		const out = replaceWithRest(notes, 1);
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', '64 @1/2 ×1/2']);
		expect(out[1].spelling).toBeUndefined();
	});

	it('clears the tie that pointed into the replaced note', () => {
		const notes = [n(60, [0, 1], [1, 4], { tied: true }), n(60, [1, 4], [1, 4]), n(64, [1, 2], [1, 4])];
		const out = replaceWithRest(notes, 1);
		expect(out[0].tied).toBe(false);
	});

	it('does not carry the replaced note\'s own tie onto the rest', () => {
		const notes = [n(60, [0, 1], [1, 4], { tied: true }), n(60, [1, 4], [1, 4])];
		const out = replaceWithRest(notes, 0);
		expect(out[0].tied).toBeUndefined();
		expect(out[0].pitch).toBeNull();
	});

	it('leaves the buffer alone for an out-of-range index', () => {
		const notes = [n(60, [0, 1], [1, 4])];
		expect(rows(replaceWithRest(notes, 3))).toEqual(rows(notes));
		expect(rows(replaceWithRest(notes, -1))).toEqual(rows(notes));
	});

	it('does not mutate its input', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4])];
		replaceWithRest(notes, 0);
		expect(notes[0].pitch).toBe(60);
	});
});

describe('removeTime', () => {
	it('drops the element and pulls every later offset earlier by its duration', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 8]), n(64, [3, 8], [1, 4]), n(67, [5, 8], [1, 4])];
		expect(rows(removeTime(notes, 1))).toEqual(['60 @0/1 ×1/4', '64 @1/4 ×1/4', '67 @1/2 ×1/4']);
	});

	it('clears a tie whose new successor has a different pitch', () => {
		const notes = [n(60, [0, 1], [1, 4], { tied: true }), n(60, [1, 4], [1, 4]), n(62, [1, 2], [1, 4])];
		const out = removeTime(notes, 1);
		expect(out[0].tied).toBe(false);
	});

	it('keeps a tie whose new successor has the same pitch', () => {
		const notes = [n(60, [0, 1], [1, 4], { tied: true }), n(null, [1, 4], [1, 4]), n(60, [1, 2], [1, 4])];
		// A rest between two tied Cs is a data error the editor repairs on the
		// way out; removing the rest reconnects the pair.
		const out = removeTime(notes, 1);
		expect(out[0].tied).toBe(true);
	});

	it('clears a tie into a removed last element', () => {
		const notes = [n(60, [0, 1], [1, 4], { tied: true }), n(60, [1, 4], [1, 4])];
		const out = removeTime(notes, 1);
		expect(rows(out)).toEqual(['60 @0/1 ×1/4']);
		expect(out[0].tied).toBe(false);
	});

	it('leaves the buffer alone for an out-of-range index and never mutates its input', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4])];
		expect(rows(removeTime(notes, 2))).toEqual(rows(notes));
		removeTime(notes, 0);
		expect(rows(notes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4']);
	});
});

describe('coalesceRests', () => {
	it('merges contiguous rests that start in the same bar and maps old indices onto the merged element', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 4]), n(null, [1, 2], [1, 4]), n(64, [3, 4], [1, 4])];
		const { notes: out, indexMap } = coalesceRests(notes);
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/2', '64 @3/4 ×1/4']);
		expect(indexMap).toEqual([0, 1, 1, 2]);
	});

	it('never merges across a barline', () => {
		const notes = [n(60, [0, 1], [3, 4]), n(null, [3, 4], [1, 4]), n(null, [1, 1], [1, 4]), n(64, [5, 4], [1, 4])];
		const { notes: out, indexMap } = coalesceRests(notes);
		expect(rows(out)).toEqual(rows(notes));
		expect(indexMap).toEqual([0, 1, 2, 3]);
	});

	it('merges a rest that already spans a barline with one starting in its own bar', () => {
		// A saved lick's pad rest can run to the end of the canvas; a rest left
		// in front of it by a delete joins it (both start in bar 1).
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 4]), n(null, [1, 2], [3, 2])];
		const { notes: out } = coalesceRests(notes);
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×7/4']);
	});

	it('leaves triplet rests alone', () => {
		const notes = [n(null, [0, 1], [1, 12]), n(null, [1, 12], [1, 12]), n(60, [1, 6], [1, 12])];
		expect(rows(coalesceRests(notes).notes)).toEqual(rows(notes));
	});

	it('does not merge rests separated by a note or by a gap', () => {
		const notes = [n(null, [0, 1], [1, 4]), n(60, [1, 4], [1, 4]), n(null, [1, 2], [1, 4]), n(null, [1, 1], [1, 4])];
		expect(rows(coalesceRests(notes).notes)).toEqual(rows(notes));
	});

	it('honours a different bar length', () => {
		// 3/4 bars: the rests at 1/2 and 3/4 sit in different bars.
		const notes = [n(null, [1, 4], [1, 4]), n(null, [1, 2], [1, 4]), n(null, [3, 4], [1, 4])];
		const { notes: out } = coalesceRests(notes, [3, 4]);
		expect(rows(out)).toEqual(['z @1/4 ×1/2', 'z @3/4 ×1/4']);
	});
});

describe('stripTrailingRests', () => {
	it('drops every rest at the end of the buffer', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 4]), n(null, [1, 2], [7, 2])];
		expect(rows(stripTrailingRests(notes))).toEqual(['60 @0/1 ×1/4']);
	});

	it('keeps rests that have a note after them', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 4]), n(62, [1, 2], [1, 4])];
		expect(rows(stripTrailingRests(notes))).toEqual(rows(notes));
	});

	it('empties an all-rest buffer and passes an empty one through', () => {
		expect(stripTrailingRests([n(null, [0, 1], [1, 1])])).toEqual([]);
		expect(stripTrailingRests([])).toEqual([]);
	});
});

describe('spliceElement (overwrite)', () => {
	// The one write policy since 2026-10-15 (MuseScore's note input: "notes
	// entered this way will replace any rests or notes that were already
	// present at the cursor location"). Rests were always overwritten; pitched
	// notes now are too — covered ones go, a partly covered one is trimmed.
	it('appends past the content end, bridging the gap with one rest', () => {
		const notes = [n(60, [0, 1], [1, 4])];
		const { notes: out, index } = spliceElement(notes, n(62, [1, 2], [1, 4]));
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4', '62 @1/2 ×1/4']);
		expect(index).toBe(2);
	});

	it('carves a note out of a rest, keeping both remainders and every later offset', () => {
		const notes = [n(null, [0, 1], [1, 1]), n(64, [1, 1], [1, 4])];
		const { notes: out, index } = spliceElement(notes, n(60, [1, 4], [1, 4]));
		expect(rows(out)).toEqual(['z @0/1 ×1/4', '60 @1/4 ×1/4', 'z @1/2 ×1/2', '64 @1/1 ×1/4']);
		expect(index).toBe(1);
	});

	it('replaces a note of the same span in place', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4], { spelling: 'flat' }), n(64, [1, 2], [1, 4])];
		const { notes: out, index } = spliceElement(notes, n(65, [1, 4], [1, 4]));
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', '65 @1/4 ×1/4', '64 @1/2 ×1/4']);
		expect(out[1].spelling).toBeUndefined();
		expect(index).toBe(1);
	});

	it('drops the notes a longer element covers and truncates one it only reaches into', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4]), n(64, [1, 2], [1, 4]), n(67, [3, 4], [1, 2])];
		const { notes: out } = spliceElement(notes, n(65, [1, 4], [3, 4]));
		// D and E are covered; G loses its first quarter but keeps its pitch.
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', '65 @1/4 ×3/4', '67 @1/1 ×1/4']);
	});

	it('trims a note it starts inside and clears that note\'s tie', () => {
		const notes = [n(60, [0, 1], [1, 2], { tied: true }), n(60, [1, 2], [1, 4])];
		const { notes: out } = spliceElement(notes, n(62, [1, 4], [1, 4]));
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4', '60 @1/2 ×1/4']);
		expect(out[0].tied).toBe(false);
	});

	it('keeps the spliced element\'s own tie and never mutates its input', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(null, [1, 4], [1, 4])];
		const { notes: out } = spliceElement(notes, n(60, [1, 4], [1, 4], { tied: true }));
		expect(out[1].tied).toBe(true);
		expect(rows(notes)).toEqual(['60 @0/1 ×1/4', 'z @1/4 ×1/4']);
	});
});

describe('trimOverlappingNotes', () => {
	it('shortens a note that runs into the next one and clears its tie', () => {
		const notes = [n(60, [0, 1], [1, 1], { tied: true }), n(62, [1, 2], [1, 4])];
		const out = trimOverlappingNotes(notes);
		expect(rows(out)).toEqual(['60 @0/1 ×1/2', '62 @1/2 ×1/4']);
		expect(out[0].tied).toBe(false);
	});

	it('drops a note another starts on top of', () => {
		const notes = [n(60, [1, 4], [1, 2]), n(62, [1, 4], [1, 4])];
		expect(rows(trimOverlappingNotes(notes))).toEqual(['62 @1/4 ×1/4']);
	});

	it('leaves a contiguous or gapped line alone', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4]), n(64, [1, 1], [1, 4])];
		expect(rows(trimOverlappingNotes(notes))).toEqual(rows(notes));
	});
});

describe('insertElement (push)', () => {
	// MuseScore's Insert mode: the new element takes its place and everything
	// from there on moves later by its length.
	it('inserts before the element at its offset and pushes the rest later', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4]), n(64, [1, 2], [1, 4])];
		const { notes: out, index } = insertElement(notes, n(65, [1, 4], [1, 8]));
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', '65 @1/4 ×1/8', '62 @3/8 ×1/4', '64 @5/8 ×1/4']);
		expect(index).toBe(1);
	});

	it('appends when the offset is the content end', () => {
		const notes = [n(60, [0, 1], [1, 4])];
		const { notes: out, index } = insertElement(notes, n(62, [1, 4], [1, 4]));
		expect(rows(out)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4']);
		expect(index).toBe(1);
	});

	it('snaps an offset inside an element to that element\'s start', () => {
		const notes = [n(60, [0, 1], [1, 2]), n(62, [1, 2], [1, 4])];
		const { notes: out, index } = insertElement(notes, n(64, [1, 4], [1, 4]));
		expect(rows(out)).toEqual(['64 @0/1 ×1/4', '60 @1/4 ×1/2', '62 @3/4 ×1/4']);
		expect(index).toBe(0);
	});

	it('never mutates its input', () => {
		const notes = [n(60, [0, 1], [1, 4]), n(62, [1, 4], [1, 4])];
		insertElement(notes, n(64, [1, 4], [1, 4]));
		expect(rows(notes)).toEqual(['60 @0/1 ×1/4', '62 @1/4 ×1/4']);
	});
});
