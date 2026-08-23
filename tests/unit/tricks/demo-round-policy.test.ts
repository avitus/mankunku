/**
 * When does a trick round have something NEW to hear? Trick sessions used to
 * demo every cycle ("fresh example each round"), which the user experienced
 * as too many Listen bars while drilling enclosures (2026-08-22). The policy
 * now: round 1 always demos; a later round demos only when its example STYLE
 * is one this session has not demoed yet. Enclosures declare no styles, so
 * they demo once; triad pairs rotate three styles (cell, triplets, four
 * eighths — the demo is the only place the app shows they exist), so they
 * demo in rounds 1–3 and never again.
 */
import { describe, it, expect } from 'vitest';
import { getTrickById, trickRoundIntroducesStyle, exampleStyleForRound } from '$lib/tricks';

describe('trickRoundIntroducesStyle', () => {
	const enclosures = getTrickById('enclosures')!;
	const triadPairs = getTrickById('triad-pairs')!;

	it('a trick with no example styles introduces one only in round 1', () => {
		expect(enclosures.exampleStyles ?? []).toHaveLength(0);
		expect(trickRoundIntroducesStyle(enclosures, 1)).toBe(true);
		for (let round = 2; round <= 8; round++) {
			expect(trickRoundIntroducesStyle(enclosures, round)).toBe(false);
		}
	});

	it('a trick with rotating styles introduces one per style, then never again', () => {
		const styles = triadPairs.exampleStyles!;
		expect(styles.length).toBe(3);
		for (let round = 1; round <= styles.length; round++) {
			expect(trickRoundIntroducesStyle(triadPairs, round)).toBe(true);
			// The round's style really is new: no earlier round used it.
			const style = exampleStyleForRound(triadPairs, round);
			for (let r = 1; r < round; r++) expect(exampleStyleForRound(triadPairs, r)).not.toBe(style);
		}
		for (let round = styles.length + 1; round <= 9; round++) {
			expect(trickRoundIntroducesStyle(triadPairs, round)).toBe(false);
		}
	});

	it('treats round numbers below 1 as the first round', () => {
		expect(trickRoundIntroducesStyle(enclosures, 0)).toBe(true);
		expect(trickRoundIntroducesStyle(triadPairs, 0)).toBe(true);
	});
});
