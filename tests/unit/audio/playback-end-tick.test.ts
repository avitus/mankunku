import { describe, it, expect } from 'vitest';
import { getPhraseEndTicks } from '$lib/audio/playback';
import type { Phrase } from '$lib/types/music';

const PPQ = 192;

function makePhrase(notes: Phrase['notes'], harmonyBars: number): Phrase {
	return {
		id: 'test',
		name: 'Test Phrase',
		tags: [],
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: [
			{
				chord: { root: 'C', quality: '7' },
				scaleId: 'blues.minor',
				startOffset: [0, 1],
				duration: [harmonyBars, 1]
			}
		],
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: harmonyBars },
		category: 'blues',
		source: 'curated'
	};
}

// Melody ends at beat 5 (bar 2 beat 2) over a 2-bar vamp — the bbn-004 shape.
const shortMelodyLongVamp = makePhrase(
	[
		{ pitch: 65, duration: [1, 4], offset: [0, 1] },
		{ pitch: 66, duration: [1, 4], offset: [1, 4] },
		{ pitch: 67, duration: [1, 2], offset: [1, 2] },
		{ pitch: 67, duration: [1, 4], offset: [1, 1] }
	],
	2
);

describe('getPhraseEndTicks', () => {
	it('defaults to whole-bar semantics: harmony extent rounded up, plus a 1-beat margin', () => {
		expect(getPhraseEndTicks(shortMelodyLongVamp, PPQ)).toBe(2 * 4 * PPQ + PPQ);
	});

	it('resolveAtMelodyEnd ends 1 beat after the last melody note, ignoring the vamp tail', () => {
		// Melody ends at beat 5 → 5 * PPQ + 1-beat margin.
		expect(getPhraseEndTicks(shortMelodyLongVamp, PPQ, true)).toBe(5 * PPQ + PPQ);
	});

	it('the two modes agree when the melody fills the harmony bars exactly', () => {
		const fullBar = makePhrase([{ pitch: 60, duration: [1, 1], offset: [0, 1] }], 1);
		expect(getPhraseEndTicks(fullBar, PPQ, true)).toBe(getPhraseEndTicks(fullBar, PPQ));
	});

	it('falls back to whole-bar semantics for a harmony-only phrase', () => {
		const harmonyOnly = makePhrase([], 2);
		expect(getPhraseEndTicks(harmonyOnly, PPQ, true)).toBe(2 * 4 * PPQ + PPQ);
	});

	it('ignores trailing rests — melody end is the last sounding note', () => {
		const withTrailingRest = makePhrase(
			[
				{ pitch: 65, duration: [1, 4], offset: [0, 1] },
				{ pitch: null, duration: [3, 4], offset: [1, 4] }
			],
			2
		);
		// Sounding melody ends at beat 1; the 3-beat rest doesn't delay the handoff.
		expect(getPhraseEndTicks(withTrailingRest, PPQ, true)).toBe(1 * PPQ + PPQ);
	});

	it('falls back to whole-bar semantics when the melody is all rests', () => {
		const allRests = makePhrase([{ pitch: null, duration: [1, 1], offset: [0, 1] }], 2);
		expect(getPhraseEndTicks(allRests, PPQ, true)).toBe(2 * 4 * PPQ + PPQ);
	});
});
