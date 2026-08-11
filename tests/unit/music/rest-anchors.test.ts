import { describe, it, expect } from 'vitest';
import { mergeConsecutiveRests, phraseToAbc, phraseToAbcWithMap } from '$lib/music/notation';
import type { Note, Phrase } from '$lib/types/music';

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'rest-anchor-test',
		name: 'test',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'test'
	};
}

/** Quarter-note element at `offset`; pitch defaults to a rest. */
const q = (offset: [number, number], pitch: number | null = null): Note => ({
	pitch,
	duration: [1, 4],
	offset
});

describe('mergeConsecutiveRests source mapping', () => {
	it('keeps pitched notes mapped to their own indices', () => {
		const notes = [q([0, 1], 60), q([1, 4], 64)];
		expect(mergeConsecutiveRests(notes, [4, 4]).sourceMap).toEqual([0, 1]);
	});

	it('collapse: a merged display rest carries the first source rest index', () => {
		// Beats 3+4: two quarter rests spanning [1/2, 1) merge into one half rest.
		const notes = [q([0, 1], 60), q([1, 4], 62), q([1, 2]), q([3, 4])];
		const { display, sourceMap } = mergeConsecutiveRests(notes, [4, 4]);
		expect(display.map((n) => n.pitch)).toEqual([60, 62, null]);
		expect(display[2].duration).toEqual([1, 2]);
		expect(sourceMap).toEqual([0, 1, 2]);
	});

	it('collapse: sourceEndMap records the last source rest swallowed by the segment', () => {
		const notes = [q([0, 1], 60), q([1, 4], 62), q([1, 2]), q([3, 4])];
		const { sourceEndMap } = mergeConsecutiveRests(notes, [4, 4]);
		expect(sourceEndMap).toEqual([0, 1, 3]);
	});

	it('fan-out: every display segment of a split source rest carries that same source index', () => {
		// One half rest spanning the bar midpoint [1/4, 3/4) → two display quarter rests.
		const notes = [
			q([0, 1], 60),
			{ pitch: null, duration: [1, 2] as [number, number], offset: [1, 4] as [number, number] },
			q([3, 4], 67)
		];
		const { display, sourceMap, sourceEndMap } = mergeConsecutiveRests(notes, [4, 4]);
		expect(display.map((n) => n.pitch)).toEqual([60, null, null, 67]);
		expect(sourceMap).toEqual([0, 1, 1, 2]);
		expect(sourceEndMap).toEqual([0, 1, 1, 2]);
	});

	it('triplet rests still pass through with their own source index', () => {
		const notes: Note[] = [
			{ pitch: 60, duration: [1, 12], offset: [0, 1] },
			{ pitch: null, duration: [1, 12], offset: [1, 12] },
			{ pitch: 64, duration: [1, 12], offset: [1, 6] }
		];
		expect(mergeConsecutiveRests(notes, [4, 4]).sourceMap).toEqual([0, 1, 2]);
	});
});

describe('phraseToAbcWithMap rest anchors', () => {
	const fixture = makePhrase([q([0, 1], 60), q([1, 4]), q([1, 2], 64), q([3, 4], 67)]);

	it('emits an anchor for a display rest with rest: true', () => {
		const { abc, noteAnchors } = phraseToAbcWithMap(fixture);
		expect(noteAnchors).toHaveLength(4);
		const restAnchor = noteAnchors.find((a) => a.rest);
		expect(restAnchor).toBeDefined();
		expect(restAnchor!.sourceIndex).toBe(1);
		expect(abc[restAnchor!.startChar]).toBe('z');
	});

	it('pitched anchors carry no rest flag', () => {
		const { noteAnchors } = phraseToAbcWithMap(fixture);
		expect(noteAnchors.filter((a) => !a.rest).map((a) => a.sourceIndex)).toEqual([0, 2, 3]);
	});

	it('a collapsed rest run anchors its full source range', () => {
		const notes = [q([0, 1], 60), q([1, 4], 62), q([1, 2]), q([3, 4])];
		const { noteAnchors } = phraseToAbcWithMap(makePhrase(notes));
		const restAnchor = noteAnchors.find((a) => a.rest)!;
		expect(restAnchor.sourceIndex).toBe(2);
		expect(restAnchor.sourceIndexEnd).toBe(3);
	});

	it('a fanned-out segment omits sourceIndexEnd (single source rest)', () => {
		const notes: Note[] = [
			q([0, 1], 60),
			{ pitch: null, duration: [1, 2], offset: [1, 4] },
			q([3, 4], 67)
		];
		const { noteAnchors } = phraseToAbcWithMap(makePhrase(notes));
		const restAnchors = noteAnchors.filter((a) => a.rest);
		expect(restAnchors).toHaveLength(2);
		expect(restAnchors.map((a) => a.sourceIndex)).toEqual([1, 1]);
		expect(restAnchors.every((a) => a.sourceIndexEnd === undefined)).toBe(true);
	});

	// Characterization pin: anchoring rests must not change the rendered ABC.
	it('rendered ABC is unchanged by rest anchoring', () => {
		expect(phraseToAbc(fixture)).toMatchInlineSnapshot(`
			"X:1
			T:test
			M:4/4
			L:1/8
			K:C
			C2z2 E2G2 |]"
		`);
	});
});
