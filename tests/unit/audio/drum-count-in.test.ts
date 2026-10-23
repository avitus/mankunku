import { describe, expect, it } from 'vitest';
import {
	TWO_BAR_COUNT_IN_ABOVE_BPM,
	countInBarsForTempo,
	drumCountInHits
} from '$lib/audio/drum-count-in';

const PPQ = 192;

/**
 * 2026-10-22, Andy: tune practice started on a silent bar — nothing said
 * when the tune was coming. The drummer now counts it in: one bar, two above
 * 150 BPM, in the jazz count-off "one … two … one two three four".
 */
describe('countInBarsForTempo', () => {
	it('counts one bar up to and including 150 BPM', () => {
		expect(TWO_BAR_COUNT_IN_ABOVE_BPM).toBe(150);
		expect(countInBarsForTempo(60)).toBe(1);
		expect(countInBarsForTempo(150)).toBe(1);
	});

	it('counts two bars above 150 BPM', () => {
		expect(countInBarsForTempo(151)).toBe(2);
		expect(countInBarsForTempo(240)).toBe(2);
	});
});

describe('drumCountInHits', () => {
	const beats = (hits: ReturnType<typeof drumCountInHits>) => hits.map((h) => h.tick / PPQ);

	it('counts one bar of 4/4 on every beat', () => {
		expect(beats(drumCountInHits(1, 4, PPQ))).toEqual([0, 1, 2, 3]);
	});

	it('counts two bars of 4/4 in halves, then quarters: "one … two … one two three four"', () => {
		expect(beats(drumCountInHits(2, 4, PPQ))).toEqual([0, 2, 4, 5, 6, 7]);
	});

	it('counts a two-bar waltz "one … | one two three"', () => {
		// An odd meter has no half-bar to land "two" on, so the opening bar
		// sounds its downbeat alone — the waltz's dotted-half pulse.
		expect(beats(drumCountInHits(2, 3, PPQ))).toEqual([0, 3, 4, 5]);
	});

	it('plays on the cross-stick, the kit\'s stick click', () => {
		const hits = drumCountInHits(2, 4, PPQ);
		expect(new Set(hits.map((h) => h.drum))).toEqual(new Set(['crossstick']));
		for (const h of hits) {
			expect(h.velocity).toBeGreaterThan(0);
			expect(h.velocity).toBeLessThanOrEqual(1);
		}
	});

	it('counts nothing for no bars', () => {
		expect(drumCountInHits(0, 4, PPQ)).toEqual([]);
	});
});
