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

describe('phraseToEvents — breath detune', () => {
	it('scoops the first note −15 cents, notes below middle C −8, the rest 0', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const phrase = makePhrase([
			{ pitch: 60, duration: [1, 8], offset: [0, 1] },
			{ pitch: 55, duration: [1, 8], offset: [1, 8] },
			{ pitch: 64, duration: [1, 8], offset: [1, 4] }
		]);
		expect(phraseToEvents(phrase, 120, 0.5, PPQ).map((e) => e.detune)).toEqual([-15, -8, 0]);
	});
});

describe('phraseToEvents — timing humanization bounds', () => {
	// The ±6 ms budget scales with 120/tempo and so does the tick length, so
	// at PPQ 192 the jitter is ±2 ticks at EVERY tempo: the played grid never
	// sits more than 2 ticks off the scorer's, and the downbeat can never be
	// pulled ahead of tick 0 into the count-in.
	const grid = EIGHTH_LINE.map((n) =>
		Math.round(applySwingToBeats(fractionToFloat(n.offset) * 4, 0.5) * PPQ)
	);

	it('shifts every onset by at most 2 ticks either way, at any tempo', () => {
		for (const tempo of [60, 120, 240]) {
			vi.spyOn(Math, 'random').mockReturnValue(1);
			const late = phraseToEvents(makePhrase(EIGHTH_LINE), tempo, 0.5, PPQ).map((e) => e.ticks);
			vi.restoreAllMocks();
			vi.spyOn(Math, 'random').mockReturnValue(0);
			const early = phraseToEvents(makePhrase(EIGHTH_LINE), tempo, 0.5, PPQ).map((e) => e.ticks);
			vi.restoreAllMocks();
			expect(late, `tempo ${tempo}`).toEqual(grid.map((t) => t + 2));
			expect(early, `tempo ${tempo}`).toEqual(grid.map((t, i) => (i === 0 ? 0 : t - 2)));
		}
	});
});

/**
 * CodeRabbit on #306: the lick browser's Listen plays a Weimar performance
 * whose offsets and lengths are the measured seconds. Humanizing those onsets
 * or shortening them by articulation plays something the soloist did not.
 */
describe('phraseToEvents — performed timing', () => {
	it('schedules a performed phrase exactly as written: no onset jitter, no articulation scaling', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		const tempo = 120;
		const events = phraseToEvents(makePhrase(EIGHTH_LINE), tempo, 0.5, PPQ, { performed: true });
		EIGHTH_LINE.forEach((note, k) => {
			expect(events[k].ticks).toBe(Math.round(fractionToFloat(note.offset) * 4 * PPQ));
			expect(events[k].duration).toBeCloseTo(fractionToFloat(note.duration) * 4 * (60 / tempo), 9);
		});
	});

	it('still humanizes and articulates an ordinary phrase', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		const events = phraseToEvents(makePhrase(EIGHTH_LINE), 120, 0.5, PPQ);
		const grid = EIGHTH_LINE.map((note) => Math.round(fractionToFloat(note.offset) * 4 * PPQ));
		expect(events.some((e, k) => e.ticks !== grid[k])).toBe(true);
	});
});

describe('sax ear-training repeats', () => {
	it.each([60, 140, 240])('tapers into both re-attacks of a swung unison run at %i BPM', (tempo) => {
		vi.spyOn(Math, 'random').mockReturnValue(0.75);
		const notes = EIGHTH_LINE.map((note, k) => ({ ...note, pitch: k < 3 ? 60 : note.pitch }));
		const phrase = makePhrase(notes);
		const original = phraseToEvents(phrase, tempo, 0.67, PPQ);
		const events = phraseToEvents(phrase, tempo, 0.67, PPQ, { tongueRepeats: true });
		for (const k of [0, 1]) {
			const interval = (events[k + 1].ticks - events[k].ticks) * 60 / (PPQ * tempo);
			const { duration, release } = events[k];
			expect(duration).toBeLessThan(interval);
			expect(duration).toBeGreaterThanOrEqual(Math.min(original[k].duration, interval * 0.88) - 1e-9);
			// smplr uses a linear release. At most half the previous voice
			// carries into the attack, including the short swung upbeat.
			expect(1 - (interval - duration) / release).toBeLessThanOrEqual(0.500001);
			expect({ ...events[k], duration: original[k].duration, release: original[k].release }).toEqual(original[k]);
		}
		expect(events.slice(2)).toEqual(original.slice(2));
	});

	it('preserves ties, written rests, and the timing of a measured performance', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const phrase = makePhrase([
			{ pitch: 60, offset: [0, 1], duration: [1, 8], tied: true },
			{ pitch: 60, offset: [1, 8], duration: [1, 8] },
			{ pitch: null, offset: [1, 4], duration: [1, 8] },
			{ pitch: 60, offset: [3, 8], duration: [1, 8] }
		]);
		const original = phraseToEvents(phrase, 120, 0.5, PPQ);
		expect(original).toHaveLength(2);
		expect(phraseToEvents(phrase, 120, 0.5, PPQ, { tongueRepeats: true })).toEqual(original);
		const repeats = makePhrase(EIGHTH_LINE.map(note => ({ ...note, pitch: 60 })));
		expect(phraseToEvents(repeats, 120, 0.5, PPQ, { performed: true, tongueRepeats: true }))
			.toEqual(phraseToEvents(repeats, 120, 0.5, PPQ, { performed: true }));
	});
});
