import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Phrase, Note, HarmonicSegment } from '$lib/types/music';
import { phraseToEvents } from '$lib/audio/playback';
import { computeExpression, extractSoundingNotes } from '$lib/music/expression';
import { applySwingToBeats } from '$lib/music/swing';
import { fractionToFloat } from '$lib/music/intervals';

const C7_HARMONY: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'bebop.dominant', startOffset: [0, 1], duration: [1, 1] }
];

const EIGHTH_LINE: Note[] = [
	{ pitch: 60, duration: [1, 8], offset: [0, 1] },
	{ pitch: 62, duration: [1, 8], offset: [1, 8] },
	{ pitch: 64, duration: [1, 8], offset: [1, 4] },
	{ pitch: 63, duration: [1, 8], offset: [3, 8] },
	{ pitch: 79, duration: [1, 8], offset: [1, 2] },
	{ pitch: 69, duration: [1, 8], offset: [5, 8] },
	{ pitch: 70, duration: [1, 8], offset: [3, 4] },
	{ pitch: 72, duration: [1, 8], offset: [7, 8] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test', name: 'Test', timeSignature: [4, 4], key: 'C',
		notes, harmony: C7_HARMONY,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 1 },
		category: 'bebop-lines', tags: [], source: 'curated'
	};
}

const PPQ = 192;

afterEach(() => vi.restoreAllMocks());

describe('phraseToEvents — timing invariant (scoring-safe)', () => {
	it('derives onset ticks from the swung grid, unchanged by the expression pass', () => {
		// random=0.5 → zero timing/velocity jitter, so ticks are exactly the grid.
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const swing = 0.67;
		const phrase = makePhrase(EIGHTH_LINE);
		const events = phraseToEvents(phrase, 120, swing, PPQ);

		expect(events).toHaveLength(EIGHTH_LINE.length);
		events.forEach((ev, k) => {
			const rawBeats = fractionToFloat(EIGHTH_LINE[k].offset) * 4;
			const expectedTicks = Math.round(applySwingToBeats(rawBeats, swing) * PPQ);
			expect(parseInt(ev.time, 10)).toBe(expectedTicks);
		});
	});
});

describe('phraseToEvents — layer decoupled from gain humanization', () => {
	it('routes the layer from intended velocity even when gain jitter would flip it', () => {
		// random=0 → humanizeVelocity subtracts the full range (8) from gain.
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const phrase = makePhrase(EIGHTH_LINE);
		const intended = computeExpression(extractSoundingNotes(phrase.notes), phrase);
		const events = phraseToEvents(phrase, 120, 0.5, PPQ);

		// layerVelocity always equals the pure, intended velocity (never jittered).
		events.forEach((ev, k) => expect(ev.layerVelocity).toBe(intended[k].velocity));

		// There is at least one note the old code would have flipped: intended > 100
		// (forte) but gain jitter drags the gain velocity to <= 100 (piano range).
		const flipped = events.filter((ev) => ev.layerVelocity > 100 && ev.velocity <= 100);
		expect(flipped.length).toBeGreaterThan(0);
	});
});

describe('phraseToEvents — expression reaches the event', () => {
	it('carries per-note release and cutoff, and scales duration for articulation', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const phrase = makePhrase(EIGHTH_LINE);
		const events = phraseToEvents(phrase, 120, 0.5, PPQ);
		for (const ev of events) {
			expect(ev.release).toBeGreaterThan(0);
			expect(ev.cutoffHz).toBeGreaterThan(0);
			expect(ev.duration).toBeGreaterThan(0);
		}
		// The ghost (idx3, chromatic eighth) is darkened below the global warmth ceiling.
		expect(events[3].cutoffHz).toBeLessThan(4500);
	});
});
