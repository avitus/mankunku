import { describe, expect, it } from 'vitest';
import type { Note, Phrase } from '$lib/types/music';
import { phraseToAbcWithMap } from '$lib/music/notation';
import { tuneToAbcWithMap } from '$lib/music/tune-notation';
import { section, sheet } from '../../helpers/tune-fixtures';

describe.each([false, true])('triplet rests with preserveRestBoundaries=%s', preserveRestBoundaries => {
	it.each([
		[null, null, null], [62, null, null], [null, 64, null], [null, null, 65], [62, 64, 65]
	])('engraves %j, %j, %j as one quarter-triplet group in both editors', (a, b, c) => {
		const notes: Note[] = [
			{ pitch: 60, offset: [0, 1], duration: [1, 2] },
			{ pitch: a, offset: [1, 2], duration: [1, 6] },
			{ pitch: b, offset: [2, 3], duration: [1, 6] },
			{ pitch: c, offset: [5, 6], duration: [1, 6] }
		];
		const phrase: Phrase = {
			id: 'triplet-rests', name: 'Triplet rests', key: 'C', timeSignature: [4, 4], notes,
			harmony: [], difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
			category: 'user', tags: [], source: 'user-entered'
		};
		const results = [
			phraseToAbcWithMap(phrase, undefined, [1, 8], preserveRestBoundaries),
			tuneToAbcWithMap(sheet({ sections: [section({ bars: 1, notes })] }), undefined, { preserveRestBoundaries })
		];
		for (const { abc, noteAnchors } of results) {
			// L:1/8: three quarter glyphs under a 3, never raw fractional lengths
			// that abcjs draws as ordinary rests with no triplet indication.
			expect(abc).toMatch(/\(3(?:[zDEF]2){3}/);
			expect(noteAnchors.map(anchor => anchor.sourceIndex)).toEqual([0, 1, 2, 3]);
			expect(noteAnchors.slice(1).map(anchor => abc.slice(anchor.startChar, anchor.endChar)))
			.toEqual([a === null ? 'z2' : 'D2', b === null ? 'z2' : 'E2', c === null ? 'z2' : 'F2']);
		}
	});
});

it('keeps an inferred triplet rest gap anchored to its actual duration', () => {
	const { abc, gapAnchors } = tuneToAbcWithMap(sheet({ sections: [section({ bars: 1, notes: [
		{ pitch: 60, offset: [0, 1], duration: [1, 2] },
		{ pitch: 62, offset: [1, 2], duration: [1, 6] },
		{ pitch: 65, offset: [5, 6], duration: [1, 6] }
	] })] }), undefined, { preserveRestBoundaries: true });
	expect(abc).toContain('(3D2z2F2');
	expect(gapAnchors).toEqual([expect.objectContaining({ offset: 2 / 3, duration: 1 / 6 })]);
});
