import { describe, it, expect } from 'vitest';
import type { Note, Phrase, HarmonicSegment } from '$lib/types/music';
import { phraseToEvents } from '$lib/audio/playback';

const C7_HARMONY: HarmonicSegment[] = [
	{ chord: { root: 'C', quality: '7' }, scaleId: 'bebop.dominant', startOffset: [0, 1], duration: [2, 1] }
];

function makePhrase(notes: Note[]): Phrase {
	return {
		id: 'test',
		name: 'Test',
		timeSignature: [4, 4],
		key: 'C',
		notes,
		harmony: C7_HARMONY,
		difficulty: { level: 1, pitchComplexity: 1, rhythmComplexity: 1, lengthBars: 2 },
		category: 'bebop-lines',
		tags: [],
		source: 'curated'
	};
}

// Rest at 0, note, rest, note, then a tied pair — exercises both skip paths.
const NOTES: Note[] = [
	{ pitch: null, duration: [1, 4], offset: [0, 1] },
	{ pitch: 60, duration: [1, 4], offset: [1, 4] },
	{ pitch: null, duration: [1, 4], offset: [1, 2] },
	{ pitch: 64, duration: [1, 4], offset: [3, 4] },
	{ pitch: 67, duration: [1, 2], offset: [1, 1], tied: true },
	{ pitch: 67, duration: [1, 2], offset: [3, 2] }
];

describe('phraseToEvents — cursor metadata', () => {
	it('carries the chain-start sourceIndex through rest-skip and tie-merge', () => {
		const events = phraseToEvents(makePhrase(NOTES), 120, 0.5, 480);
		expect(events.map((e) => e.sourceIndex)).toEqual([1, 3, 4]);
	});

	it('exposes numeric ticks matching the scheduled time string', () => {
		const events = phraseToEvents(makePhrase(NOTES), 120, 0.5, 480);
		for (const e of events) {
			expect(typeof e.ticks).toBe('number');
			expect(e.time).toBe(`${e.ticks}i`);
		}
	});

	it('keeps every pre-existing event field intact', () => {
		const [first] = phraseToEvents(makePhrase(NOTES), 120, 0.5, 480);
		expect(first.midi).toBe(60);
		expect(typeof first.duration).toBe('number');
		expect(typeof first.velocity).toBe('number');
		expect(typeof first.layerVelocity).toBe('number');
		expect(typeof first.release).toBe('number');
		expect(typeof first.cutoffHz).toBe('number');
		expect(typeof first.detune).toBe('number');
	});
});
