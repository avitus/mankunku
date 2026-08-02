import { describe, it, expect } from 'vitest';
import type { Note } from '$lib/types/music';
import { buildBookIndex } from '$lib/matching/book-index';
import { encodePhrase } from '$lib/matching/encode';
import { searchMatches } from '$lib/matching/search';
import { makePhrase } from '../../helpers/lick-builders';

const PPQ = 480;

/** An 8-note eighth line — comfortably over the 6-pitched-note floor. */
function eighthLine(startMidi: number): Note[] {
	const steps = [0, 2, 4, 5, 7, 5, 4, 0];
	return steps.map((s, i) => ({
		pitch: startMidi + s,
		duration: [1, 8] as [number, number],
		offset: [i, 8] as [number, number]
	}));
}

describe('buildBookIndex', () => {
	it('excludes licks with fewer than 6 pitched notes', () => {
		const short = makePhrase({ id: 'short-lick' }); // 4 default quarters
		const long = makePhrase({ id: 'long-lick', notes: eighthLine(60) });
		const book = buildBookIndex([short, long], PPQ);
		expect(book.index.sources.map((s) => s.id)).toEqual(['long-lick']);
		expect(book.names.get('long-lick')).toBe(long.name);
		expect(book.names.has('short-lick')).toBe(false);
	});

	it('finds an indexed lick from its own feature at score 1', () => {
		const lick = makePhrase({ id: 'self-lick', name: 'Self Lick', notes: eighthLine(62) });
		const book = buildBookIndex([lick], PPQ);
		const results = searchMatches(encodePhrase(lick), book.index);
		expect(results).toHaveLength(1);
		expect(results[0].sourceId).toBe('self-lick');
		expect(results[0].score).toBe(1);
	});

	it('records each lick duration in transport ticks', () => {
		const lick = makePhrase({ id: 'dur-lick', notes: eighthLine(60) });
		const book = buildBookIndex([lick], PPQ);
		// 8 eighths = 4 beats → 4 * PPQ ticks.
		expect(book.durationTicks.get('dur-lick')).toBe(4 * PPQ);
	});
});
