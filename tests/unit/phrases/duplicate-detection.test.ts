import { describe, it, expect } from 'vitest';
import { pitchClassContour, contoursMatchAnyKey, findDuplicateLick } from '$lib/phrases/duplicate-detection';
import type { Phrase, Note, PitchClass } from '$lib/types/music';

function makePhrase(
	id: string,
	notes: Array<[number | null, [number, number]]>,
	key: PitchClass = 'C'
): Phrase {
	return {
		id,
		name: id,
		timeSignature: [4, 4],
		key,
		notes: notes.map(([pitch, duration], i) => ({
			pitch,
			duration,
			offset: [i, 4]
		}) satisfies Note),
		harmony: [],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'user',
		tags: [],
		source: 'user-entered'
	};
}

const CMAJ_QUARTERS: Array<[number, [number, number]]> = [
	[60, [1, 4]], // C
	[62, [1, 4]], // D
	[64, [1, 4]], // E
	[65, [1, 4]], // F
	[67, [1, 4]]  // G
];

describe('pitchClassContour', () => {
	it('collapses octaves to pitch class', () => {
		const p = makePhrase('a', [
			[60, [1, 4]],
			[72, [1, 4]],
			[48, [1, 4]]
		]);
		expect(pitchClassContour(p)).toEqual([
			[0, [1, 4]],
			[0, [1, 4]],
			[0, [1, 4]]
		]);
	});

	it('strips trailing rests', () => {
		const p = makePhrase('a', [
			[60, [1, 4]],
			[62, [1, 4]],
			[null, [1, 2]],
			[null, [1, 4]]
		]);
		expect(pitchClassContour(p)).toEqual([
			[0, [1, 4]],
			[2, [1, 4]]
		]);
	});

	it('keeps internal rests', () => {
		const p = makePhrase('a', [
			[60, [1, 4]],
			[null, [1, 4]],
			[62, [1, 4]]
		]);
		expect(pitchClassContour(p)).toEqual([
			[0, [1, 4]],
			[null, [1, 4]],
			[2, [1, 4]]
		]);
	});

	it('reduces fractions', () => {
		const p = makePhrase('a', [[60, [2, 8]], [62, [4, 16]]]);
		expect(pitchClassContour(p)).toEqual([[0, [1, 4]], [2, [1, 4]]]);
	});
});

describe('contoursMatchAnyKey', () => {
	it('matches identical contours', () => {
		const a = pitchClassContour(makePhrase('a', CMAJ_QUARTERS));
		const b = pitchClassContour(makePhrase('b', CMAJ_QUARTERS));
		expect(contoursMatchAnyKey(a, b)).toBe(true);
	});

	it('matches across keys (transposed up a fourth)', () => {
		// C D E F G → F G A Bb C (same shape, +5 semitones)
		const c = pitchClassContour(makePhrase('c', CMAJ_QUARTERS));
		const f: Array<[number, [number, number]]> = [
			[65, [1, 4]], [67, [1, 4]], [69, [1, 4]], [70, [1, 4]], [72, [1, 4]]
		];
		const fContour = pitchClassContour(makePhrase('f', f));
		expect(contoursMatchAnyKey(c, fContour)).toBe(true);
	});

	it('matches across octaves', () => {
		const low = pitchClassContour(makePhrase('low', CMAJ_QUARTERS));
		const high: Array<[number, [number, number]]> = CMAJ_QUARTERS.map(
			([p, d]) => [(p as number) + 12, d]
		);
		const highContour = pitchClassContour(makePhrase('high', high));
		expect(contoursMatchAnyKey(low, highContour)).toBe(true);
	});

	it('rejects different rhythms', () => {
		const a = pitchClassContour(makePhrase('a', CMAJ_QUARTERS));
		const bNotes: Array<[number, [number, number]]> = CMAJ_QUARTERS.map(
			([p, _d], i) => [p as number, i === 0 ? [1, 8] : [1, 4]]
		);
		const b = pitchClassContour(makePhrase('b', bNotes));
		expect(contoursMatchAnyKey(a, b)).toBe(false);
	});

	it('rejects different length', () => {
		const a = pitchClassContour(makePhrase('a', CMAJ_QUARTERS));
		const b = pitchClassContour(makePhrase('b', CMAJ_QUARTERS.slice(0, 4)));
		expect(contoursMatchAnyKey(a, b)).toBe(false);
	});

	it('rejects when pitch/rest classification differs at an index', () => {
		const a = pitchClassContour(makePhrase('a', CMAJ_QUARTERS));
		const withRest: Array<[number | null, [number, number]]> = [
			[60, [1, 4]], [null, [1, 4]], [64, [1, 4]], [65, [1, 4]], [67, [1, 4]]
		];
		const b = pitchClassContour(makePhrase('b', withRest));
		expect(contoursMatchAnyKey(a, b)).toBe(false);
	});

	it('matches phrases with rests in matching positions across keys', () => {
		const aNotes: Array<[number | null, [number, number]]> = [
			[60, [1, 4]], [null, [1, 4]], [64, [1, 4]], [65, [1, 4]], [67, [1, 4]]
		];
		const bNotes: Array<[number | null, [number, number]]> = [
			// Transposed up a minor third: +3 semitones
			[63, [1, 4]], [null, [1, 4]], [67, [1, 4]], [68, [1, 4]], [70, [1, 4]]
		];
		const a = pitchClassContour(makePhrase('a', aNotes));
		const b = pitchClassContour(makePhrase('b', bNotes));
		expect(contoursMatchAnyKey(a, b)).toBe(true);
	});
});

describe('findDuplicateLick', () => {
	const libraryItem = makePhrase('lib-1', CMAJ_QUARTERS, 'C');

	it('returns null when entered phrase has fewer than 4 pitched notes', () => {
		const short = makePhrase('short', CMAJ_QUARTERS.slice(0, 3));
		expect(findDuplicateLick(short, [libraryItem])).toBeNull();
	});

	it('returns null when nothing matches', () => {
		const unrelated = makePhrase('u', [
			[60, [1, 4]], [63, [1, 4]], [66, [1, 4]], [69, [1, 4]]
		]);
		expect(findDuplicateLick(unrelated, [libraryItem])).toBeNull();
	});

	it('returns the matching lick (same key)', () => {
		const entered = makePhrase('entered', CMAJ_QUARTERS);
		expect(findDuplicateLick(entered, [libraryItem])?.id).toBe('lib-1');
	});

	it('returns the matching lick across keys', () => {
		const entered = makePhrase('entered', [
			[62, [1, 4]], [64, [1, 4]], [66, [1, 4]], [67, [1, 4]], [69, [1, 4]]
		], 'D');
		expect(findDuplicateLick(entered, [libraryItem])?.id).toBe('lib-1');
	});

	it('returns null when the only candidate is the entered phrase itself (same id)', () => {
		const entered = makePhrase('lib-1', CMAJ_QUARTERS);
		expect(findDuplicateLick(entered, [libraryItem])).toBeNull();
	});

	it('returns null for prefix match', () => {
		const entered = makePhrase('entered', CMAJ_QUARTERS.slice(0, 4));
		expect(findDuplicateLick(entered, [libraryItem])).toBeNull();
	});
});
