import { describe, it, expect } from 'vitest';
import { buildIndex, searchMatches } from '$lib/matching/search';
import type { IndexPhrase, LickFeature, SourceEntry } from '$lib/matching/index-format';

const SOURCES: SourceEntry[] = [
	{ id: 's1', kind: 'wjazzd', performer: 'Charlie Parker', title: 'Ko Ko' },
	{ id: 's2', kind: 'wjazzd', performer: 'John Coltrane', title: 'Giant Steps' },
	{ id: 's3', kind: 'quote', performer: 'Traditional', title: 'Countdown motif' }
];

const PHRASES: IndexPhrase[] = [
	{
		sourceId: 's1',
		startBar: 3,
		// Chromatic descent with return: [+2, -1, -1, -1, +2, +2]
		intervals: [2, -1, -1, -1, 2, 2],
		iois: [2, 2, 2, 2, 2, 2]
	},
	{
		sourceId: 's2',
		startBar: 1,
		intervals: [5, -2, -3, 7, -5, 2],
		iois: [2, 2, 2, 2, 2, 2]
	},
	{
		sourceId: 's3',
		startBar: 1,
		intervals: [2, 2, 1, 2, 2, 1, 2],
		iois: [2, 2, 2, 2, 2, 2, 2]
	}
];

const INDEX = buildIndex(SOURCES, PHRASES, 5);

function feature(intervals: number[], iois: number[] = intervals.map(() => 2)): LickFeature {
	return { intervals, iois, noteCount: intervals.length + 1, totalBeats: 2, keyPc: 0 };
}

describe('searchMatches', () => {
	it('returns empty when query is shorter than the n-gram size', () => {
		const results = searchMatches(feature([2, -1]), INDEX);
		expect(results).toEqual([]);
	});

	it('returns a perfect match for an identical interval sequence', () => {
		const q = feature([2, -1, -1, -1, 2, 2]);
		const results = searchMatches(q, INDEX);
		expect(results).toHaveLength(1);
		expect(results[0].sourceId).toBe('s1');
		expect(results[0].score).toBeCloseTo(1.0, 5);
		expect(results[0].matched).toBe(6);
	});

	it('still matches with one edge-interval substitution but at a lower score', () => {
		// Last interval changed; the [2,-1,-1,-1,2] 5-gram still anchors the alignment
		const q = feature([2, -1, -1, -1, 2, 3]);
		const results = searchMatches(q, INDEX);
		expect(results.length).toBeGreaterThanOrEqual(1);
		const s1 = results.find((r) => r.sourceId === 's1');
		expect(s1).toBeDefined();
		expect(s1!.score).toBeLessThan(1.0);
		expect(s1!.score).toBeGreaterThan(0.8);
	});

	it('drops the score when rhythms diverge well beyond the ±1-tick tolerance', () => {
		// Quarters (IOI=4) vs eighths (IOI=2): |4-2|=2, outside ±1 tolerance
		const q = feature([2, -1, -1, -1, 2, 2], [4, 4, 4, 4, 4, 4]);
		const results = searchMatches(q, INDEX, { minScore: 0.5 });
		const s1 = results.find((r) => r.sourceId === 's1');
		expect(s1).toBeDefined();
		// Interval-perfect, rhythm-all-mismatch: 0.7*1 + 0.3*0 = 0.7
		expect(s1!.score).toBeCloseTo(0.7, 5);
	});

	it('returns nothing for an unrelated phrase', () => {
		const q = feature([-7, -5, 3, 4, 5, 6]);
		const results = searchMatches(q, INDEX);
		expect(results).toEqual([]);
	});

	it('respects the minScore threshold', () => {
		const q = feature([2, -1, -1, -1, 2, 2], [4, 4, 4, 4, 4, 4]);
		const strict = searchMatches(q, INDEX, { minScore: 0.9 });
		const loose = searchMatches(q, INDEX, { minScore: 0.5 });
		expect(strict.length).toBe(0);
		expect(loose.length).toBeGreaterThan(0);
	});

	it('caps results at topK', () => {
		const q = feature([2, -1, -1, -1, 2, 2]);
		const results = searchMatches(q, INDEX, { topK: 1 });
		expect(results).toHaveLength(1);
	});

	it('keeps only the best alignment per source', () => {
		// s3 phrase [2,2,1,2,2,1,2] contains the 5-gram [2,2,1,2,2] at position 0
		// AND the repeating [2,2,1,2,2] structure could produce two alignments.
		// Query [2,2,1,2,2] aligns cleanly once.
		const q = feature([2, 2, 1, 2, 2]);
		const results = searchMatches(q, INDEX);
		const s3Matches = results.filter((r) => r.sourceId === 's3');
		expect(s3Matches).toHaveLength(1);
	});
});

describe('buildIndex', () => {
	it('indexes every n-gram of every phrase', () => {
		const sources: SourceEntry[] = [{ id: 'a', kind: 'quote', performer: 'x', title: 'y' }];
		const phrases: IndexPhrase[] = [
			{ sourceId: 'a', intervals: [1, 2, 3, 4, 5, 6], iois: [2, 2, 2, 2, 2, 2] }
		];
		const idx = buildIndex(sources, phrases, 5);
		// Two 5-grams: [1,2,3,4,5] and [2,3,4,5,6]
		expect(Object.keys(idx.ngramIndex)).toHaveLength(2);
		expect(idx.ngramIndex['1,2,3,4,5']).toEqual([[0, 0]]);
		expect(idx.ngramIndex['2,3,4,5,6']).toEqual([[0, 1]]);
	});

	it('handles phrases shorter than n-gram size with no crash', () => {
		const sources: SourceEntry[] = [{ id: 'a', kind: 'quote', performer: 'x', title: 'y' }];
		const phrases: IndexPhrase[] = [{ sourceId: 'a', intervals: [1, 2], iois: [2, 2] }];
		const idx = buildIndex(sources, phrases, 5);
		expect(Object.keys(idx.ngramIndex)).toHaveLength(0);
	});
});
